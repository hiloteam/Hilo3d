import Node, { type NodeParameters } from '../core/Node';
import Mesh from '../core/Mesh';
import Geometry from '../geometry/Geometry';
import GeometryData from '../geometry/GeometryData';
import BasicMaterial from '../material/BasicMaterial';
import Color from '../math/Color';
import { LINES } from '../constants/webgl';
type AxisDirection = 'x' | 'y' | 'z';
type AxisCoordinates = readonly [number, number, number, number, number, number];
const axisMap: Record<AxisDirection, AxisCoordinates> = {
    x: [0, 0, 0, 1, 0, 0],
    y: [0, 0, 0, 0, 1, 0],
    z: [0, 0, 0, 0, 0, 1]
};

export interface AxisHelperParameters extends NodeParameters {
    size?: number;
}
/**
 * 坐标轴帮助类
 * @example
 * ```ts
 * stage.addChild(new Hilo3d.AxisHelper());
 * ```
 */
class AxisHelper extends Node {
    static override readonly typeName: string = 'AxisHelper';
    isAxisHelper = true;
    override className = 'AxisHelper';
    /**
     * 坐标轴的长度，不可变更，需要变可以通过设置 scale
     */
    size = 1;
    /**
     * @param params - 初始化参数
     */
    constructor(params: AxisHelperParameters = {}) {
        super();
        Object.assign(this, params);
        this.init();
    }
    private addAxis(direction: AxisDirection): void {
        const mesh = new Mesh({
            name: `AxisHelper_${direction}`,
            geometry: new Geometry({
                mode: LINES,
                vertices: new GeometryData(new Float32Array(axisMap[direction]), 3),
                indices: new GeometryData(new Uint16Array([0, 1]), 1)
            }),
            material: new BasicMaterial({
                diffuse: new Color(
                    axisMap[direction][3],
                    axisMap[direction][4],
                    axisMap[direction][5]
                ),
                lightType: 'NONE'
            })
        });
        this.addChild(mesh);
    }
    private init(): void {
        this.setScale(this.size);
        this.addAxis('x');
        this.addAxis('y');
        this.addAxis('z');
    }
}
export default AxisHelper;
