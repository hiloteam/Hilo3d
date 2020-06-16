import Class from '../core/Class';
import Light from './Light';
import LightShadow from './LightShadow';
import Matrix4 from '../math/Matrix4';
import Vector3 from '../math/Vector3';

const tempMatrix4 = new Matrix4();
const tempVector3 = new Vector3();

/**
 * 平行光
 * @class
 * @extends Light
 */
const DirectionalLight = Class.create(/** @lends DirectionalLight.prototype */ {
    Extends: Light,
    /**
     * @default true
     * @type {boolean}
     */
    isDirectionalLight: true,
    /**
     * @default DirectionalLight
     * @type {string}
     */
    className: 'DirectionalLight',
    /**
     * @constructs
     * @param {Object} [params] 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params) {
        /**
         * 光方向
         * @type {Vector3}
         * @default new Vector3(0, 0, 1)
         */
        this.direction = new Vector3(0, 0, 1);
        DirectionalLight.superclass.constructor.call(this, params);
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

export default DirectionalLight;
