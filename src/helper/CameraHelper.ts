import Mesh, { type MeshParameters } from '../core/Mesh';
import Geometry from '../geometry/Geometry';
import GeometryData from '../geometry/GeometryData';
import BasicMaterial from '../material/BasicMaterial';
import Vector3 from '../math/Vector3';
import Color from '../math/Color';
import { LINES } from '../constants/webgl';
import Matrix4 from '../math/Matrix4';
import type Camera from '../camera/Camera';
const tempVector3 = new Vector3();
const tempMatrix4 = new Matrix4();

export interface CameraHelperParameters extends MeshParameters {
    camera?: Camera | null;
    color?: Color;
}
/**
 * 摄像机帮助类
 * @example
 * ```ts
 * stage.addChild(new Hilo3d.CameraHelper());
 * ```
 */
class CameraHelper extends Mesh {
    static override readonly typeName: string = 'CameraHelper';
    isCameraHelper = true;
    override className = 'CameraHelper';
    camera: Camera | null = null;
    /**
     * 颜色
     */
    color = new Color(0.3, 0.9, 0.6);
    override onUpdate: ((deltaTime: number) => void) | null = () => {
        if (this.camera) {
            this.camera.updateViewProjectionMatrix();
            this._buildGeometry();
        }
    };
    /**
     * @param params - 初始化参数
     */
    constructor(params: CameraHelperParameters = {}) {
        super();
        Object.assign(this, params);
        this.material = new BasicMaterial({
            lightType: 'NONE',
            diffuse: this.color,
            castShadows: false
        });
        this.geometry = new Geometry({
            mode: LINES,
            isStatic: false,
            vertices: new GeometryData(new Float32Array(9 * 3), 3),
            indices: new GeometryData(
                new Uint16Array([
                    0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7, 8, 4, 8,
                    5, 8, 6, 8, 7
                ]),
                1
            )
        });
    }
    private _buildGeometry(): void {
        const camera = this.camera;
        const geometry = this.geometry;
        const vertices = geometry?.vertices;
        if (!camera || !vertices) return;
        const width = 1;
        const height = 1;
        const depth = 1;
        tempMatrix4.multiply(camera.viewProjectionMatrix, this.worldMatrix);
        tempMatrix4.invert();
        vertices.set(0, tempVector3.set(-width, -height, depth).transformMat4(tempMatrix4));
        vertices.set(1, tempVector3.set(-width, height, depth).transformMat4(tempMatrix4));
        vertices.set(2, tempVector3.set(width, height, depth).transformMat4(tempMatrix4));
        vertices.set(3, tempVector3.set(width, -height, depth).transformMat4(tempMatrix4));
        vertices.set(4, tempVector3.set(-width, -height, -depth).transformMat4(tempMatrix4));
        vertices.set(5, tempVector3.set(-width, height, -depth).transformMat4(tempMatrix4));
        vertices.set(6, tempVector3.set(width, height, -depth).transformMat4(tempMatrix4));
        vertices.set(7, tempVector3.set(width, -height, -depth).transformMat4(tempMatrix4));
        vertices.set(8, tempVector3.set(0, 0, -depth).transformMat4(tempMatrix4));
    }
}
export default CameraHelper;
