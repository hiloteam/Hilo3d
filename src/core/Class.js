/**
 * Class是提供类的创建的辅助工具。
 * @namespace Class
 * @example
 * const Bird = Hilo3d.Class.create({
 *     Extends: Animal,
 *     Mixes: EventMixin,
 *     constructor: function(name){
 *         this.name = name;
 *     },
 *     fly: function(){
 *         console.log('I am flying');
 *     },
 *     Statics: {
 *         isBird: function(bird){
 *             return bird instanceof Bird;
 *         }
 *     }
 * });
 *
 * const swallow = new Bird('swallow');
 * swallow.fly();
 * Bird.isBird(swallow);
 */
const Class = (function() {
    let defineProperty;
    let defineProperties;
    try {
        defineProperty = Object.defineProperty;
        defineProperties = Object.defineProperties;
        defineProperty({}, '$', {
            value: 0
        });
    } catch (e) {
        if ('__defineGetter__' in Object) {
            defineProperty = function(obj, prop, desc) {
                if ('value' in desc) obj[prop] = desc.value;
                if ('get' in desc) obj.__defineGetter__(prop, desc.get); // eslint-disable-line
                if ('set' in desc) obj.__defineSetter__(prop, desc.set); // eslint-disable-line
                return obj;
            };
            defineProperties = function(obj, props) {
                for (const prop in props) {
                    if (props.hasOwnProperty(prop)) { // eslint-disable-line
                        defineProperty(obj, prop, props[prop]);
                    }
                }
                return obj;
            };
        }
    }

    /**
     * 混入属性或方法。
     * @memberOf Class
     * @method mix
     * @param {any} target 混入目标对象。
     * @param {...any} source 要混入的属性和方法来源。可支持多个来源参数。
     * @returns {any} 混入目标对象。
     */
    const mix = function(target) {
        for (let i = 1, len = arguments.length; i < len; i++) {
            const source = arguments[i];
            let defineProps;
            for (const key in source) {
                const prop = source[key];
                if (prop && typeof prop === 'object') {
                    if (prop.value !== undefined || typeof prop.get === 'function' || typeof prop.set === 'function') {
                        defineProps = defineProps || {};
                        defineProps[key] = prop;
                        continue;
                    }
                }
                target[key] = prop;
            }
            if (defineProps) defineProperties(target, defineProps);
        }

        return target;
    };

    const createProto = (function() {
        if (Object.__proto__) { // eslint-disable-line
            return function(proto) {
                return {
                    __proto__: proto
                };
            };
        }
        const Ctor = function() {};
        return function(proto) {
            Ctor.prototype = proto;
            return new Ctor();
        };
    }());

    const classMutators = /** @ignore */ {
        Extends(parent) {
            const existed = this.prototype;
            const proto = createProto(parent.prototype);
            // inherit static properites
            mix(this, parent);
            // keep existed properties
            mix(proto, existed);
            // correct constructor
            proto.constructor = this;
            // prototype chaining
            this.prototype = proto;
            // shortcut to parent's prototype
            this.superclass = parent.prototype;
        },

        Mixes(items) {
            if (!(items instanceof Array)) {
                items = [items];
            }
            const proto = this.prototype;
            let item;

            while (item = items.shift()) { // eslint-disable-line
                mix(proto, item.prototype || item);
            }
        },

        Statics(properties) {
            mix(this, properties);
        }
    };

    const implement = function(properties) {
        const proto = {};
        let value; let
            key;
        for (key in properties) {
            value = properties[key];
            if (classMutators.hasOwnProperty(key)) { // eslint-disable-line
                classMutators[key].call(this, value);
            } else {
                proto[key] = value;
            }
        }

        mix(this.prototype, proto);
    };

    /**
     * 根据参数指定的属性和方法创建类。
     * @memberOf Class
     * @method create
     * @param {Object} params 要创建的类的相关属性和方法。
     * @param {Object} [params.Statics] 指定类的静态属性或方法。
     * @param {Object} [params.Extends] 指定要继承的父类。
     * @param {Object} [params.Mixes] 指定要混入的成员集合对象
     * @param {Function} [params.constructor] 构造函数
     * @param {any} [params.[value:string]] 其他创建类的成员属性或方法。
     */
    const create = function(properties) {
        properties = properties || {};
        const clazz = properties.hasOwnProperty('constructor') ? properties.constructor : function() {}; // eslint-disable-line
        implement.call(clazz, properties);
        return clazz;
    };


    return {
        create,
        mix
    };
}());

export default Class;
