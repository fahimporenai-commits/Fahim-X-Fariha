import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';
import logger from './logger.js';
const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS wa_auth (
    user_id TEXT NOT NULL,
    record_key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, record_key)
  )
`;
/** Last write wins when the same key appears twice in one batch. */
function dedupe(records) {
    return [...new Map(records.map((record) => [record.key, record])).values()];
}
// ───────────────────────────────── SQLite ─────────────────────────────────
export class SQLiteAuthStore {
    database;
    closed = false;
    getStatement;
    insertStatement;
    removeStatement;
    deleteUserStatement;
    deleteKeysStatement;
    listStatement;
    /** Prepared `IN (?, ?, ...)` statements, cached by placeholder count. */
    manyStatements = new Map();
    constructor(filename = './data/wa-auth.sqlite') {
        const inMemory = filename === ':memory:';
        const path = inMemory ? filename : resolve(filename);
        if (!inMemory)
            mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        this.database = new DatabaseSync(path);
        if (!inMemory) {
            try {
                chmodSync(path, 0o600);
            }
            catch (error) {
                this.database.close();
                throw error;
            }
        }
        this.database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
        this.database.exec(CREATE_TABLE);
        this.getStatement = this.database.prepare('SELECT value FROM wa_auth WHERE user_id = ? AND record_key = ?');
        this.insertStatement = this.database.prepare('INSERT INTO wa_auth (user_id, record_key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, record_key) DO UPDATE SET value = excluded.value');
        this.removeStatement = this.database.prepare('DELETE FROM wa_auth WHERE user_id = ? AND record_key = ?');
        this.deleteUserStatement = this.database.prepare('DELETE FROM wa_auth WHERE user_id = ?');
        this.deleteKeysStatement = this.database.prepare('DELETE FROM wa_auth WHERE user_id = ? AND substr(record_key, 1, ?) = ?');
        this.listStatement = this.database.prepare('SELECT DISTINCT user_id FROM wa_auth ORDER BY user_id');
    }
    assertOpen() {
        if (this.closed)
            throw new Error('SQLiteAuthStore is closed.');
    }
    manyStatement(count) {
        let statement = this.manyStatements.get(count);
        if (!statement) {
            const placeholders = Array.from({ length: count }, () => '?').join(', ');
            statement = this.database.prepare(`SELECT record_key, value FROM wa_auth WHERE user_id = ? AND record_key IN (${placeholders})`);
            this.manyStatements.set(count, statement);
        }
        return statement;
    }
    async get(userId, key) {
        this.assertOpen();
        const row = this.getStatement.get(userId, key);
        return row?.value;
    }
    async getMany(userId, keys) {
        this.assertOpen();
        const result = new Map();
        const CHUNK = 500; // stay below SQLite's bound-parameter limit
        for (let i = 0; i < keys.length; i += CHUNK) {
            const chunk = keys.slice(i, i + CHUNK);
            const rows = this.manyStatement(chunk.length).all(userId, ...chunk);
            for (const row of rows)
                result.set(row.record_key, row.value);
        }
        return result;
    }
    async setMany(userId, records) {
        if (records.length === 0)
            return;
        this.assertOpen();
        // Everything below is synchronous, so transactions of different callers never interleave.
        this.database.exec('BEGIN IMMEDIATE');
        try {
            for (const record of dedupe(records)) {
                if (record.value === null)
                    this.removeStatement.run(userId, record.key);
                else
                    this.insertStatement.run(userId, record.key, record.value);
            }
            this.database.exec('COMMIT');
        }
        catch (error) {
            try {
                this.database.exec('ROLLBACK');
            }
            catch {
                // transaction may already be gone; keep the original error
            }
            throw error;
        }
    }
    async deleteUser(userId) {
        this.assertOpen();
        this.deleteUserStatement.run(userId);
    }
    async deleteKeys(userId, prefix) {
        this.assertOpen();
        this.deleteKeysStatement.run(userId, prefix.length, prefix);
    }
    async listUsers() {
        this.assertOpen();
        return this.listStatement.all().map((row) => row.user_id);
    }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        try {
            // Fold the WAL back into the main file so a plain file copy is complete.
            this.database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        }
        catch {
            // not fatal
        }
        this.database.close();
    }
}
export class PostgresAuthStore {
    pool;
    initialization;
    closed = false;
    constructor(connectionString, options = {}) {
        const onError = options.onError ??
            ((error) => logger.error('Idle PostgreSQL client error', 'DATABASE', error));
        this.pool = new Pool({
            connectionString,
            max: options.poolMax ?? 10,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 10_000,
            ssl: {
                rejectUnauthorized: false,
            },
        });
        // An unhandled 'error' event on an idle client would crash the whole process.
        this.pool.on('error', onError);
        // Warm up at startup; a failure here is retried on the next call (see ready()).
        this.ready().catch(() => undefined);
    }
    /** Creates the table once. If it failed (DB down), the next call tries again. */
    ready() {
        if (this.closed)
            return Promise.reject(new Error('PostgresAuthStore is closed.'));
        this.initialization ??= this.pool.query(CREATE_TABLE).then(() => undefined, (error) => {
            this.initialization = undefined;
            throw error;
        });
        return this.initialization;
    }
    async get(userId, key) {
        await this.ready();
        const result = await this.pool.query('SELECT value FROM wa_auth WHERE user_id = $1 AND record_key = $2', [userId, key]);
        return result.rows[0]?.value;
    }
    async getMany(userId, keys) {
        if (keys.length === 0)
            return new Map();
        await this.ready();
        const result = await this.pool.query('SELECT record_key, value FROM wa_auth WHERE user_id = $1 AND record_key = ANY($2::text[])', [userId, keys]);
        return new Map(result.rows.map((row) => [row.record_key, row.value]));
    }
    async setMany(userId, records) {
        if (records.length === 0)
            return;
        await this.ready();
        const unique = dedupe(records);
        const upserts = unique.filter((record) => record.value !== null);
        const deletions = unique.filter((record) => record.value === null).map((record) => record.key);
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            if (upserts.length > 0) {
                await client.query(`INSERT INTO wa_auth (user_id, record_key, value)
           SELECT $1, record_key, value
           FROM UNNEST($2::text[], $3::text[]) AS records(record_key, value)
           ON CONFLICT (user_id, record_key) DO UPDATE SET value = EXCLUDED.value`, [userId, upserts.map((r) => r.key), upserts.map((r) => r.value)]);
            }
            if (deletions.length > 0) {
                await client.query('DELETE FROM wa_auth WHERE user_id = $1 AND record_key = ANY($2::text[])', [userId, deletions]);
            }
            await client.query('COMMIT');
        }
        catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
        }
        finally {
            client.release();
        }
    }
    async deleteUser(userId) {
        await this.ready();
        await this.pool.query('DELETE FROM wa_auth WHERE user_id = $1', [userId]);
    }
    async deleteKeys(userId, prefix) {
        await this.ready();
        await this.pool.query('DELETE FROM wa_auth WHERE user_id = $1 AND LEFT(record_key, $2::int) = $3', [userId, prefix.length, prefix]);
    }
    async listUsers() {
        await this.ready();
        const result = await this.pool.query('SELECT DISTINCT user_id FROM wa_auth ORDER BY user_id');
        return result.rows.map((row) => row.user_id);
    }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        await this.pool.end();
    }
}
/**
 * No URL                      -> SQLite at ./data/wa-auth.sqlite
 * sqlite::memory:             -> in-memory SQLite (tests)
 * sqlite://./path/file.sqlite -> SQLite at that path (sqlite:///abs/path for absolute)
 * postgres:// | postgresql:// -> PostgreSQL (Supabase etc.)
 */
export function createAuthStore(databaseUrl, options = {}) {
    const url = databaseUrl?.trim();
    if (!url)
        return new SQLiteAuthStore();
    if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
        return new PostgresAuthStore(url, options);
    }
    if (url === 'sqlite::memory:')
        return new SQLiteAuthStore(':memory:');
    if (url.startsWith('sqlite://')) {
        return new SQLiteAuthStore(decodeURIComponent(url.slice('sqlite://'.length)));
    }
    throw new Error('Unsupported database URL. Use sqlite://, postgres://, or postgresql://.');
}
