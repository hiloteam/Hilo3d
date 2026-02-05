import AMDecompression from 'amc/build/amd';
import Geometry from '../geometry/Geometry';
import MorphGeometry from '../geometry/MorphGeometry';
import GeometryData from '../geometry/GeometryData';

const glTFAttrToGeometry = {
    POSITION: {
        name: 'vertices',
        decodeMatName: 'positionDecodeMat'
    },
    TEXCOORD_0: {
        name: 'uvs',
        decodeMatName: 'uvDecodeMat'
    },
    TEXCOORD_1: {
        name: 'uvs1',
        decodeMatName: 'uv1DecodeMat',
    },
    NORMAL: {
        name: 'normals',
        decodeMatName: 'normalDecodeMat'
    },
    JOINT: {
        name: 'skinIndices'
    },
    JOINTS_0: {
        name: 'skinIndices'
    },
    WEIGHT: {
        name: 'skinWeights'
    },
    WEIGHTS_0: {
        name: 'skinWeights'
    },
    TANGENT: {
        name: 'tangents'
    },
    COLOR_0: {
        name: 'colors'
    }
};

const mockHilo3d = {
    Geometry,
    GeometryData
};

function fixMorphGeometry(info, amcGeometry, destGeometry) {
    if (!destGeometry.isMorphGeometry) {
        const morphGeometry = new MorphGeometry();
        for (let name in destGeometry) {
            if (Object.prototype.hasOwnProperty.call(destGeometry, name) && name !== 'id') {
                morphGeometry[name] = destGeometry[name];
            }
        }
        morphGeometry.targets = {};
        destGeometry = morphGeometry;
    }
    const targets = destGeometry.targets;
    for (let i = 0; i < info.targets.length; i++) {
        const target = info.targets[i];
        for (const name in target) {
            if (name in glTFAttrToGeometry) {
                const amcAttrIndex = target[name];
                const hilo3dName = glTFAttrToGeometry[name].name;

                if (!targets[hilo3dName]) {
                    targets[hilo3dName] = [];
                }
                const attr = amcGeometry.attrs[amcAttrIndex];
                targets[hilo3dName].push(new GeometryData(attr.data, attr.itemCount));
            }
        }
    }
    if (info.weights) {
        destGeometry.weights = info.weights;
    } else {
        destGeometry.weights = new Float32Array(info.targets.length);
    }
    return destGeometry;
}

const AliAMCExtension = {
    _decodeTotalTime: 0,
    wasmURL: '',
    workerURL: '',
    useWASM: true,
    useWebWorker: true,
    useAuto: true,
    init() {
        if (AliAMCExtension.useAuto) {
            return AMDecompression.initWASM(AliAMCExtension.wasmURL, AliAMCExtension.memPages);
        }

        if (AliAMCExtension.useWebWorker) {
            return AMDecompression.initWorker(AliAMCExtension.workerURL);
        }

        if (AliAMCExtension.useWASM) {
            return AMDecompression.initWASM(AliAMCExtension.wasmURL, AliAMCExtension.memPages);
        }
        return Promise.resolve();
    },
    parse(info, parser, result, options) {
        const st = Date.now();
        const bufferView = parser.bufferViews[info.bufferView];
        const {
            wasmURL,
            workerURL,
            useAuto,
            useWASM,
            useWebWorker
        } = AliAMCExtension;

        let amcGeometry;
        const data = new Uint8Array(bufferView.buffer, bufferView.byteOffset, bufferView.byteLength);

        function done(amcGeometry) {
            AliAMCExtension._decodeTotalTime += Date.now() - st;
            let destGeometry = amcGeometry.toHilo3dGeometry(mockHilo3d, options.primitive._geometry);
            if (info.targets) {
                destGeometry = fixMorphGeometry(info, amcGeometry, destGeometry);
            }
            return destGeometry;
        }

        if (useAuto) {
            return AMDecompression.decompress(data, wasmURL, workerURL).then(done);
        }

        if (useWebWorker) {
            return AMDecompression.decompressWithWorker(data, useWASM, wasmURL, workerURL).then(done);
        }

        if (useWASM) {
            amcGeometry = AMDecompression.decompressWithWASM(data, wasmURL);
        } else {
            amcGeometry = AMDecompression.decompressWithJS(data);
        }
        return done(amcGeometry);
    },
    freeMemory() {
        AMDecompression.destory();
    }
};

export default AliAMCExtension;
