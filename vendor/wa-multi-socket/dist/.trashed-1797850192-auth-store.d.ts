export type AuthRecord = {
    key: string;
    value: string | null;
};
export interface AuthStore {
    get(userId: string, key: string): Promise<string | undefined>;
    getMany?(userId: string, keys: string[]): Promise<Map<string, string>>;
    setMany(userId: string, records: AuthRecord[]): Promise<void>;
    deleteKeys(userId: string, prefix: string): Promise<void>;
    deleteUser(userId: string): Promise<void>;
    listUsers(): Promise<string[]>;
    close(): Promise<void>;
}
export declare class SQLiteAuthStore implements AuthStore {
    private readonly database;
    private closed;
    private readonly getStatement;
    private readonly insertStatement;
    private readonly removeStatement;
    private readonly deleteUserStatement;
    private readonly deleteKeysStatement;
    private readonly listStatement;
    /** Prepared `IN (?, ?, ...)` statements, cached by placeholder count. */
    private readonly manyStatements;
    constructor(filename?: string);
    private assertOpen;
    private manyStatement;
    get(userId: string, key: string): Promise<string | undefined>;
    getMany(userId: string, keys: string[]): Promise<Map<string, string>>;
    setMany(userId: string, records: AuthRecord[]): Promise<void>;
    deleteUser(userId: string): Promise<void>;
    deleteKeys(userId: string, prefix: string): Promise<void>;
    listUsers(): Promise<string[]>;
    close(): Promise<void>;
}
export type PostgresOptions = {
    /** Called for idle PostgreSQL pool errors. */
    onError?: (error: Error) => void;
    /** Max pool connections. Default: 10. */
    poolMax?: number;
};
export declare class PostgresAuthStore implements AuthStore {
    private readonly pool;
    private initialization;
    private closed;
    constructor(connectionString: string, options?: PostgresOptions);
    /** Creates the table once. If it failed (DB down), the next call tries again. */
    private ready;
    get(userId: string, key: string): Promise<string | undefined>;
    getMany(userId: string, keys: string[]): Promise<Map<string, string>>;
    setMany(userId: string, records: AuthRecord[]): Promise<void>;
    deleteUser(userId: string): Promise<void>;
    deleteKeys(userId: string, prefix: string): Promise<void>;
    listUsers(): Promise<string[]>;
    close(): Promise<void>;
}
export type CreateAuthStoreOptions = PostgresOptions;
/**
 * No URL                      -> SQLite at ./data/wa-auth.sqlite
 * sqlite::memory:             -> in-memory SQLite (tests)
 * sqlite://./path/file.sqlite -> SQLite at that path (sqlite:///abs/path for absolute)
 * postgres:// | postgresql:// -> PostgreSQL (Supabase etc.)
 */
export declare function createAuthStore(databaseUrl?: string, options?: CreateAuthStoreOptions): AuthStore;
