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
    /** Optional analytic projected cookie for native clustered lighting. */
    cookie?: Readonly<SpotLightCookie> | null;
    /** Optional normalized axial IES fit for native clustered lighting. */
    iesProfile?: Readonly<SpotLightIESProfile> | null;
}

/** Analytic projected cookie carried by the high-end clustered-light ABI. */
export interface SpotLightCookie {
    /** Projected half-extent on the light plane. */
    readonly scale?: readonly [number, number];
    /** Projected cookie-center offset. */
    readonly offset?: readonly [number, number];
    /** Cookie multiplier. Defaults to one. */
    readonly intensity?: number;
    /** Edge transition as a fraction of the cookie extent. Defaults to 0.1. */
    readonly softness?: number;
}

/** Compact axial fit for an imported IES photometric profile. */
export interface SpotLightIESProfile {
    /** Candela multiplier after normalization. Defaults to one. */
    readonly intensity?: number;
    /** Axial concentration exponent. Defaults to one. */
    readonly exponent?: number;
}
/**
 * 聚光灯
 */
class SpotLight extends Light {
    static override readonly typeName = 'SpotLight';
    override isSpotLight = true;
    override className = 'SpotLight';
    direction: Vector3;
    private cookieValue: Readonly<Required<SpotLightCookie>> | null = null;
    private iesProfileValue: Readonly<Required<SpotLightIESProfile>> | null = null;

    /** Analytic projected cookie used by native clustered Spot lighting. */
    get cookie(): Readonly<Required<SpotLightCookie>> | null {
        return this.cookieValue;
    }

    /** Analytic projected cookie used by native clustered Spot lighting. */
    set cookie(value: Readonly<SpotLightCookie> | null) {
        if (value === null) {
            this.cookieValue = null;
            return;
        }
        const scale = value.scale ?? [1, 1];
        const offset = value.offset ?? [0, 0];
        const intensity = value.intensity ?? 1;
        const softness = value.softness ?? 0.1;
        if (
            !Number.isFinite(scale[0]) ||
            !Number.isFinite(scale[1]) ||
            scale[0] <= 0 ||
            scale[1] <= 0
        ) {
            throw new RangeError('SpotLight.cookie scale must contain two positive numbers.');
        }
        if (!Number.isFinite(offset[0]) || !Number.isFinite(offset[1])) {
            throw new RangeError('SpotLight.cookie offset must contain two finite numbers.');
        }
        if (!Number.isFinite(intensity) || intensity < 0) {
            throw new RangeError('SpotLight.cookie intensity must be finite and non-negative.');
        }
        if (!Number.isFinite(softness) || softness < 0 || softness > 1) {
            throw new RangeError('SpotLight.cookie softness must be between zero and one.');
        }
        const normalizedScale: readonly [number, number] = Object.freeze([scale[0], scale[1]]);
        const normalizedOffset: readonly [number, number] = Object.freeze([offset[0], offset[1]]);
        this.cookieValue = Object.freeze({
            scale: normalizedScale,
            offset: normalizedOffset,
            intensity,
            softness
        });
    }

    /** Normalized axial IES fit used by native clustered Spot lighting. */
    get iesProfile(): Readonly<Required<SpotLightIESProfile>> | null {
        return this.iesProfileValue;
    }

    /** Normalized axial IES fit used by native clustered Spot lighting. */
    set iesProfile(value: Readonly<SpotLightIESProfile> | null) {
        if (value === null) {
            this.iesProfileValue = null;
            return;
        }
        const intensity = value.intensity ?? 1;
        const exponent = value.exponent ?? 1;
        if (!Number.isFinite(intensity) || intensity < 0) {
            throw new RangeError('SpotLight.iesProfile intensity must be finite and non-negative.');
        }
        if (!Number.isFinite(exponent) || exponent < 0) {
            throw new RangeError('SpotLight.iesProfile exponent must be finite and non-negative.');
        }
        this.iesProfileValue = Object.freeze({ intensity, exponent });
    }
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
