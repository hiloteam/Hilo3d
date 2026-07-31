import Light, { type LightShadowOptions, type ShadowCastingLightParameters } from './Light';
import Matrix4 from '../math/Matrix4';
import Vector3 from '../math/Vector3';
import type Camera from '../camera/Camera';

const tempMatrix4 = new Matrix4();
const tempVector3 = new Vector3();

/**
 * Directional-light shadow controls.
 *
 * Values greater than one for `cascadeCount` enable camera-relative cascaded shadow maps. Manual
 * `cameraInfo` bounds remain available for the single-cascade compatibility path.
 */
export interface DirectionalLightShadowOptions extends LightShadowOptions {
    /** Number of camera-frustum cascades. Defaults to `1`; the supported range is 1–4. */
    cascadeCount?: number;
    /**
     * Blend between uniform (`0`) and logarithmic (`1`) cascade split placement. Defaults to
     * `0.5`.
     */
    cascadeSplitLambda?: number;
    /** Maximum view-space shadow distance. Defaults to the active camera far plane. */
    cascadeMaxDistance?: number;
    /** Fraction of each cascade interval blended into the following cascade. Defaults to `0.1`. */
    cascadeBlend?: number;
    /** Snap automatic cascade projections to shadow texels. Defaults to `true`. */
    stabilizeCascades?: boolean;
    /**
     * Art-directed contrast applied to filtered directional-shadow occlusion. `1` preserves the
     * physically sampled visibility, values above `1` deepen partial PCF coverage, and `0`
     * disables the visible shadow contribution. Defaults to `1`; the supported range is 0–4.
     */
    shadowStrength?: number;
}

export interface DirectionalLightParameters extends Omit<ShadowCastingLightParameters, 'shadow'> {
    direction?: Vector3;
    shadow?: DirectionalLightShadowOptions | null;
}
/**
 * 平行光
 */
class DirectionalLight extends Light {
    static override readonly typeName = 'DirectionalLight';
    override isDirectionalLight = true;
    override className = 'DirectionalLight';
    direction: Vector3;
    /** Directional shadow options, including the optional cascaded-shadow controls. */
    override get shadow(): DirectionalLightShadowOptions | null {
        return super.shadow;
    }
    override set shadow(value: DirectionalLightShadowOptions | null) {
        super.shadow = value;
    }
    /**
     * @param params - 创建对象的属性参数。可包含此类的所有属性。
     * - `params.color`: 光颜色
     * - `params.amount`: 光强度
     * - `params.direction`: 光方向
     */
    constructor(params: DirectionalLightParameters = {}) {
        super();
        /**
         * 光方向
         */
        this.direction = new Vector3(0, 0, 1);
        Object.assign(this, params);
    }
    /**
     * 获取世界空间方向
     */
    getWorldDirection(): Vector3 {
        tempVector3.copy(this.direction).transformDirection(this.worldMatrix).normalize();
        return tempVector3;
    }
    /**
     * 获取相机空间方向
     * @param camera -
     */
    getViewDirection(camera: Camera): Vector3 {
        const modelViewMatrix = camera.getModelViewMatrix(this, tempMatrix4);
        tempVector3.copy(this.direction).transformDirection(modelViewMatrix).normalize();
        return tempVector3;
    }
}
export default DirectionalLight;
