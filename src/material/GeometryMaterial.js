import Class from '../core/Class';
import BasicMaterial from './BasicMaterial';
import constants from '../constants';

const {
    POSITION,
    NORMAL,
    DEPTH,
    DISTANCE,
    NONE
} = constants;

/**
 * 几何材质，支持 POSITION, NORMAL, DEPTH, DISTANCE 顶点类型
 * @class
 * @extends BasicMaterial
 * @example
 * const material = new Hilo3d.GeometryMaterial({
 *     diffuse: new Hilo3d.Color(1, 0, 0, 1)
 * });
 */
const GeometryMaterial = Class.create(/** @lends GeometryMaterial.prototype */ {
    Extends: BasicMaterial,
    /**
     * @default true
     * @type {boolean}
     */
    isGeometryMaterial: true,
    /**
     * @default GeometryMaterial
     * @type {string}
     */
    className: 'GeometryMaterial',
    /**
     * 顶点类型 POSITION, NORMAL, DEPTH, DISTANCE
     * @type {String}
     */
    vertexType: POSITION,
    lightType: NONE,
    /**
     * 是否直接存储
     * @type {Boolean}
     */
    writeOriginData: false,
    /**
     * @constructs
     * @param {object} params 初始化参数，所有params都会复制到实例上
     */
    constructor(params) {
        GeometryMaterial.superclass.constructor.call(this, params);
        Object.assign(this.uniforms, {
            u_cameraFar: 'CAMERAFAR',
            u_cameraNear: 'CAMERANEAR',
            u_cameraType: 'CAMERATYPE'
        });
    },
    getRenderOption(option = {}) {
        GeometryMaterial.superclass.getRenderOption.call(this, option);
        option[`VERTEX_TYPE_${this.vertexType}`] = 1;

        switch (this.vertexType) {
            case POSITION:
                option.HAS_FRAG_POS = 1;
                break;
            case NORMAL:
                option.HAS_NORMAL = 1;
                break;
            case DEPTH:
                break;
            case DISTANCE:
                option.HAS_FRAG_POS = 1;
                break;
            default:
                break;
        }

        if (this.writeOriginData) {
            option.WRITE_ORIGIN_DATA = 1;
        }

        return option;
    }
});

export default GeometryMaterial;
