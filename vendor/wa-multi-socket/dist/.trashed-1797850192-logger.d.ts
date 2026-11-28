import pino from 'pino';
declare const logger: {
    pino: pino.Logger<never, boolean>;
    trace: (m: unknown, s?: string, d?: unknown) => void;
    debug: (m: unknown, s?: string, d?: unknown) => void;
    info: (m: unknown, s?: string, d?: unknown) => void;
    success: (m: unknown, s?: string, d?: unknown) => void;
    warn: (m: unknown, s?: string, d?: unknown) => void;
    error: (m: unknown, s?: string, d?: unknown) => void;
    fatal: (m: unknown, s?: string, d?: unknown) => void;
    pairing: (m: unknown, s?: string, d?: unknown) => void;
    banner(): void;
    divider(): void;
    getStats(): {
        uptimeSeconds: number;
        memory: {
            rss: string;
            heapUsed: string;
            heapTotal: string;
        };
        platform: NodeJS.Platform;
        nodeVersion: string;
    };
};
export default logger;
