/* eslint prefer-spread: "off", prefer-rest-params:"off" */

const cache = {};
const LEVEL_NONE = 0;
const LEVEL_LOG = 1;
const LEVEL_WARN = 2;
const LEVEL_ERROR = 4;

/**
 * 向 Web 控制台输出一条消息，可以通过设置等级过滤输出的消息。
 * @namespace
 * @type {Object}
 * @name log
 * @example
 * Hilo3d.log.level = Hilo3d.log.LEVEL_LOG | Hilo3d.log.LEVEL_ERROR;
 * Hilo3d.log.error("ERROR!");
 */
const log = {
    _cache: cache,
    /**
     * log级别
     * @type {Number}
     * @default LEVEL_LOG | LEVEL_WARN | LEVEL_ERROR
     */
    level: LEVEL_LOG | LEVEL_WARN | LEVEL_ERROR,

    /**
     * 不显示任何
     * @readOnly
     * @type {Number}
     * @default 0
     */
    LEVEL_NONE,

    /**
     * 显示 log
     * @readOnly
     * @type {Number}
     * @default 1
     */
    LEVEL_LOG,

    /**
     * 显示 warn
     * @readOnly
     * @type {Number}
     * @default 2
     */
    LEVEL_WARN,

    /**
     * 显示 error
     * @readOnly
     * @type {Number}
     * @default 4
     */
    LEVEL_ERROR,

    /**
     * log，等同 console.log
     * @return {log} this
     */
    log() {
        const console = this.console;
        if (this.level & LEVEL_LOG) {
            console.log.apply(console, arguments);
        }
        return this;
    },

    /**
     * warn，等同 console.warn
     * @return {log} this
     */
    warn() {
        const console = this.console;
        if (this.level & LEVEL_WARN) {
            console.warn.apply(console, arguments);
        }
        return this;
    },

    /**
     * error，等同 console.error
     * @return {log} this
     */
    error() {
        const console = this.console;
        if (this.level & LEVEL_ERROR) {
            console.error.apply(console, arguments);
        }
        return this;
    },

    /**
     * logOnce 相同 id 只 log 一次
     * @param {String} id
     * @return {log} this
     */
    logOnce(id) {
        if (!cache['log_' + id]) {
            cache['log_' + id] = true;
            this.log.apply(this, Array.prototype.slice.call(arguments, 1));
        }
        return this;
    },

    /**
     * warnOnce  相同 id 只 once 一次
     * @param {String} id
     * @return {log} this
     */
    warnOnce(id) {
        if (!cache['warn_' + id]) {
            cache['warn_' + id] = true;
            this.warn.apply(this, Array.prototype.slice.call(arguments, 1));
        }
        return this;
    },

    /**
     * errorOnce 相同 id 只 error 一次
     * @param {String} id
     * @return {log} this
     */
    errorOnce(id) {
        if (!cache['error_' + id]) {
            cache['error_' + id] = true;
            this.error.apply(this, Array.prototype.slice.call(arguments, 1));
        }
        return this;
    },
    _console: console,
    /**
     * @private
     * @type {Object}
     */
    get console() {
        return this._console;
    },
    set console(value) {
        this._console = value;
    }
};

export default log;
