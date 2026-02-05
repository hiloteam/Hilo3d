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
class SpotLight extends Light {
    /**
     * @default true
     * @type {boolean}
     */
    readonly isSpotLight: boolean = true;

    /**
     * @default SpotLight
     * @type {string}
     */
    readonly className: string = 'SpotLight';

    lightShadow: LightShadow | null = null;

    private _cutoffCos: number = 0.9763;

    private _cutoff: number = 12.5;

    /**
     * 切光角(角度)，落在这个角度之内的光亮度为1
     * @default 12.5
     * @type {number}
     */
    get cutoff(): number {
        return this._cutoff;
    }

    set cutoff(value: number) {
        this._cutoff = value;
        this._cutoffCos = Math.cos(math.degToRad(value));
    }

    private _outerCutoffCos: number = 0.9537;

    private _outerCutoff: number = 17.5;

    /**
     * 外切光角(角度)，在切光角合外切光角之间的光亮度渐变到0
     * @default 17.5
     * @type {number}
     */
    get outerCutoff(): number {
        return this._outerCutoff;
    }

    set outerCutoff(value: number) {
        this._outerCutoff = value;
        this._outerCutoffCos = Math.cos(math.degToRad(value));
    }

    /**
     * 光方向
     * @type {Vector3}
     * @default new Vector3(0, 0, 1)
     */
    direction: Vector3;

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
    constructor(params?: any) {
        super(params);
        this.direction = new Vector3(0, 0, 1);
    }

    createShadowMap(renderer: any, camera: any): void {
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
    }

    getWorldDirection(): Vector3 {
        tempVector3.copy(this.direction).transformDirection(this.worldMatrix).normalize();
        return tempVector3;
    }

    getViewDirection(camera: any): Vector3 {
        const modelViewMatrix = camera.getModelViewMatrix(this, tempMatrix4);
        tempVector3.copy(this.direction).transformDirection(modelViewMatrix).normalize();
        return tempVector3;
    }
}

export default SpotLight;
