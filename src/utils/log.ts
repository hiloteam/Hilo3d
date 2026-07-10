const LEVEL_NONE = 0;
const LEVEL_LOG = 1;
const LEVEL_WARN = 2;
const LEVEL_ERROR = 4;

interface Logger {
    readonly _cache: Record<string, boolean>;
    _console: Console;
    level: number;
    readonly LEVEL_NONE: number;
    readonly LEVEL_LOG: number;
    readonly LEVEL_WARN: number;
    readonly LEVEL_ERROR: number;
    console: Console;
    log(...params: readonly unknown[]): this;
    warn(...params: readonly unknown[]): this;
    error(...params: readonly unknown[]): this;
    logOnce(id: string, ...params: readonly unknown[]): this;
    warnOnce(id: string, ...params: readonly unknown[]): this;
    errorOnce(id: string, ...params: readonly unknown[]): this;
}

const cache: Record<string, boolean> = {};

const log: Logger = {
    _cache: cache,
    _console: console,
    level: LEVEL_LOG | LEVEL_WARN | LEVEL_ERROR,
    LEVEL_NONE,
    LEVEL_LOG,
    LEVEL_WARN,
    LEVEL_ERROR,

    log(...params) {
        if (this.level & LEVEL_LOG) this.console.log(...params);
        return this;
    },

    warn(...params) {
        if (this.level & LEVEL_WARN) this.console.warn(...params);
        return this;
    },

    error(...params) {
        if (this.level & LEVEL_ERROR) this.console.error(...params);
        return this;
    },

    logOnce(id, ...params) {
        const key = `log_${id}`;
        if (!cache[key]) {
            cache[key] = true;
            this.log(...params);
        }
        return this;
    },

    warnOnce(id, ...params) {
        const key = `warn_${id}`;
        if (!cache[key]) {
            cache[key] = true;
            this.warn(...params);
        }
        return this;
    },

    errorOnce(id, ...params) {
        const key = `error_${id}`;
        if (!cache[key]) {
            cache[key] = true;
            this.error(...params);
        }
        return this;
    },

    get console() {
        return this._console;
    },

    set console(value) {
        this._console = value;
    }
};

export default log;
