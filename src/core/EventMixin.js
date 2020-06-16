import EventMixin from 'hilojs/event/EventMixin';

/**
 * EventMixin是一个包含事件相关功能的mixin。可以通过 Object.assign(target, EventMixin) 来为target增加事件功能。
 * @class EventMixin
 * @see {@link https://hiloteam.github.io/Hilo/docs/api-zh/symbols/EventMixin.html}
 */
export default EventMixin;

/**
 * 增加一个事件监听。
 * @name EventMixin#on
 * @function
 * @param {String} type 要监听的事件类型。
 * @param {EventMixinCallback} listener 事件监听回调函数。
 * @param {Boolean} [once] 是否是一次性监听，即回调函数响应一次后即删除，不再响应。
 * @returns {any} 对象本身。链式调用支持。
 */


/**
 * 删除一个事件监听。如果不传入任何参数，则删除所有的事件监听；如果不传入第二个参数，则删除指定类型的所有事件监听。
 * @name EventMixin#off
 * @function
 * @param {String} [type] 要删除监听的事件类型。
 * @param {EventMixinCallback} [listener] 要删除监听的回调函数。
 * @returns {any} 对象本身。链式调用支持。
*/

/**
 * 发送事件。当第一个参数类型为Object时，则把它作为一个整体事件对象。
 * @name EventMixin#fire
 * @function
 * @param {String|EventObject} [type] 要发送的事件类型或者一个事件对象。
 * @param {Object} [detail] 要发送的事件的具体信息，即事件随带参数。
 * @returns {Boolean} 是否成功调度事件。
 */

/**
 * 事件对象
 * @interface EventObject
 * @property {String} type 事件类型
 * @property {any} [detail=null] 事件数据
 */

/**
 * @callback EventMixinCallback
 * @param {Object} [e] 事件对象
 * @param {String} e.type 事件类型
 * @param {Object} e.detail 事件数据
 * @param {Object} e.target 事件触发对象
 * @param {Date} e.timeStamp 时间戳
 */
