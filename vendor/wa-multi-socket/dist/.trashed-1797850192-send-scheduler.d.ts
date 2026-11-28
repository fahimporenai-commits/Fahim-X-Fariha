/**
 * Runs tasks one-by-one per key and keeps a minimum (jittered) gap between them.
 * Used to space out outgoing WhatsApp messages per account, which lowers ban/rate-limit risk.
 */
export declare class SendScheduler {
    private readonly minIntervalMs;
    private readonly jitterMs;
    private readonly maxQueued;
    private readonly tails;
    private readonly lastRun;
    private readonly generations;
    private readonly pendingWaits;
    constructor(minIntervalMs: number, jitterMs: number, maxQueued: number);
    run<T>(key: string, task: () => Promise<T>): Promise<T>;
    forget(key: string): void;
    private assertCurrent;
    private wait;
}
