/* eslint prefer-spread: "off", prefer-rest-params:"off", no-console:"off" */

const cache = {};
const LEVEL_NONE = 0;
const LEVEL_ERROR = 1;
const LEVEL_WARN = 2;
const LEVEL_LOG = 3;

/**
 * log
 * @namespace
 */
const log = {
    _cache: cache,
    /**
     * log级别
     * @type {Enum}
     */
    level: LEVEL_LOG,
    /**
     * 显示log, warn, error
     */
    LEVEL_LOG,
    /**
     * 显示warn, error
     */
    LEVEL_WARN,
    /**
     * 显示error
     */
    LEVEL_ERROR,
    /**
     * 不显示log, warn, error
     */
    LEVEL_NONE,
    /**
     * log，等同 console.log
     * @return {Object} this
     */
    log() {
        if (this.level >= LEVEL_LOG) {
            console.log.apply(console, arguments);
        }
        return this;
    },
    /**
     * log，等同 console.log
     * @return {Object} this
     */
    warn() {
        if (this.level >= LEVEL_WARN) {
            console.warn.apply(console, arguments);
        }
        return this;
    },
    /**
     * error，等同 console.log
     * @return {Object} this
     */
    error() {
        if (this.level >= LEVEL_ERROR) {
            console.error.apply(console, arguments);
        }
        return this;
    },
    /**
     * logOnce 相同 id 只 log 一次
     * @param {String} id
     * @return {Object} this
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
     * @return {Object} this
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
     * @return {Object} this
     */
    errorOnce(id) {
        if (!cache['error_' + id]) {
            cache['error_' + id] = true;
            this.error.apply(this, Array.prototype.slice.call(arguments, 1));
        }
        return this;
    }
};

export default log;
