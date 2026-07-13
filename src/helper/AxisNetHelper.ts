import Mesh, { type MeshParameters } from '../core/Mesh';
import Geometry from '../geometry/Geometry';
import BasicMaterial from '../material/BasicMaterial';
import Color from '../math/Color';
import { LINES } from '../constants/webgl';

export interface AxisNetHelperParameters extends MeshParameters {
    size?: number;
    color?: Color;
}
/**
 * 网格帮助类
 * @example
 * ```ts
 * stage.addChild(new Hilo3d.AxisNetHelper({ size: 5 }));
 * ```
 */
class AxisNetHelper extends Mesh {
    static override readonly typeName: string = 'AxisNetHelper';
    isAxisNetHelper = true;
    override className = 'AxisNetHelper';
    /**
     * 网格线数量的一半(类似圆的半径)
     */
    size = 5;
    color = new Color(0.5, 0.5, 0.5);
    /**
     * @param params - 初始化参数
     */
    constructor(params: AxisNetHelperParameters = {}) {
        super();
        Object.assign(this, params);
        const geometry = new Geometry({
            mode: LINES
        });
        const size = this.size;
        const max = size * 2 + 1;
        for (let i = 0; i < max; i++) {
            const x = i / size - 1;
            geometry.addLine([x, 0, -1], [x, 0, 1]);
            geometry.addLine([-1, 0, x], [1, 0, x]);
        }
        this.geometry = geometry;
        this.material = new BasicMaterial({
            diffuse: this.color,
            lightType: 'NONE'
        });
    }
}
export default AxisNetHelper;
