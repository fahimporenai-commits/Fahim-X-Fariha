import { type AuthenticationCreds, type AuthenticationState } from '@whiskeysockets/baileys';
import type { AuthStore } from './auth-store.js';
/**
 * JSON with binary support. Bytes are stored as base64 (much smaller than number arrays).
 * The replacer reads the RAW value via `this[key]`, because JSON.stringify calls
 * Buffer#toJSON first and would otherwise turn every Buffer into a huge number array.
 */
export declare function serialize(value: unknown): string;
/** Reads the new format and the older formats (number arrays, Baileys BufferJSON). */
export declare function deserialize<T>(value: string): T;
/**
 * True once the account is really linked. `registered` alone is not reliable for
 * multi-device pairing, so `me + account` (set at pair-success) also counts.
 */
export declare function isPaired(creds: Partial<AuthenticationCreds>): boolean;
export declare function readCreds(store: AuthStore, userId: string): Promise<AuthenticationCreds | undefined>;
export declare function isUserPairedInStore(store: AuthStore, userId: string): Promise<boolean>;
export declare function loadAuthState(store: AuthStore, userId: string): Promise<AuthenticationState>;
export declare function serializeCreds(creds: AuthenticationCreds): string;
