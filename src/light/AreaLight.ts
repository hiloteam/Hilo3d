import Light, { type LightParameters } from './Light';
import Loader from '../loader/Loader';
import DataTexture from '../texture/DataTexture';

interface LtcTexturePayload {
    ltcTexture1: readonly number[];
    ltcTexture2: readonly number[];
}

function isLtcTexturePayload(value: unknown): value is LtcTexturePayload {
    if (value === null || typeof value !== 'object') return false;
    return (
        Array.isArray(Reflect.get(value, 'ltcTexture1')) &&
        Array.isArray(Reflect.get(value, 'ltcTexture2'))
    );
}

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
     * ltcTexture 地址
     */
    static ltcTextureUrl = '//g.alicdn.com/tmapp/static/4.0.63/ltcTexture.js';
    private static ltcTexturePromise: Promise<void> | null = null;
    /**
     * 初始化 ltcTexture
     */
    static loadLtcTexture(): Promise<void> {
        if (this.ltcTextureReady) return Promise.resolve();
        if (this.ltcTexturePromise) return this.ltcTexturePromise;

        const loader = new Loader();
        const promise = loader
            .load({
                type: 'json',
                src: this.ltcTextureUrl
            })
            .then(data => {
                if (!isLtcTexturePayload(data)) {
                    throw new TypeError('AreaLight LTC texture response has an invalid shape.');
                }
                this.ltcTexture1 = new DataTexture({
                    data: data.ltcTexture1
                });
                this.ltcTexture2 = new DataTexture({
                    data: data.ltcTexture2
                });
                this.ltcTextureReady = true;
            })
            .catch((error: unknown) => {
                this.ltcTexturePromise = null;
                throw error;
            });
        this.ltcTexturePromise = promise;
        return promise;
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
        void AreaLight.loadLtcTexture().catch(() => undefined);
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
