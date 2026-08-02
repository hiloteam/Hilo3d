import { DISTANCE, NORMAL, POSITION, type DEPTH } from '../constants/Hilo';
import type { ShaderOptions } from '../render/types';
import MaterialInstance, { type MaterialInstanceParameters } from './MaterialInstance';
import type { MaterialCullMode, MaterialFrontFace } from './MaterialDefinition';
import { getBuiltInMaterialDefinition } from './BuiltInMaterialDefinitions';
import { MaterialUniformSemantic } from './MaterialSemantics';

export type GeometryVertexType = typeof POSITION | typeof NORMAL | typeof DEPTH | typeof DISTANCE;

export interface GeometryMaterialParameters extends MaterialInstanceParameters {
    readonly vertexType?: GeometryVertexType;
    readonly writeOriginData?: boolean;
    readonly frontFace?: MaterialFrontFace;
    readonly cullMode?: MaterialCullMode;
}

function definitionFor(parameters: Readonly<GeometryMaterialParameters>) {
    const vertexType = parameters.vertexType ?? POSITION;
    return getBuiltInMaterialDefinition({
        family: 'geometry',
        lightModel: 0,
        ...(parameters.frontFace === undefined ? {} : { frontFace: parameters.frontFace }),
        ...(parameters.cullMode === undefined ? {} : { cullMode: parameters.cullMode }),
        ...(parameters.coverage === undefined ? {} : { coverage: parameters.coverage }),
        ...(parameters.compositing === undefined ? {} : { compositing: parameters.compositing }),
        staticFeatures: {
            [`VERTEX_TYPE_${vertexType}`]: 1,
            ...(vertexType === POSITION || vertexType === DISTANCE ? { HAS_FRAG_POS: 1 } : {}),
            ...(vertexType === NORMAL ? { HAS_NORMAL: 1 } : {}),
            ...(parameters.writeOriginData === true ? { WRITE_ORIGIN_DATA: 1 } : {})
        }
    });
}

/** Immutable-topology material for position, normal, depth and distance outputs. */
class GeometryMaterial extends MaterialInstance {
    readonly isGeometryMaterial = true;
    override readonly className = 'GeometryMaterial';
    readonly vertexType: GeometryVertexType;
    readonly writeOriginData: boolean;

    constructor(params: Readonly<GeometryMaterialParameters> = {}) {
        super(definitionFor(params), params);
        this.vertexType = params.vertexType ?? POSITION;
        this.writeOriginData = params.writeOriginData ?? false;
        Object.assign(this.uniforms, {
            u_cameraFar: MaterialUniformSemantic.CAMERA_FAR,
            u_cameraNear: MaterialUniformSemantic.CAMERA_NEAR,
            u_cameraType: MaterialUniformSemantic.CAMERA_TYPE
        });
    }

    override getRenderOption(option: ShaderOptions = {}): ShaderOptions {
        return super.getRenderOption(option);
    }
}

export default GeometryMaterial;
