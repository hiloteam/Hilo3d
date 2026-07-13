import Light, { type ShadowCastingLightParameters } from './Light';
import Matrix4 from '../math/Matrix4';
import Vector3 from '../math/Vector3';
import type Camera from '../camera/Camera';

const tempMatrix4 = new Matrix4();
const tempVector3 = new Vector3();

export interface DirectionalLightParameters extends ShadowCastingLightParameters {
    direction?: Vector3;
}
/**
 * 平行光
 */
class DirectionalLight extends Light {
    static override readonly typeName = 'DirectionalLight';
    override isDirectionalLight = true;
    override className = 'DirectionalLight';
    direction: Vector3;
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
