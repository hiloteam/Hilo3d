import Light, { type LightParameters } from './Light';

export type AmbientLightParameters = LightParameters;
/**
 * 环境光
 */
class AmbientLight extends Light {
    static override readonly typeName = 'AmbientLight';
    override isAmbientLight = true;
    override className = 'AmbientLight';
    override autoUpdateWorldMatrix = false;
    /**
     * @param params - 创建对象的属性参数。可包含此类的所有属性。
     * - `params.color`: 光颜色
     * - `params.amount`: 光强度
     */
    constructor(params: AmbientLightParameters = {}) {
        super();
        Object.assign(this, params);
    }
}
export default AmbientLight;
