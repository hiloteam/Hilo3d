import Light from './Light';
import LightShadow from './LightShadow';
import Matrix4 from '../math/Matrix4';
import Vector3 from '../math/Vector3';

const tempMatrix4 = new Matrix4();
const tempVector3 = new Vector3();

/**
 * 平行光
 * @class
 * @extends Light
 */
class DirectionalLight extends Light {
    /**
     * @default true
     * @type {boolean}
     */
    readonly isDirectionalLight: boolean = true;

    /**
     * @default DirectionalLight
     * @type {string}
     */
    readonly className: string = 'DirectionalLight';

    /**
     * 光源阴影
     * @type {LightShadow}
     * @default null
     */
    lightShadow: LightShadow | null = null;

    /**
     * 光方向
     * @type {Vector3}
     * @default new Vector3(0, 0, 1)
     */
    direction: Vector3;

    /**
     * @constructs
     * @param {Object} [params] 创建对象的属性参数。可包含此类的所有属性。
     * @param {Color} [params.color=new Color(1, 1, 1)] 光颜色
     * @param {number} [params.amount=1] 光强度
     * @param {Vector3} [params.direction=new Vector3(0, 0, 1)] 光方向
     * @param {any} [params.[value:string]] 其它属性
     */
    constructor(params?: any) {
        super(params);
        this.direction = new Vector3(0, 0, 1);
    }

    createShadowMap(renderer: any, camera: any): void {
        if (!this.shadow) {
            return;
        }
        if (!this.lightShadow) {
            this.lightShadow = new LightShadow({
                light: this,
                renderer,
                width: this.shadow.width || renderer.width,
                height: this.shadow.height || renderer.height,
                debug: this.shadow.debug,
                cameraInfo: this.shadow.cameraInfo
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

    /**
    * 获取世界空间方向
    * @returns {Vector3}
    */
    getWorldDirection(): Vector3 {
        tempVector3.copy(this.direction).transformDirection(this.worldMatrix).normalize();
        return tempVector3;
    }

    /**
     * 获取相机空间方向
     * @param {Camera} camera
     * @returns {Vector3}
     */
    getViewDirection(camera: any): Vector3 {
        const modelViewMatrix = camera.getModelViewMatrix(this, tempMatrix4);
        tempVector3.copy(this.direction).transformDirection(modelViewMatrix).normalize();
        return tempVector3;
    }
}

export default DirectionalLight;
