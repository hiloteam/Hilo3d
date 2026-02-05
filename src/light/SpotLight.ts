import Class from '../core/Class';
import Light from './Light';
import LightShadow from './LightShadow';
import math from '../math/math';
import Matrix4 from '../math/Matrix4';
import Vector3 from '../math/Vector3';

const tempMatrix4 = new Matrix4();
const tempVector3 = new Vector3();

/**
 * 聚光灯
 * @class
 * @extends Light
 */
const SpotLight = Class.create(/** @lends SpotLight.prototype */{
    Extends: Light,
    /**
     * @default true
     * @type {boolean}
     */
    isSpotLight: true,
    /**
     * @default SpotLight
     * @type {string}
     */
    className: 'SpotLight',
    _cutoffCos: 0.9763,
    _cutoff: 12.5,
    /**
     * 切光角(角度)，落在这个角度之内的光亮度为1
     * @default 12.5
     * @type {number}
     */
    cutoff: {
        get() {
            return this._cutoff;
        },
        set(value) {
            this._cutoff = value;
            this._cutoffCos = Math.cos(math.degToRad(value));
        }
    },
    _outerCutoffCos: 0.9537,
    _outerCutoff: 17.5,
    /**
     * 外切光角(角度)，在切光角合外切光角之间的光亮度渐变到0
     * @default 17.5
     * @type {number}
     */
    outerCutoff: {
        get() {
            return this._outerCutoff;
        },
        set(value) {
            this._outerCutoff = value;
            this._outerCutoffCos = Math.cos(math.degToRad(value));
        }
    },

    /**
     * @constructs
     * @param {Object} [params] 创建对象的属性参数。可包含此类的所有属性。
     * @param {Color} [params.color=new Color(1, 1, 1)] 光颜色
     * @param {number} [params.amount=1] 光强度
     * @param {number} [params.range=0] 光照范围, 0 时代表光照范围无限大。
     * @param {Vector3} [params.direction=new Vector3(0, 0, 1)] 光方向
     * @param {number} [params.cutoff=12.5] 切光角(角度)，落在这个角度之内的光亮度为1
     * @param {number} [params.outerCutoff=17.5] 外切光角(角度)，在切光角合外切光角之间的光亮度渐变到0
     * @param {any} [params.[value:string]] 其它属性
     */
    constructor(params) {
        /**
         * 光方向
         * @type {Vector3}
         * @default new Vector3(0, 0, 1)
         */
        this.direction = new Vector3(0, 0, 1);
        SpotLight.superclass.constructor.call(this, params);
    },
    createShadowMap(renderer, camera) {
        if (!this.shadow) {
            return;
        }
        if (!this.lightShadow) {
            this.lightShadow = new LightShadow({
                light: this,
                renderer,
                width: this.shadow.width || renderer.width,
                height: this.shadow.height || renderer.height,
                debug: this.shadow.debug,
                cameraInfo: this.shadow.cameraInfo
            });
            if ('minBias' in this.shadow) {
                this.lightShadow.minBias = this.shadow.minBias;
            }
            if ('maxBias' in this.shadow) {
                this.lightShadow.maxBias = this.shadow.maxBias;
            }
        }
        this.lightShadow.createShadowMap(camera);
    },
    getWorldDirection() {
        tempVector3.copy(this.direction).transformDirection(this.worldMatrix).normalize();
        return tempVector3;
    },
    getViewDirection(camera) {
        const modelViewMatrix = camera.getModelViewMatrix(this, tempMatrix4);
        tempVector3.copy(this.direction).transformDirection(modelViewMatrix).normalize();
        return tempVector3;
    }
});

export default SpotLight;
