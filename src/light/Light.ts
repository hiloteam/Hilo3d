import RenderTransformView, {
    type RenderTransformViewParameters
} from '../render/world/RenderTransformView';
import Color from '../math/Color';

const tempColor = new Color();

export interface ShadowCameraParameters {
    near?: number;
    far?: number;
    aspect?: number;
    fov?: number;
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
    x?: number;
    y?: number;
    z?: number;
    rotationX?: number;
    rotationY?: number;
    rotationZ?: number;
}

export interface LightShadowOptions {
    /** Display the shadow camera helper; it does not draw the shadow texture over the scene. */
    debug?: boolean;
    width?: number;
    height?: number;
    maxBias?: number;
    minBias?: number;
    cameraInfo?: ShadowCameraParameters;
}

export type PointShadowCameraParameters = Pick<ShadowCameraParameters, 'near' | 'far'>;
export interface PointLightShadowOptions extends Omit<LightShadowOptions, 'cameraInfo'> {
    /** Point shadows keep canonical 90-degree cube faces; only clipping planes are configurable. */
    cameraInfo?: PointShadowCameraParameters;
}

export interface LightParameters extends RenderTransformViewParameters {
    color?: Color;
    amount?: number;
    enabled?: boolean;
    constantAttenuation?: number;
    linearAttenuation?: number;
    quadraticAttenuation?: number;
    range?: number;
    isDirty?: boolean;
    /** Receiver-layer mask used by clustered lighting; defaults to every layer. */
    lightLayerMask?: number;
}

/** Parameters shared only by light kinds that implement shadows on every rendering backend. */
export interface ShadowCastingLightParameters extends LightParameters {
    shadow?: LightShadowOptions | null;
}
/**
 * 灯光基础类
 */
class Light extends RenderTransformView {
    static readonly typeName: string = 'RenderLight';
    isLight = true;
    isAmbientLight = false;
    isAreaLight = false;
    isDirectionalLight = false;
    isPointLight = false;
    isSpotLight = false;
    className = 'RenderLight';
    color: Color;
    /**
     * 光强度
     */
    amount = 1;
    private lightLayerMaskValue = 0xffffffff;

    /** Receiver-layer mask evaluated independently from camera/node visibility. */
    get lightLayerMask(): number {
        return this.lightLayerMaskValue;
    }

    set lightLayerMask(value: number) {
        if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
            throw new RangeError('Light.lightLayerMask must be an unsigned 32-bit integer.');
        }
        this.lightLayerMaskValue = value >>> 0;
    }
    /**
     * 是否开启灯光
     */
    protected enabledValue = true;

    get enabled(): boolean {
        return this.enabledValue;
    }

    set enabled(value: boolean) {
        this.enabledValue = value;
    }
    /**
     * 光常量衰减值, PointLight 和 SpotLight 时生效
     */
    constantAttenuation = 1;
    /**
     * 光线性衰减值, PointLight 和 SpotLight 时生效
     */
    linearAttenuation = 0;
    /**
     * 光二次衰减值, PointLight 和 SpotLight 时生效
     */
    quadraticAttenuation = 0;
    private rangeValue = 0;
    /**
     * 光照范围, PointLight 和 SpotLight 时生效, 0 时代表光照范围无限大。
     */
    get range(): number {
        return this.rangeValue;
    }
    /**
     * 光照范围, PointLight 和 SpotLight 时生效, 0 时代表光照范围无限大。
     */
    set range(value: number) {
        if (!Number.isFinite(value) || value < 0) {
            throw new RangeError('Light.range must be a finite, non-negative number.');
        }
        this.constantAttenuation = 1;
        if (value <= 0) {
            this.linearAttenuation = 0;
            this.quadraticAttenuation = 0;
        } else {
            this.linearAttenuation = 4.5 / value;
            this.quadraticAttenuation = 75 / (value * value);
        }
        this.rangeValue = value;
    }
    /**
     * 阴影生成参数，默认不生成阴影
     */
    private shadowValue: LightShadowOptions | null = null;

    get shadow(): LightShadowOptions | null {
        return this.shadowValue;
    }

    set shadow(value: LightShadowOptions | null) {
        if (value !== null && !this.isDirectionalLight && !this.isPointLight && !this.isSpotLight) {
            throw new TypeError(`${this.constructor.name} does not support shadow maps.`);
        }
        this.shadowValue = value;
    }
    /**
     * 是否光照信息变化
     */
    isDirty = false;
    private extractedWorldMatrix = false;
    /**
     * @param params - 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params: LightParameters = {}) {
        super('RenderLight');
        /**
         * 灯光颜色
         */
        this.color = new Color(1, 1, 1);
        Object.assign(this, params);
    }

    /** Synchronize this renderer-local view from ECS WorldTransform storage. @internal */
    override setExtractedWorldMatrix(
        source: ArrayLike<number>,
        offset: number,
        revision: number
    ): void {
        super.setExtractedWorldMatrix(source, offset, revision);
        this.extractedWorldMatrix = true;
        this.isDirty = true;
    }

    override updateMatrixWorld(force = false): this {
        return this.extractedWorldMatrix ? this : super.updateMatrixWorld(force);
    }
    /**
     * 获取光范围信息, PointLight 和 SpotLight 时生效
     * @param out - 信息接受数组
     * @param offset - 偏移值
     */
    toInfoArray(out: number[] | Float32Array, offset: number): this {
        out[offset] = this.constantAttenuation;
        out[offset + 1] = this.linearAttenuation;
        out[offset + 2] = this.quadraticAttenuation;
        return this;
    }
    /**
     * 获取真正的颜色，光强度乘以颜色
     * @returns 光强度乘以颜色后的颜色
     */
    getRealColor(): Color {
        return tempColor.copy(this.color).scale(this.amount);
    }
}
export default Light;
