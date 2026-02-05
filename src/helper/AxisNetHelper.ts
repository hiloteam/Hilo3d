import Mesh from '../core/Mesh';
import Geometry from '../geometry/Geometry';
import BasicMaterial from '../material/BasicMaterial';
import Color from '../math/Color';

import constants from '../constants';

const {
    LINES
} = constants;

/**
 * 网格帮助类
 * @class
 * @extends Mesh
 * @example
 * stage.addChild(new Hilo3d.AxisNetHelper({ size: 5 }));
 */
class AxisNetHelper extends Mesh {
    /**
     * @default true
     * @type {boolean}
     */
    isAxisNetHelper: boolean = true;

    /**
     * @default AxisNetHelper
     * @type {string}
     */
    className: string = 'AxisNetHelper';

    /**
     * 网格线数量的一半(类似圆的半径)
     * @default 5
     * @type {number}
     */
    size: number = 5;

    /**
     * 颜色
     * @default new Color(.5, .5, .5)
     * @type {Color}
     */
    color?: Color;

    /**
     * @constructs
     * @param {object} [params] 初始化参数
     */
    constructor(params?: any) {
        super(params);

        this.color = this.color || new Color(.5, .5, .5);

        const geometry = new Geometry({
            mode: LINES
        });
        const size = this.size;
        const max = size * 2 + 1;
        for (let i = 0; i < max; i++) {
            let x = i / size - 1;
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
