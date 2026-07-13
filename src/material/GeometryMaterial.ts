import BasicMaterial, { type BasicMaterialParameters } from './BasicMaterial';
import { DEPTH, DISTANCE, NORMAL, POSITION } from '../constants/Hilo';
import type { ShaderOptions } from '../renderer/types';

export type GeometryVertexType = typeof POSITION | typeof NORMAL | typeof DEPTH | typeof DISTANCE;

export interface GeometryMaterialParameters extends BasicMaterialParameters {
    vertexType?: GeometryVertexType;
    writeOriginData?: boolean;
}
/**
 * 几何材质，支持 POSITION, NORMAL, DEPTH, DISTANCE 顶点类型
 * @example
 * ```ts
 * const material = new Hilo3d.GeometryMaterial({
 *     diffuse: new Hilo3d.Color(1, 0, 0, 1)
 * });
 * ```
 */
class GeometryMaterial extends BasicMaterial {
    isGeometryMaterial = true;
    override readonly className: string = 'GeometryMaterial';
    /**
     * 顶点类型 POSITION, NORMAL, DEPTH, DISTANCE
     */
    vertexType: GeometryVertexType = POSITION;
    override lightType = 'NONE' as const;
    /**
     * 是否直接存储
     */
    writeOriginData = false;
    /**
     * @param params - 初始化参数，所有params都会复制到实例上
     */
    constructor(params: GeometryMaterialParameters = {}) {
        super();
        Object.assign(this, params);
        this.initializeBasicMaterialBindings();
        Object.assign(this.uniforms, {
            u_cameraFar: 'CAMERAFAR',
            u_cameraNear: 'CAMERANEAR',
            u_cameraType: 'CAMERATYPE'
        });
    }
    override getRenderOption(option: ShaderOptions = {}): ShaderOptions {
        super.getRenderOption(option);
        option[`VERTEX_TYPE_${this.vertexType}`] = 1;
        switch (this.vertexType) {
            case POSITION:
                option['HAS_FRAG_POS'] = 1;
                break;
            case NORMAL:
                option['HAS_NORMAL'] = 1;
                break;
            case DEPTH:
                break;
            case DISTANCE:
                option['HAS_FRAG_POS'] = 1;
                break;
            default:
                break;
        }
        if (this.writeOriginData) {
            option['WRITE_ORIGIN_DATA'] = 1;
        }
        return option;
    }
}
export default GeometryMaterial;
