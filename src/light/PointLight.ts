import Light, { type PointLightShadowOptions, type ShadowCastingLightParameters } from './Light';

export type PointLightParameters = Omit<ShadowCastingLightParameters, 'shadow'> & {
    shadow?: PointLightShadowOptions | null;
};
/**
 * 点光源
 */
class PointLight extends Light {
    static override readonly typeName = 'PointLight';
    override isPointLight = true;
    override className = 'PointLight';
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
}
export default PointLight;
