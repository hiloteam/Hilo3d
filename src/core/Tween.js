/**
 * Tween类提供缓动功能。
 * @class  Tween
 * @param {Object} target 缓动对象。
 * @param {Object} fromProps 对象缓动的起始属性集合。
 * @param {Object} toProps 对象缓动的目标属性集合。
 * @param {TweenParams} params 缓动参数。可包含Tween类所有可写属性。
 * @property {Object} target 缓动目标。只读属性。
 * @property {number} duration 缓动总时长。单位毫秒。
 * @property {number} delay 缓动延迟时间。单位毫秒。
 * @property {boolean} paused 缓动是否暂停。默认为false。
 * @property {boolean} loop 缓动是否循环。默认为false。
 * @property {boolean} reverse 缓动是否反转播放。默认为false。
 * @property {number} repeat 缓动重复的次数。默认为0。
 * @property {number} repeatDelay 缓动重复的延迟时长。单位为毫秒。
 * @property {Function} ease 缓动变化函数。默认为null。
 * @property {number} time 缓动已进行的时长。单位毫秒。只读属性。
 * @property {Function} onStart 缓动开始回调函数。它接受1个参数：tween。默认值为null。
 * @property {Function} onUpdate 缓动更新回调函数。它接受2个参数：ratio和tween。默认值为null。
 * @property {Function} onComplete 缓动结束回调函数。它接受1个参数：tween。默认值为null。
 * @see {@link https://hiloteam.github.io/Hilo/docs/api-zh/symbols/Tween.html}
 * @example
 * Hilo.Tween.to(node, {
 *     x:100,
 *     y:20
 * }, {
 *     duration:1000,
 *     delay:500,
 *     ease:Hilo3d.Tween.Ease.Quad.EaseIn,
 *     onComplete:function(){
 *         console.log('complete');
 *     }
 * });
 */
import Tween from 'hilojs/tween/Tween';
import Ease from 'hilojs/tween/Ease';

/**
 * Ease类包含为Tween类提供各种缓动功能的函数。
 * @memberOf Tween
 * @property {TweenEaseObject} Back
 * @property {TweenEaseObject} Bounce
 * @property {TweenEaseObject} Circ
 * @property {TweenEaseObject} Cubic
 * @property {TweenEaseObject} Elastic
 * @property {TweenEaseObject} Expo
 * @property {TweenEaseObject} Linear
 * @property {TweenEaseObject} Quad
 * @property {TweenEaseObject} Quart
 * @property {TweenEaseObject} Quint
 * @property {TweenEaseObject} Sine
 * @see  {@link https://hiloteam.github.io/Hilo/docs/api-zh/symbols/Ease.html}
 */
Tween.Ease = Ease;

export default Tween;

/**
 * 启动缓动动画的播放。
 * @memberOf Tween.prototype
 * @method start
 * @returns {Tween} Tween变换本身。可用于链式调用。
 */

/**
 * 停止缓动动画的播放。
 * @memberOf Tween.prototype
 * @method stop
 * @returns {Tween} Tween变换本身。可用于链式调用。
 */

/**
 * 暂停缓动动画的播放。
 * @memberOf Tween.prototype
 * @method pause
 * @returns {Tween} Tween变换本身。可用于链式调用。
 */

/**
 * 恢复缓动动画的播放。
 * @memberOf Tween.prototype
 * @method resume
 * @returns {Tween} Tween变换本身。可用于链式调用。
 */

/**
 * 跳转Tween到指定的时间。
 * @memberOf Tween.prototype
 * @method seek
 * @param {number} time 指定要跳转的时间。取值范围为：0 - duraion。
 * @param {boolean} pause 是否暂停。
 * @returns {Tween} Tween变换本身。可用于链式调用。
 */

/**
 * 连接下一个Tween变换。其开始时间根据delay值不同而不同。当delay值为字符串且以'+'或'-'开始时，Tween的开始时间从当前变换结束点计算，否则以当前变换起始点计算。
 * @memberOf Tween.prototype
 * @method link
 * @param {Tween} tween 要连接的Tween变换。
 * @returns {Tween} 下一个Tween。可用于链式调用。
 */

/**
 * 更新所有Tween实例。
 * @memberOf Tween
 * @method tick
 * @returns {any} Tween
 */

/**
 * @memberOf Tween
 * @method add
 * @returns {any} Tween
 */

/**
 * @memberOf Tween
 * @method remove
 * @returns {any} Tween
 */

/**
 * @memberOf Tween
 * @method removeAll
 * @returns {any} Tween
 */

/**
 * 创建一个缓动动画，让目标对象从开始属性变换到目标属性。
 * @memberOf Tween
 * @method fromTo
 * @param {Object|Array} target 缓动目标对象或缓动目标数组。
 * @param {Object} fromProps 缓动目标对象的开始属性。
 * @param {Object} toProps 缓动目标对象的目标属性。
 * @param {TweenParams} params 缓动动画的参数。
 * @returns {Tween|Array} 一个Tween实例对象或Tween实例数组。
 */


/**
 * 创建一个缓动动画，让目标对象从当前属性变换到目标属性。
 * @memberOf Tween
 * @method to
 * @param {Object|Array} target 缓动目标对象或缓动目标数组。
 * @param {Object} toProps 缓动目标对象的目标属性。
 * @param {TweenParams} params 缓动动画的参数。
 * @returns {Tween|Array} 一个Tween实例对象或Tween实例数组。
 */


/**
 * 创建一个缓动动画，让目标对象从指定的起始属性变换到当前属性。
 * @memberOf Tween
 * @method from
 * @param {Object|Array} target 缓动目标对象或缓动目标数组。
 * @param {Object} fromProps 缓动目标对象的初始属性。
 * @param {TweenParams} params 缓动动画的参数。
 * @returns {Tween|Array} 一个Tween实例对象或Tween实例数组。
 */

/**
 * @interface TweenParams
 * @property {number} duration
 * @property {number|String} [delay]
 * @property {Function} [ease]
 * @property {Function} [onStart]
 * @property {Function} [onComplete]
 * @property {Function} [onUpdate]
 * @property {boolean} [loop=false]
 * @property {boolean} [reverse=false]
 * @property {number} [repeat=0]
 */


/**
 * @interface TweenEaseObject
 * @property {Function} EaseIn
 * @property {Function} EaseOut
 * @property {Function} EaseInOut
 */
