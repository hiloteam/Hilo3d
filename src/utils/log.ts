export const LogLevel = {
    NONE: 0,
    LOG: 1,
    WARN: 2,
    ERROR: 4,
    ALL: 1 | 2 | 4
} as const;

export type LogLevelValue = (typeof LogLevel)[keyof typeof LogLevel];

/** Configurable engine logger with duplicate-message suppression. */
export class Logger {
    readonly LEVEL_NONE = LogLevel.NONE;
    readonly LEVEL_LOG = LogLevel.LOG;
    readonly LEVEL_WARN = LogLevel.WARN;
    readonly LEVEL_ERROR = LogLevel.ERROR;

    level: number = LogLevel.ALL;
    console: Console;
    private readonly emittedMessages = new Set<string>();

    constructor(output: Console = console) {
        this.console = output;
    }

    log(...params: readonly unknown[]): this {
        if ((this.level & LogLevel.LOG) !== 0) this.console.log(...params);
        return this;
    }

    warn(...params: readonly unknown[]): this {
        if ((this.level & LogLevel.WARN) !== 0) this.console.warn(...params);
        return this;
    }

    error(...params: readonly unknown[]): this {
        if ((this.level & LogLevel.ERROR) !== 0) this.console.error(...params);
        return this;
    }

    logOnce(id: string, ...params: readonly unknown[]): this {
        return this.once(`log:${id}`, () => this.log(...params));
    }

    warnOnce(id: string, ...params: readonly unknown[]): this {
        return this.once(`warn:${id}`, () => this.warn(...params));
    }

    errorOnce(id: string, ...params: readonly unknown[]): this {
        return this.once(`error:${id}`, () => this.error(...params));
    }

    clearOnceCache(): this {
        this.emittedMessages.clear();
        return this;
    }

    private once(key: string, emit: () => this): this {
        if (this.emittedMessages.has(key)) return this;
        this.emittedMessages.add(key);
        return emit();
    }
}

const log = new Logger();

export default log;
