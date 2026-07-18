import Light, { type LightParameters } from './Light';
import DataTexture from '../texture/DataTexture';
import ltcTextureData from './assets/ltcTexture.json';

export interface AreaLightParameters extends LightParameters {
    width?: number;
    height?: number;
}
/**
 * 面光源
 */
class AreaLight extends Light {
    static override readonly typeName = 'AreaLight';
    /**
     * ltcTexture1
     */
    static ltcTexture1: DataTexture | null = null;
    /**
     * ltcTexture2
     */
    static ltcTexture2: DataTexture | null = null;
    /**
     * ltcTexture 是否加载完成
     */
    static ltcTextureReady = false;
    /**
     * 初始化 ltcTexture
     */
    static initializeLtcTexture(): void {
        if (this.ltcTextureReady) return;
        this.ltcTexture1 = new DataTexture({ data: ltcTextureData.ltcTexture1 });
        this.ltcTexture2 = new DataTexture({ data: ltcTextureData.ltcTexture2 });
        this.ltcTextureReady = true;
    }
    override isAreaLight = true;
    override className = 'AreaLight';
    /**
     * width
     */
    width = 10;
    /**
     * height
     */
    height = 10;
    override get enabled(): boolean {
        return this.enabledValue && AreaLight.ltcTextureReady;
    }
    override set enabled(value: boolean) {
        this.enabledValue = value;
    }
    /**
     * @param params - 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params: AreaLightParameters = {}) {
        super();
        Object.assign(this, params);
        AreaLight.initializeLtcTexture();
    }
    /**
     * ltcTexture1
     */
    get ltcTexture1(): DataTexture | null {
        return AreaLight.ltcTexture1;
    }
    /**
     * ltcTexture1
     */
    set ltcTexture1(texture: DataTexture | null) {
        AreaLight.ltcTexture1 = texture;
    }
    /**
     * ltcTexture1
     */
    get ltcTexture2(): DataTexture | null {
        return AreaLight.ltcTexture2;
    }
    /**
     * ltcTexture1
     */
    set ltcTexture2(texture: DataTexture | null) {
        AreaLight.ltcTexture2 = texture;
    }
}
export default AreaLight;
