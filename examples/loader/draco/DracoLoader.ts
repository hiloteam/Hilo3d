import createDecoderModule, { decoderWasmUrl } from 'virtual:hilo3d-draco-decoder';
import type {
    Attribute,
    Decoder,
    DecoderModule,
    Mesh as DracoMesh,
    PointCloud,
    Status
} from 'draco3d';
import Geometry from '../../../src/geometry/Geometry';
import GeometryData, { type GeometryComponentSize } from '../../../src/geometry/GeometryData';
import BasicLoader, { type LoaderRequest } from '../../../src/loader/BasicLoader';
import GLTFParser, {
    type GLTFExtensionHandler,
    type GLTFExtensionOptions
} from '../../../src/loader/GLTFParser';
import type { GLTFIndex } from '../../../src/loader/GLTFTypes';
import Loader from '../../../src/loader/Loader';

type GeometryAttributeName =
    'vertices' | 'normals' | 'tangents' | 'uvs' | 'uvs1' | 'colors' | 'skinIndices' | 'skinWeights';

interface AttributeBinding {
    readonly geometryAttribute: GeometryAttributeName;
    readonly round?: boolean;
}

interface DracoExtensionData {
    readonly bufferView: GLTFIndex;
    readonly attributes: Readonly<Record<string, number>>;
}

const ATTRIBUTE_BINDINGS: Readonly<Record<string, AttributeBinding>> = {
    POSITION: { geometryAttribute: 'vertices' },
    NORMAL: { geometryAttribute: 'normals' },
    TANGENT: { geometryAttribute: 'tangents' },
    TEX_COORD: { geometryAttribute: 'uvs' },
    TEXCOORD_0: { geometryAttribute: 'uvs' },
    TEXCOORD_1: { geometryAttribute: 'uvs1' },
    COLOR: { geometryAttribute: 'colors' },
    COLOR_0: { geometryAttribute: 'colors' },
    JOINTS_0: { geometryAttribute: 'skinIndices', round: true },
    WEIGHTS_0: { geometryAttribute: 'skinWeights' }
};

const decoderModule = createDecoderModule({
    locateFile: (path: string) => (path.endsWith('.wasm') ? decoderWasmUrl : path)
});

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readExtensionData(value: unknown): DracoExtensionData {
    if (!isRecord(value)) throw new TypeError('Draco extension data must be an object.');
    const bufferView = value['bufferView'];
    if (typeof bufferView !== 'string' && typeof bufferView !== 'number') {
        throw new TypeError('Draco extension bufferView must be a string or number.');
    }
    const rawAttributes = value['attributes'];
    if (!isRecord(rawAttributes)) {
        throw new TypeError('Draco extension attributes must be an object.');
    }
    const attributes: Record<string, number> = {};
    for (const [semantic, rawId] of Object.entries(rawAttributes)) {
        if (typeof rawId !== 'number' || !Number.isSafeInteger(rawId) || rawId < 0) {
            throw new TypeError(`Draco attribute ${semantic} must use a non-negative integer id.`);
        }
        attributes[semantic] = rawId;
    }
    return { bufferView, attributes };
}

function componentSize(value: number): GeometryComponentSize {
    if (value === 1 || value === 2 || value === 3 || value === 4) return value;
    throw new RangeError(`Draco attribute has unsupported component count ${String(value)}.`);
}

function assignAttribute(
    geometry: Geometry,
    name: GeometryAttributeName,
    data: GeometryData
): void {
    switch (name) {
        case 'vertices':
            geometry.vertices = data;
            break;
        case 'normals':
            geometry.normals = data;
            break;
        case 'tangents':
            geometry.tangents = data;
            break;
        case 'uvs':
            geometry.uvs = data;
            break;
        case 'uvs1':
            geometry.uvs1 = data;
            break;
        case 'colors':
            geometry.colors = data;
            break;
        case 'skinIndices':
            geometry.skinIndices = data;
            break;
        case 'skinWeights':
            geometry.skinWeights = data;
            break;
    }
}

function readAttribute(
    module: DecoderModule,
    decoder: Decoder,
    dracoGeometry: PointCloud,
    attribute: Attribute,
    round: boolean
): GeometryData {
    const size = componentSize(attribute.num_components());
    const source = new module.DracoFloat32Array();
    try {
        decoder.GetAttributeFloatForAllPoints(dracoGeometry, attribute, source);
        const values = new Float32Array(dracoGeometry.num_points() * size);
        for (let index = 0; index < values.length; index++) {
            const value = source.GetValue(index);
            values[index] = round ? Math.round(value) : value;
        }
        return new GeometryData(values, size);
    } finally {
        module.destroy(source);
    }
}

function decodeIndices(module: DecoderModule, decoder: Decoder, mesh: DracoMesh): GeometryData {
    const indices =
        mesh.num_points() > 65_535
            ? new Uint32Array(mesh.num_faces() * 3)
            : new Uint16Array(mesh.num_faces() * 3);
    const face = new module.DracoInt32Array();
    try {
        for (let faceIndex = 0; faceIndex < mesh.num_faces(); faceIndex++) {
            decoder.GetFaceFromMesh(mesh, faceIndex, face);
            const offset = faceIndex * 3;
            indices[offset] = face.GetValue(0);
            indices[offset + 1] = face.GetValue(1);
            indices[offset + 2] = face.GetValue(2);
        }
    } finally {
        module.destroy(face);
    }
    return new GeometryData(indices, 1);
}

