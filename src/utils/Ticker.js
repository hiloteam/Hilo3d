/**
 * Ticker是一个定时器类。它可以按指定帧率重复运行，从而按计划执行代码。
 * @class  Ticker
 * @see  {@link http://hiloteam.github.io/Hilo/docs/api-zh/symbols/Ticker.html}
 */
import Ticker from 'hilojs/util/Ticker';

/**
 * 添加定时器对象。定时器对象必须实现 tick 方法。
 * @memberOf Ticker.prototype
 * @method addTick
 * @param {Object} tickObject
 */

/**
 * 删除定时器对象。
 * @memberOf Ticker.prototype
 * @method removeTick
 * @param {Object} tickObject
 */

/**
 * 开始计时器
 * @memberOf Ticker.prototype
 * @method start
 */

/**
 * 停止计时器
 * @memberOf Ticker.prototype
 * @method stop
 */

/**
 * 暂停计时器
 * @memberOf Ticker.prototype
 * @method pause
 */

/**
 * 恢复计时器
 * @memberOf Ticker.prototype
 * @method resume
 */

/**
 * 延迟指定的时间后调用回调, 类似setTimeout
 * @memberOf Ticker.prototype
 * @method timeout
 * @param {Function} callback
 * @param {number} duration 时间周期，单位毫秒
 * @returns {Object} tickObject 定时器对象
 */

/**
 * 指定的时间周期来调用函数, 类似setInterval
 * @memberOf Ticker.prototype
 * @method interval
 * @param {Function} callback
 * @param {number} duration 时间周期，单位毫秒
 * @returns {Object} tickObject 定时器对象
 */

/**
 * 下次tick时回调
 * @memberOf Ticker.prototype
 * @method nextTick
 * @param {Function} callback
 * @returns {Object} tickObject 定时器对象
 */

/**
 * 获得测定的运行时帧率。
 * @memberOf Ticker.prototype
 * @method getMeasuredFPS
 * @returns {number}
 */


export default Ticker;
