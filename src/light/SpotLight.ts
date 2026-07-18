import Light, { type ShadowCastingLightParameters } from './Light';
import math from '../math/math';
import Matrix4 from '../math/Matrix4';
import Vector3 from '../math/Vector3';
import type Camera from '../camera/Camera';

const tempMatrix4 = new Matrix4();
const tempVector3 = new Vector3();

export interface SpotLightParameters extends ShadowCastingLightParameters {
    direction?: Vector3;
    cutoff?: number;
    outerCutoff?: number;
}
/**
 * 聚光灯
 */
class SpotLight extends Light {
    static override readonly typeName = 'SpotLight';
    override isSpotLight = true;
    override className = 'SpotLight';
    direction: Vector3;
    private cutoffCosine = Math.cos(math.degToRad(12.5));
    private cutoffDegrees = 12.5;
    /**
     * 切光角(角度)，落在这个角度之内的光亮度为1
     */
    get cutoff(): number {
        return this.cutoffDegrees;
    }
    /**
     * 切光角(角度)，落在这个角度之内的光亮度为1
     */
    set cutoff(value: number) {
        this.validateConeAngle(value, 'cutoff');
        this.cutoffDegrees = value;
        this.cutoffCosine = Math.cos(math.degToRad(value));
    }
    private outerCutoffCosine = Math.cos(math.degToRad(17.5));
    private outerCutoffDegrees = 17.5;
    /**
     * 外切光角(角度)，在切光角合外切光角之间的光亮度渐变到0
     */
    get outerCutoff(): number {
        return this.outerCutoffDegrees;
    }
    /**
     * 外切光角(角度)，在切光角合外切光角之间的光亮度渐变到0
     */
    set outerCutoff(value: number) {
        this.validateConeAngle(value, 'outerCutoff');
        this.outerCutoffDegrees = value;
        this.outerCutoffCosine = Math.cos(math.degToRad(value));
    }

    get cutoffCos(): number {
        return this.cutoffCosine;
    }

    get outerCutoffCos(): number {
        return this.outerCutoffCosine;
    }

    private validateConeAngle(value: number, property: string): void {
        if (!Number.isFinite(value) || value < 0 || value > 180) {
            throw new RangeError(`SpotLight.${property} must be between 0 and 180 degrees.`);
        }
    }
    /**
     * @param params - 创建对象的属性参数。可包含此类的所有属性。
     * - `params.color`: 光颜色
     * - `params.amount`: 光强度
     * - `params.range`: 光照范围, 0 时代表光照范围无限大。
     * - `params.direction`: 光方向
     * - `params.cutoff`: 切光角(角度)，落在这个角度之内的光亮度为1
     * - `params.outerCutoff`: 外切光角(角度)，在切光角合外切光角之间的光亮度渐变到0
     */
    constructor(params: SpotLightParameters = {}) {
        super();
        /**
         * 光方向
         */
        this.direction = new Vector3(0, 0, 1);
        Object.assign(this, params);
    }
    getWorldDirection(): Vector3 {
        tempVector3.copy(this.direction).transformDirection(this.worldMatrix).normalize();
        return tempVector3;
    }
    getViewDirection(camera: Camera): Vector3 {
        const modelViewMatrix = camera.getModelViewMatrix(this, tempMatrix4);
        tempVector3.copy(this.direction).transformDirection(modelViewMatrix).normalize();
        return tempVector3;
    }
}
export default SpotLight;