function decodeExplicitAttributes(
    module: DecoderModule,
    decoder: Decoder,
    dracoGeometry: PointCloud,
    geometry: Geometry,
    attributeIds: Readonly<Record<string, number>>
): void {
    for (const [semantic, id] of Object.entries(attributeIds)) {
        const binding = ATTRIBUTE_BINDINGS[semantic];
        if (!binding) throw new RangeError(`Unsupported Draco attribute semantic ${semantic}.`);
        const attribute = decoder.GetAttributeByUniqueId(dracoGeometry, id);
        assignAttribute(
            geometry,
            binding.geometryAttribute,
            readAttribute(module, decoder, dracoGeometry, attribute, binding.round ?? false)
        );
    }
}

function decodeStandardAttributes(
    module: DecoderModule,
    decoder: Decoder,
    dracoGeometry: PointCloud,
    geometry: Geometry
): void {
    const standards = [
        ['POSITION', module.POSITION],
        ['NORMAL', module.NORMAL],
        ['TEX_COORD', module.TEX_COORD],
        ['COLOR', module.COLOR]
    ] as const;
    for (const [semantic, attributeType] of standards) {
        const id = decoder.GetAttributeId(dracoGeometry, attributeType);
        if (id < 0) continue;
        const binding = ATTRIBUTE_BINDINGS[semantic];
        if (!binding) continue;
        const attribute = decoder.GetAttribute(dracoGeometry, id);
        assignAttribute(
            geometry,
            binding.geometryAttribute,
            readAttribute(module, decoder, dracoGeometry, attribute, false)
        );
    }
}

export async function decodeDracoGeometry(
    bytes: Uint8Array,
    attributeIds: Readonly<Record<string, number>> = {},
    geometry = new Geometry()
): Promise<Geometry> {
    const module = await decoderModule;
    const buffer = new module.DecoderBuffer();
    const decoder = new module.Decoder();
    let dracoGeometry: PointCloud | null = null;
    let mesh: DracoMesh | null = null;
    let status: Status | null = null;
    try {
        buffer.Init(
            new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
            bytes.byteLength
        );
        if (decoder.GetEncodedGeometryType(buffer) === module.TRIANGULAR_MESH) {
            mesh = new module.Mesh();
            dracoGeometry = mesh;
            status = decoder.DecodeBufferToMesh(buffer, mesh);
        } else {
            dracoGeometry = new module.PointCloud();
            status = decoder.DecodeBufferToPointCloud(buffer, dracoGeometry);
        }

        if (!status.ok()) {
            throw new Error(`Draco geometry decoding failed: ${status.error_msg()}`);
        }

        if (Object.keys(attributeIds).length > 0) {
            decodeExplicitAttributes(module, decoder, dracoGeometry, geometry, attributeIds);
        } else {
            decodeStandardAttributes(module, decoder, dracoGeometry, geometry);
        }
        if (!geometry.vertices)
            throw new Error('Decoded Draco geometry has no position attribute.');
        if (mesh) geometry.indices = decodeIndices(module, decoder, mesh);
        return geometry;
    } finally {
        if (status) module.destroy(status);
        if (dracoGeometry) module.destroy(dracoGeometry);
        module.destroy(decoder);
        module.destroy(buffer);
    }
}

class DracoLoader {
    static readonly decode = decodeDracoGeometry;
    private readonly transport = new BasicLoader();

    async load(params: LoaderRequest): Promise<Geometry> {
        if (!params.src) throw new TypeError('DracoLoader requires a source URL.');
        const resource = await this.transport.loadRes(params.src, BasicLoader.TYPE_BUFFER);
        if (!(resource instanceof ArrayBuffer)) {
            throw new TypeError(`Draco resource ${params.src} did not resolve to an ArrayBuffer.`);
        }
        return decodeDracoGeometry(new Uint8Array(resource));
    }
}

const dracoExtension: GLTFExtensionHandler = {
    async parse(
        extensionData: unknown,
        parser: GLTFParser,
        result: unknown,
        _options: GLTFExtensionOptions
    ): Promise<Geometry> {
        const info = readExtensionData(extensionData);
        const bufferView = parser.bufferViews[String(info.bufferView)];
        if (!bufferView) {
            throw new RangeError(`Draco bufferView ${String(info.bufferView)} does not exist.`);
        }
        const bytes = new Uint8Array(
            bufferView.buffer,
            bufferView.byteOffset,
            bufferView.byteLength
        );
        return decodeDracoGeometry(
            bytes,
            info.attributes,
            result instanceof Geometry ? result : new Geometry()
        );
    }
};

Loader.addLoader('drc', DracoLoader);
GLTFParser.registerExtensionHandler('KHR_draco_mesh_compression', dracoExtension);

export default DracoLoader;
