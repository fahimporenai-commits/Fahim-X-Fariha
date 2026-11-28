import type { AuthRecord, AuthStore } from './auth-store.js';
export declare class SessionAuthStore implements AuthStore {
    private readonly inner;
    private revoked;
    private chain;
    constructor(inner: AuthStore);
    revoke(): void;
    drain(): Promise<void>;
    get(userId: string, key: string): Promise<string | undefined>;
    getMany(userId: string, keys: string[]): Promise<Map<string, string>>;
    setMany(userId: string, records: AuthRecord[]): Promise<void>;
    deleteKeys(userId: string, prefix: string): Promise<void>;
    deleteUser(userId: string): Promise<void>;
    listUsers(): Promise<string[]>;
    close(): Promise<void>;
    private enqueue;
}
