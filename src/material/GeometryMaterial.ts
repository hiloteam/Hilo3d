import BasicMaterial from './BasicMaterial';
import constants from '../constants';
import type { GeometryMaterialParams } from '../types/common';

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
class GeometryMaterial extends BasicMaterial {
    /**
     * @default true
     * @type {boolean}
     */
    isGeometryMaterial: boolean = true;

    /**
     * @default GeometryMaterial
     * @type {string}
     */
    className: string = 'GeometryMaterial';

    /**
     * 顶点类型 POSITION, NORMAL, DEPTH, DISTANCE
     * @type {String}
     */
    vertexType: string = POSITION;

    lightType: string = NONE;

    /**
     * 是否直接存储
     * @type {Boolean}
     */
    writeOriginData: boolean = false;

    /**
     * @constructs
     * @param {object} [params] 初始化参数，所有params都会复制到实例上
     */
    constructor(params?: GeometryMaterialParams) {
        super(params);
        Object.assign(this.uniforms, {
            u_cameraFar: 'CAMERAFAR',
            u_cameraNear: 'CAMERANEAR',
            u_cameraType: 'CAMERATYPE'
        });
    }

    getRenderOption(option: any = {}): any {
        super.getRenderOption(option);
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
}

export default GeometryMaterial;
