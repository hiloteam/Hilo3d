import Light, { type LightParameters } from './Light';
import CubeLightShadow from './CubeLightShadow';
import type Camera from '../camera/Camera';
import type WebGLRenderer from '../renderer/WebGLRenderer';

export type PointLightParameters = LightParameters;
/**
 * 点光源
 */
class PointLight extends Light {
    static override readonly typeName = 'PointLight';
    override isPointLight = true;
    override className = 'PointLight';
    lightShadow: CubeLightShadow | null = null;
    /**
     * @param params - 创建对象的属性参数。可包含此类的所有属性。
     * - `params.color`: 光颜色
     * - `params.amount`: 光强度
     * - `params.range`: 光照范围, 0 时代表光照范围无限大。
     */
    constructor(params: PointLightParameters = {}) {
        super();
        Object.assign(this, params);
    }
    override createShadowMap(renderer: WebGLRenderer, camera: Camera): void {
        if (!this.shadow) {
            return;
        }
        if (!this.lightShadow) {
            this.lightShadow = new CubeLightShadow({
                light: this,
                renderer
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
}
export default PointLight;
