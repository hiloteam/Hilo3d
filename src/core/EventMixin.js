import Class from './Class';

/**
 * 事件对象
 * @interface EventObject
 * @property {String} type 事件类型
 * @property {any} [detail=null] 事件数据
 */
const EventObject = Class.create({
    constructor(type, target, detail) {
        this.type = type;
        this.target = target;
        this.detail = detail;
        this.timeStamp = +new Date();
    },

    type: null,
    target: null,
    detail: null,
    timeStamp: 0,

    stopImmediatePropagation() {
        this._stopped = true;
    }
});

/**
 * EventMixin是一个包含事件相关功能的mixin。可以通过 Object.assign(target, EventMixin) 来为target增加事件功能。
 * @class EventMixin
 */
const EventMixin = /** @lends EventMixin# */ {
    _listeners: null,

    /**
     * 增加一个事件监听。
     * @name EventMixin#on
     * @function
     * @param {String} type 要监听的事件类型。
     * @param {EventMixinCallback} listener 事件监听回调函数。
     * @param {Boolean} [once] 是否是一次性监听，即回调函数响应一次后即删除，不再响应。
     * @return {any} 对象本身。链式调用支持。
     */
    on(type, listener, once) {
        let listeners = (this._listeners = this._listeners || {});
        let eventListeners = (listeners[type] = listeners[type] || []);
        for (let i = 0, len = eventListeners.length; i < len; i++) {
            let el = eventListeners[i];
            if (el.listener === listener) {
                return this;
            }
        }
        eventListeners.push({
            listener,
            once
        });
        return this;
    },

    /**
     * 删除一个事件监听。如果不传入任何参数，则删除所有的事件监听；如果不传入第二个参数，则删除指定类型的所有事件监听。
     * @name EventMixin#off
     * @function
     * @param {String} [type] 要删除监听的事件类型。
     * @param {EventMixinCallback} [listener] 要删除监听的回调函数。
     * @returns {any} 对象本身。链式调用支持。
     */
    off(type, listener) {
        // remove all event listeners
        if (arguments.length === 0) {
            this._listeners = null;
            return this;
        }

        let eventListeners = this._listeners && this._listeners[type];
        if (eventListeners && eventListeners.length > 0) {
            // remove event listeners by specified type
            if (arguments.length === 1) {
                delete this._listeners[type];
                return this;
            }

            for (let i = 0, len = eventListeners.length; i < len; i++) {
                let el = eventListeners[i];
                if (el.listener === listener) {
                    eventListeners.splice(i, 1);
                    break;
                }
            }
        }
        return this;
    },

    /**
     * 发送事件。当第一个参数类型为Object时，则把它作为一个整体事件对象。
     * @name EventMixin#fire
     * @function
     * @param {String|EventObject} [type] 要发送的事件类型或者一个事件对象。
     * @param {Object} [detail] 要发送的事件的具体信息，即事件随带参数。
     * @returns {Boolean} 是否成功调度事件。
     */
    fire(type, detail) {
        let event; let
            eventType;
        if (typeof type === 'string') {
            eventType = type;
        } else {
            event = type;
            eventType = type.type;
        }

        let listeners = this._listeners;
        if (!listeners) return false;

        let eventListeners = listeners[eventType];
        if (eventListeners && eventListeners.length > 0) {
            let eventListenersCopy = eventListeners.slice(0);
            event = event || new EventObject(eventType, this, detail);
            if (event._stopped) return false;

            for (let i = 0; i < eventListenersCopy.length; i++) {
                let el = eventListenersCopy[i];
                el.listener.call(this, event);
                if (el.once) {
                    let index = eventListeners.indexOf(el);
                    if (index > -1) {
                        eventListeners.splice(index, 1);
                    }
                }
            }

            return true;
        }
        return false;
    }
};

/**
 * @callback EventMixinCallback
 * @param {Object} [e] 事件对象
 * @param {string} e.type 事件类型
 * @param {any} e.detail 事件数据
 * @param {any} e.target 事件触发对象
 * @param {number} e.timeStamp 时间戳
 * @param {number} e.stageX 鼠标相对 stage 的 x 偏移 ( 仅鼠标事件有效 )
 * @param {number} e.stageY 鼠标相对 stage 的 y 偏移 ( 仅鼠标事件有效 )
 * @param {Node} e.eventTarget 触发鼠标事件的对象 ( 仅鼠标事件有效 )
 * @param {Node} e.eventCurrentTarget 监听鼠标事件的对象 ( 仅鼠标事件有效 )
 * @param {Vector3} e.hitPoint 鼠标碰撞点 ( 仅鼠标事件有效 )
 */

export default EventMixin;
