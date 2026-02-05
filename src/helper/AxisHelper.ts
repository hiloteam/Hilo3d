import Class from '../core/Class';
import Node from '../core/Node';
import Mesh from '../core/Mesh';
import Geometry from '../geometry/Geometry';
import GeometryData from '../geometry/GeometryData';
import BasicMaterial from '../material/BasicMaterial';
import Color from '../math/Color';

import constants from '../constants';

const {
    LINES
} = constants;

const axisMap = {
    x: [0, 0, 0, 1, 0, 0],
    y: [0, 0, 0, 0, 1, 0],
    z: [0, 0, 0, 0, 0, 1]
};

/**
 * 坐标轴帮助类
 * @class
 * @extends Node
 * @example
 * stage.addChild(new Hilo3d.AxisHelper());
 */
const AxisHelper = Class.create(/** @lends AxisHelper.prototype */{
    Extends: Node,
    /**
     * @default true
     * @type {boolean}
     */
    isAxisHelper: true,
    /**
     * @default AxisHelper
     * @type {string}
     */
    className: 'AxisHelper',
    /**
     * 坐标轴的长度，不可变更，需要变可以通过设置 scale
     * @default 1
     * @type {number}
     */
    size: 1,
    /**
     * @constructs
     * @param {object} [params] 初始化参数
     */
    constructor(params) {
        AxisHelper.superclass.constructor.call(this, params);
        this.init();
    },
    addAxis(direction) {
        const mesh = new Mesh({
            name: 'AxisHelper_' + direction,
            geometry: new Geometry({
                mode: LINES,
                vertices: new GeometryData(new Float32Array(axisMap[direction]), 3),
                indices: new GeometryData(new Uint16Array([0, 1]), 1)
            }),
            material: new BasicMaterial({
                diffuse: new Color(axisMap[direction][3], axisMap[direction][4], axisMap[direction][5]),
                lightType: 'NONE'
            })
        });
        this.addChild(mesh);
    },
    init() {
        this.setScale(this.size);
        this.addAxis('x');
        this.addAxis('y');
        this.addAxis('z');
    }
});

export default AxisHelper;
