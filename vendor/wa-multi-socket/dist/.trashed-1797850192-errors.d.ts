/** Single source of truth: the type below is derived from this list. */
export declare const WA_MANAGER_ERROR_CODES: readonly ["CLOSED", "INVALID_ARGUMENT", "ALREADY_PAIRED", "PAIRING_IN_PROGRESS", "PAIRING_TIMEOUT", "NOT_AVAILABLE", "NOT_CONNECTED", "CONNECTION_TIMEOUT", "QUEUE_FULL", "TIMEOUT"];
export type WaManagerErrorCode = (typeof WA_MANAGER_ERROR_CODES)[number];
export type WaManagerErrorOptions = {
    /** The original error that caused this one. */
    cause?: unknown;
    /** Which user session the error belongs to (handy for logs). */
    userId?: string;
};
/** Every error thrown by the manager itself carries a stable `code`. */
export declare class WaManagerError extends Error {
    readonly code: WaManagerErrorCode;
    readonly userId?: string;
    constructor(code: WaManagerErrorCode, message: string, options?: WaManagerErrorOptions);
    /**
     * Type-safe check. With no codes: "is this a WaManagerError?".
     * With codes: "is it one of these?"  e.g. WaManagerError.is(err, 'CLOSED', 'NOT_CONNECTED')
     */
    static is(error: unknown, ...codes: WaManagerErrorCode[]): error is WaManagerError;
    /** Clean JSON for logs / API responses (no stack, cause flattened to its message). */
    toJSON(): {
        name: string;
        code: WaManagerErrorCode;
        message: string;
        userId?: string;
        cause?: string;
    };
}
