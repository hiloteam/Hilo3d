import Class from '../core/Class';
import Node from '../core/Node';
import Skeleton from '../core/Skeleton';
import BasicMaterial from '../material/BasicMaterial';
import PBRMaterial from '../material/PBRMaterial';
import Geometry from '../geometry/Geometry';
import MorphGeometry from '../geometry/MorphGeometry';
import GeometryData from '../geometry/GeometryData';
import Mesh from '../core/Mesh';
import SkinedMesh from '../core/SkinedMesh';
import LazyTexture from '../texture/LazyTexture';
import math from '../math/math';
import Matrix4 from '../math/Matrix4';
import Matrix3 from '../math/Matrix3';
import Color from '../math/Color';
import AnimationStates from '../animation/AnimationStates';
import Animation from '../animation/Animation';
import PerspectiveCamera from '../camera/PerspectiveCamera';
import OrthographicCamera from '../camera/OrthographicCamera';
import log from '../utils/log';
import * as util from '../utils/util';
import * as extensionHandlers from './GLTFExtensions';

import constants from '../constants';

const {
    BLEND,
    DEPTH_TEST,
    CULL_FACE,
    FRONT,
    BACK,
    FRONT_AND_BACK
} = constants;

const ComponentTypeMap = {
    5120: [1, Int8Array],
    5121: [1, Uint8Array],
    5122: [2, Int16Array],
    5123: [2, Uint16Array],
    5125: [4, Uint32Array],
    5126: [4, Float32Array]
};

const ComponentNumberMap = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT2: 4,
    MAT3: 9,
    MAT4: 16
};

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


/**
 * @class
 */
const GLTFParser = Class.create(/** @lends GLTFParser.prototype */{
    /**
     * @default true
     * @type {boolean}
     */
    isGLTFParser: true,
    /**
     * @default GLTFParser
     * @type {string}
     */
    className: 'GLTFParser',
    Statics: /** @lends GLTFParser */ {
        MAGIC: 'glTF',
        /**
         * 扩展接口
         * @type {Object}
         */
        extensionHandlers,
        /**
         * 注册扩展接口
         * @param  {String} extensionName 接口名称
         * @param  {IGLTFExtensionHandler} handler 接口
         */
        registerExtensionHandler(extensionName, handler) {
            this.extensionHandlers[extensionName] = handler;
        },
        /**
         * 取消注册扩展接口
         * @param  {String} extensionName 接口名称
         */
        unregisterExtensionHandler(extensionName) {
            if (this.extensionHandlers[extensionName]) {
                delete this.extensionHandlers[extensionName];
            }
        }
    },
    isMultiAnim: true,
    isProgressive: false,
    isUnQuantizeInShader: true,
    isLoadAllTextures: false,
    preHandlerImageURI: null,
    preHandlerBufferURI: null,
    customMaterialCreator: null,
    ignoreTextureError: false,
    forceCreateNewBuffer: false,
    src: '',
    /**
     * @constructs
     * @param  {ArrayBuffer|String} content
     * @param  {Object} params
     */
    constructor(content, params) {
        Object.assign(this, params);
        this.content = content;
    },
    parse(loader) {
        if (this.content instanceof ArrayBuffer) {
            let buffer = this.content;
            let magic = util.convertUint8ArrayToString(new Uint8Array(buffer, 0, 4));
            if (magic === GLTFParser.MAGIC) {
                this.parseBinary(buffer);
            } else {
                let content = util.convertUint8ArrayToString(new Uint8Array(buffer), true);
                this.json = JSON.parse(content);
            }
        } else {
            this.json = JSON.parse(this.content);
        }
        this.glTFVersion = parseFloat(this.json.asset.version);
        if (this.glTFVersion >= 2) {
            this.isGLTF2 = true;
        }

        this.parseExtensionUsed();

        return this.loadResources(loader)
            .then(() => {
                this.parseExtensions(this.json.extensions, null, {
                    isGlobal: true,
                    methodName: 'parseOnLoad'
                });
                return Promise.resolve();
            })
            .then(() => this.parseGeometries())
            .then(() => this.parseScene());
    },
    parseExtensionUsed() {
        this.extensionsUsed = {};
        util.each(this.json.extensionsUsed, (name) => {
            this.extensionsUsed[name] = true;
        });

        if (!this.extensionsUsed.WEB3D_quantized_attributes) {
            // this glTF model havn't use quantize!
            this.isUnQuantizeInShader = false;
        }
    },
    getExtensionHandler(name) {
        return this.extensionHandlers && this.extensionHandlers[name] || GLTFParser.extensionHandlers[name];
    },
    parseExtension(extensions, name, result, options = {}) {
        const info = extensions[name];
        const extension = this.getExtensionHandler(name);
        if (extension && extension.parse) {
            return extension.parse(info, this, result, options);
        }

        return result;
    },
    parseExtensions(extensions, result, options = {}) {
        util.each(extensions, (info, name) => {
            if (options.ignoreExtensions && options.ignoreExtensions[name]) {
                return;
            }
            const extension = this.getExtensionHandler(name);
            const methodName = options.methodName || 'parse';
            if (extension && extension[methodName]) {
                result = extension[methodName](info, this, result, options);
            }
        });

        return result;
    },
    isUseExtension(data, extensionName) {
        return !!(data && data.extensions && data.extensions[extensionName]);
    },
    parseBinary(buffer) {
        this.isBinary = true;
        const infoDataView = new DataView(buffer);
        const version = infoDataView.getUint32(4, true);
        const totalLength = infoDataView.getUint32(8, true);
        let content;
        let start = 12;
        if (version < 2) {
            const contentLength = infoDataView.getUint32(start, true);
            content = new Uint8Array(buffer, 20, contentLength);
            content = util.convertUint8ArrayToString(content, true);
            this.json = JSON.parse(content);
            this.binaryBody = buffer.slice(20 + contentLength);
        } else if (version === 2) {
            while (start < totalLength) {
                let chunkLength = infoDataView.getUint32(start, true);
                let chunkType = infoDataView.getUint32(start + 4, true);
                if (chunkType === 0x4E4F534A) {
                    // JSON...
                    content = new Uint8Array(buffer, start + 8, chunkLength);
                    content = util.convertUint8ArrayToString(content, true);
                    this.json = JSON.parse(content);
                } else if (chunkType === 0x004E4942) {
                    // binary
                    this.binaryBody = buffer.slice(start + 8, start + 8 + chunkLength);
                }
                start += 8 + chunkLength;
            }
        } else {
            throw new Error(`Dont support glTF version ${version}`);
        }
    },
    loadResources(loader) {
        const actions = [];

        for (let extensionName in this.extensionsUsed) {
            const extension = this.getExtensionHandler(extensionName);
            if (extension && extension.init) {
                actions.push(extension.init(loader, this));
            }
        }

        if (this.isBinary) {
            actions.push(this.loadBuffers(loader).then(() => {
                return this.loadTextures(loader);
            }));
        } else {
            actions.push(this.loadBuffers(loader));
            actions.push(this.loadTextures(loader));
        }

        return Promise.all(actions);
    },
    getBufferUri(bufferName) {
        let uri = util.getRelativePath(this.src, this.json.buffers[bufferName].uri);
        if (this.preHandlerBufferURI) {
            uri = this.preHandlerBufferURI(uri, this.json.buffers[bufferName]);
        }
        return uri;
    },
    loadBuffers(loader) {
        this.buffers = {};

        if (this.isBinary) {
            if (this.isGLTF2) {
                this.buffers[0] = this.binaryBody;
            } else {
                this.buffers.binary_glTF = this.binaryBody;
            }
            this.parseBufferViews();
            return Promise.resolve();
        }

        return Promise.all(Object.keys(this.json.buffers || []).map((bufferName) => {
            const uri = this.getBufferUri(bufferName);
            return loader.loadRes(uri, 'buffer')
                .then((buffer) => {
                    this.buffers[bufferName] = buffer;
                });
        })).then(() => {
            this.parseBufferViews();
        });
    },
    getImageUri(imageName) {
        const imgData = this.json.images[imageName];
        let uri = imgData.uri;
        if (this.isUseExtension(imgData, 'KHR_binary_glTF')) {
            const binaryInfo = imgData.extensions.KHR_binary_glTF;
            const bufferView = this.bufferViews[binaryInfo.bufferView];
            const data = new Uint8Array(bufferView.buffer, bufferView.byteOffset, bufferView.byteLength);
            uri = util.getBlobUrl(binaryInfo.mimeType, data);
        } else if (uri) {
            uri = util.getRelativePath(this.src, uri);
        } else if ('bufferView' in imgData) {
            const bufferView = this.bufferViews[imgData.bufferView];
            const data = new Uint8Array(bufferView.buffer, bufferView.byteOffset, bufferView.byteLength);
            if (imgData.mimeType === 'image/ktx') {
                uri = data;
            } else {
                uri = util.getBlobUrl(imgData.mimeType, data);
            }
        }

        if (this.preHandlerImageURI) {
            uri = this.preHandlerImageURI(uri, imgData);
        }

        return uri;
    },
    getImageType(imageName) {
        const imgData = this.json.images[imageName];
        let type = '';
        if (imgData && /^image\/(.*)$/.test(imgData.mimeType)) {
            type = RegExp.$1;
        }
        if (['ktx'].indexOf(type) < 0) {
            // clear type if type is not valid
            type = '';
        }
        return type;
    },
    getUsedTextureNameMap() {
        const map = {};
        util.each(this.json.materials, (material) => {
            let values = material;
            let isKMC = false;
            if (this.isUseExtension(material, 'KHR_materials_common')) {
                isKMC = true;
                values = material.extensions.KHR_materials_common.values;
            }
            if (this.isGLTF2 && !isKMC) {
                // glTF 2.0
                if (values.normalTexture) {
                    map[values.normalTexture.index] = true;
                }
                if (values.occlusionTexture) {
                    map[values.occlusionTexture.index] = true;
                }
                if (values.emissiveTexture) {
                    map[values.emissiveTexture.index] = true;
                }
                if (values.transparencyTexture) {
                    map[values.transparencyTexture.index] = true;
                }
                if (this.isUseExtension(values, 'KHR_materials_pbrSpecularGlossiness')) {
                    const subValues = values.extensions.KHR_materials_pbrSpecularGlossiness;
                    const extensionHandler = this.getExtensionHandler('KHR_materials_pbrSpecularGlossiness');
                    extensionHandler.getUsedTextureNameMap(subValues, map, this);
                } else if (this.isUseExtension(values, 'KHR_techniques_webgl')) {
                    const subValues = values.extensions.KHR_techniques_webgl;
                    const extensionHandler = this.getExtensionHandler('KHR_techniques_webgl');
                    extensionHandler.getUsedTextureNameMap(subValues, map, this);
                } else if (values.pbrMetallicRoughness) {
                    const subValues = values.pbrMetallicRoughness;
                    if (subValues.baseColorTexture) {
                        map[subValues.baseColorTexture.index] = true;
                    }
                    if (subValues.metallicRoughnessTexture) {
                        map[subValues.metallicRoughnessTexture.index] = true;
                    }
                }
            } else {
                // glTF 1.0
                if (!isKMC) {
                    values = material.values;
                }
                [
                    'diffuse',
                    'specular',
                    'emission',
                    'ambient',
                    'transparency',
                    'normalMap'
                ].forEach((name) => {
                    let value = values[name];
                    if (value instanceof Object && 'index' in value) {
                        value = value.index;
                    }
                    if (util.isStrOrNumber(value) && this.json.textures[value]) {
                        map[value] = true;
                    }
                });
            }
        });
        return map;
    },
    loadTextures() {
        this.textures = {};

        if (!this.json.textures) {
            return Promise.resolve();
        }

        let needLoadTextures = Object.keys(this.json.textures);
        if (!this.isLoadAllTextures) {
            const usedTextures = this.getUsedTextureNameMap();
            needLoadTextures = needLoadTextures.filter((textureName) => {
                return usedTextures[textureName];
            });
        }

        return Promise.all(needLoadTextures.map((textureName) => {
            let textureData = this.json.textures[textureName];
            let uri = this.getImageUri(textureData.source);

            let texture = new LazyTexture(textureData);
            texture.uv = undefined;
            texture.autoLoad = this.isProgressive;
            texture.crossOrigin = true;
            texture.resType = this.getImageType(textureData.source);
            texture.src = uri;
            texture.name = textureData.name || textureName;
            if (util.isBlobUrl(uri)) {
                const onTextureLoad = () => {
                    util.revokeBlobUrl(uri);
                    texture.off('load', onTextureLoad);
                    texture.off('error', onTextureLoad);
                };
                texture.on('load', onTextureLoad, true);
                texture.on('error', onTextureLoad, true);
            }

            if (this.json.samplers) {
                Object.assign(texture, this.json.samplers[textureData.sampler]);
            }

            if (textureData.extensions) {
                texture = this.parseExtensions(textureData.extensions, texture);
            }

            this.textures[textureName] = texture;

            if (!this.isProgressive) {
                return texture.load(!this.ignoreTextureError);
            }
            return Promise.resolve();
        }));
    },
    parseBufferViews() {
        this.bufferViews = {};
        util.each(this.json.bufferViews, (data, name) => {
            const buffer = this.buffers[data.buffer];
            const byteOffset = data.byteOffset || 0;
            const byteLength = data.byteLength;
            this.bufferViews[name] = {
                id: math.generateUUID('bufferView'),
                byteOffset,
                byteLength,
                buffer,
                byteStride: data.byteStride
            };
        });

        if (!this.isBinary) {
            delete this.buffers;
        }
    },
    // get Texture for glTF 2.0
    getTexture(textureInfo) {
        let texture = this.textures[textureInfo.index];
        if (!texture) {
            return null;
        }
        const texCoord = textureInfo.texCoord || 0;

        const key = textureInfo.index + '_' + texCoord;
        if (this.textures[key]) {
            texture = this.textures[key];
        } else if (typeof texture.uv === 'number' && texture.uv !== texCoord) {
            texture = texture.clone();
            this.textures[key] = texture;
        }
        texture.uv = texCoord;
        texture.__gltfTextureInfo = textureInfo;

        return texture;
    },
    getColorOrTexture(value) {
        if (Array.isArray(value)) {
            return new Color(value[0], value[1], value[2]);
        }

        if (value instanceof Object && 'index' in value) {
            value = value.index;
        }
        return this.textures[value];
    },
    parseMaterialCommonProps(material, materialData) {
        switch (materialData.alphaMode) {
            case 'BLEND':
                material.transparent = true;
                break;
            case 'MASK':
                if ('alphaCutoff' in materialData) {
                    material.alphaCutoff = materialData.alphaCutoff;
                } else {
                    material.alphaCutoff = 0.5;
                }
                break;
            case 'OPAQUE':
            default:
                material.ignoreTranparent = true;
                break;
        }

        if (!materialData.doubleSided) {
            material.side = FRONT;
        } else {
            material.side = FRONT_AND_BACK;
        }

        if (materialData.transparencyTexture) {
            material.transparency = this.getTexture(materialData.transparencyTexture);
        }
    },
    createPBRMaterial(materialData) {
        const material = new PBRMaterial();
        let values = materialData;

        const needLight = !this.isUseExtension(values, 'KHR_materials_unlit');

        if (needLight) {
            const normalTexture = values.normalTexture;
            if (normalTexture) {
                material.normalMap = this.getTexture(normalTexture);
                if (normalTexture.scale !== undefined) {
                    material.normalMapScale = normalTexture.scale;
                } else {
                    material.normalMapScale = 1;
                }
            }

            const occlusionTexture = values.occlusionTexture;
            if (occlusionTexture) {
                material.occlusionMap = this.getTexture(occlusionTexture);
                if (occlusionTexture.strength !== undefined) {
                    material.occlusionStrength = occlusionTexture.strength;
                } else {
                    material.occlusionStrength = 1;
                }
            }

            const emissiveTexture = values.emissiveTexture;
            if (emissiveTexture) {
                material.emission = this.getTexture(emissiveTexture);
            }
        } else {
            material.lightType = 'NONE';
        }

        if (this.isUseExtension(values, 'KHR_materials_pbrSpecularGlossiness')) {
            this.parseExtension(values.extensions, 'KHR_materials_pbrSpecularGlossiness', material);
        } else if (values.pbrMetallicRoughness) {
            const subValues = values.pbrMetallicRoughness;
            if (subValues.baseColorFactor) {
                material.baseColor.fromArray(subValues.baseColorFactor);
            }
            if (subValues.baseColorTexture) {
                material.baseColorMap = this.getTexture(subValues.baseColorTexture);
            }

            if (needLight) {
                if (subValues.metallicRoughnessTexture) {
                    material.metallicRoughnessMap = this.getTexture(subValues.metallicRoughnessTexture);
                    if (material.occlusionMap === material.metallicRoughnessMap) {
                        material.occlusionMap = null;
                        material.isOcclusionInMetallicRoughnessMap = true;
                    }
                }
                if ('roughnessFactor' in subValues) {
                    material.roughness = subValues.roughnessFactor;
                }
                if ('metallicFactor' in subValues) {
                    material.metallic = subValues.metallicFactor;
                }
            }
        }

        if (material.baseColorMap) {
            this._parseTextureTransform(material, material.baseColorMap);
        }
        return material;
    },
    _parseTextureTransform(material, texture) {
        const textureInfo = texture.__gltfTextureInfo;
        if (this.isUseExtension(textureInfo, 'KHR_texture_transform')) {
            const transformInfo = textureInfo.extensions.KHR_texture_transform;

            if (transformInfo.texCoord !== undefined) {
                texture.uv = transformInfo.texCoord;
            }
            if (transformInfo.offset || transformInfo.rotation || transformInfo.scale) {
                const offset = transformInfo.offset || [0, 0];
                const rotation = transformInfo.rotation || 0;
                const scale = transformInfo.scale || [1, 1];

                const uvMatrix = new Matrix3().fromRotationTranslationScale(rotation, offset[0], offset[1], scale[0], scale[1]);
                if (texture.uv === 0) {
                    material.uvMatrix = uvMatrix;
                } else if (texture.uv === 1) {
                    material.uvMatrix1 = uvMatrix;
                }
            }
        }
    },
    createKMCMaterial(materialData, kmc) {
        const material = new BasicMaterial();
        let values;
        if (kmc) {
            values = kmc.values;
            material.lightType = kmc.technique;
        } else {
            values = materialData.values;
        }
        // glTF 1.0 or KMC
        material.diffuse = this.getColorOrTexture(values.diffuse) || material.diffuse;
        material.specular = this.getColorOrTexture(values.specular) || material.specular;
        material.emission = this.getColorOrTexture(values.emission) || material.emission;
        material.ambient = this.getColorOrTexture(values.ambient) || material.ambient;

        if (values.normalMap) {
            material.normalMap = this.getColorOrTexture(values.normalMap);
        }

        if (typeof values.transparency === 'number') {
            material.transparency = values.transparency;
            if (material.transparency < 1) {
                material.transparent = true;
            }
        } else if (typeof values.transparency === 'string') {
            material.transparency = this.getColorOrTexture(values.transparency);
            material.transparent = true;
        }

        if (values.transparent === true) {
            material.transparent = true;
        }

        if ('shininess' in values) {
            material.shininess = values.shininess;
        }

        this._parseTextureTransform(material, material.diffuse);
        return material;
    },
    parseMaterials() {
        this.materials = {};
        util.each(this.json.materials, (materialData, name) => {
            if (this.customMaterialCreator) {
                const material = this.customMaterialCreator(name, materialData, this.json, this);
                if (material) {
                    this.materials[name] = material;
                    return;
                }
            }

            let kmc = null;
            if (this.isUseExtension(materialData, 'KHR_materials_common')) {
                kmc = materialData.extensions.KHR_materials_common;
            }

            let material;
            if (this.isGLTF2 && !kmc) {
                if (this.isUseExtension(materialData, 'KHR_techniques_webgl')) {
                    material = this.parseExtension(materialData.extensions, 'KHR_techniques_webgl');
                } else {
                    material = this.createPBRMaterial(materialData);
                }
                this.parseMaterialCommonProps(material, materialData);
            } else {
                material = this.createKMCMaterial(materialData, kmc);
            }

            material = this.parseExtensions(materialData.extensions, material, {
                ignoreExtensions: {
                    KHR_techniques_webgl: 1,
                    KHR_materials_common: 1,
                    KHR_materials_pbrSpecularGlossiness: 1
                },
                isMaterial: true
            });


            material.name = materialData.name || name;
            this.materials[name] = material;

            this.parseTechnique(materialData, material);
        });
    },
    sparseAccessorHandler(data, sparse) {
        if (!sparse) {
            return data;
        }
        const count = sparse.count;
        // if dont create a new TpyedArray here, it will change the origin data in buffer
        let TypedArray = data.data.constructor;
        const newArray = new TypedArray(data.realLength);
        newArray.set(data.data);
        data.data = newArray;
        // values
        let buffer = this.bufferViews[sparse.values.bufferView];
        const values = new TypedArray(buffer.buffer, buffer.byteOffset + (sparse.values.byteOffset || 0), count * data.size);
        // indices
        TypedArray = ComponentTypeMap[sparse.indices.componentType][1];
        buffer = this.bufferViews[sparse.indices.bufferView];
        const indices = new TypedArray(buffer.buffer, buffer.byteOffset + (sparse.indices.byteOffset || 0), count);
        // change it
        for (let i = 0; i < count; i++) {
            util.copyArrayData(newArray, values, indices[i] * data.size, i * data.size, data.size);
        }
        return data;
    },
    getAccessorData(name, isDecode) {
        let accessor = this.json.accessors[name];
        if (accessor.data) {
            return accessor.data;
        }
        let [, TypedArray] = ComponentTypeMap[accessor.componentType];
        let number = ComponentNumberMap[accessor.type];
        let bufferView = this.bufferViews[accessor.bufferView];
        let count = accessor.count * number;
        let result;
        if (bufferView) {
            if (bufferView.byteStride && bufferView.byteStride > number * TypedArray.BYTES_PER_ELEMENT) {
                bufferView.array = new TypedArray(bufferView.buffer, bufferView.byteOffset, bufferView.byteLength / TypedArray.BYTES_PER_ELEMENT);

                result = new GeometryData(bufferView.array, number, {
                    offset: accessor.byteOffset || 0,
                    stride: bufferView.byteStride,
                    bufferViewId: bufferView.id
                });
            } else {
                let offset = (accessor.byteOffset || 0) + bufferView.byteOffset;
                let array;
                if (offset % TypedArray.BYTES_PER_ELEMENT || this.forceCreateNewBuffer) {
                    let buffer = bufferView.buffer.slice(offset, offset + count * TypedArray.BYTES_PER_ELEMENT);
                    array = new TypedArray(buffer);
                } else {
                    array = new TypedArray(bufferView.buffer, offset, count);
                }
                result = new GeometryData(array, number);
            }
        }

        if (accessor.sparse) {
            if (!result) {
                result = new GeometryData(new TypedArray(count), number);
            }
            result = this.sparseAccessorHandler(result, accessor.sparse);
        }

        result = this.parseExtensions(accessor.extensions, result, {
            isDecode,
            isAccessor: true
        });

        accessor.data = result;
        if (accessor.normalized) {
            result.normalized = true;
        }
        return result;
    },
    getArrayByAccessor(name, isDecode) {
        let accessor = this.json.accessors[name];
        if (accessor.array) {
            return accessor.array;
        }
        let data = this.getAccessorData(name, isDecode);
        if (!data.stride && !data.offset && data.size === 1) {
            return data.data;
        }

        const result = [];
        data.traverse((d) => {
            result.push(d.toArray ? d.toArray() : d);
        });
        accessor.array = result;
        return result;
    },
    parseTechnique(materialData, material) {
        let technique = null;
        if (this.json.techniques) {
            technique = this.json.techniques[materialData.technique];
        }
        if (!technique) {
            return;
        }
        if (!technique.states) {
            return;
        }

        technique.states.enable.forEach((flag) => {
            switch (flag) {
                case BLEND:
                    material.blend = true;
                    break;
                case DEPTH_TEST:
                    material.depthTest = true;
                    break;
                case CULL_FACE:
                    material.cullFace = true;
                    break;
                default:
                    break;
            }
        });

        util.each(technique.states.functions, (value, fnName) => {
            switch (fnName) {
                case 'blendEquationSeparate':
                    material.blendEquation = value[0];
                    material.blendEquationAlpha = value[1];
                    break;
                case 'blendFuncSeparate':
                    material.blendSrc = value[0];
                    material.blendDst = value[1];
                    material.blendSrcAlpha = value[2];
                    material.blendDstAlpha = value[3];
                    break;
                case 'depthMask':
                    material.depthMask = value[0];
                    break;
                case 'cullFace':
                    material.cullFaceType = value[0];
                    break;
                default:
                    material[fnName] = value;
                    break;
            }
        });

        if (material.cullFace) {
            material.side = material.cullFaceType === FRONT ? BACK : FRONT;
        } else {
            material.side = FRONT_AND_BACK;
        }
    },
    createMorphGeometry(primitive, weights) {
        // MorphGeometry
        const geometry = new MorphGeometry();
        const targets = geometry.targets = {};
        util.each(primitive.targets, (target) => {
            util.each(target, (accessorName, name) => {
                const geometryName = glTFAttrToGeometry[name].name;
                if (!targets[geometryName]) {
                    targets[geometryName] = [];
                }
                const data = this.getAccessorData(accessorName, true);
                targets[geometryName].push(data);
            });
        });
        if (weights) {
            geometry.weights = weights;
        } else {
            geometry.weights = new Float32Array(primitive.targets.length);
        }
        return geometry;
    },
    handlerGeometry(geometry, primitive) {
        const mode = primitive.mode === undefined ? 4 : primitive.mode;
        if (primitive.extensions) {
            const extensionGeometry = this.parseExtensions(primitive.extensions, null, {
                primitive,
                isPrimitive: true
            });
            if (extensionGeometry) {
                extensionGeometry.mode = mode;
                return extensionGeometry;
            }
        }

        if (!geometry) {
            geometry = new Geometry({
                mode
            });
        }
        if ('indices' in primitive) {
            geometry.indices = this.getAccessorData(primitive.indices);
        }
        let attr = primitive.attributes;
        for (let name in attr) {
            let info = glTFAttrToGeometry[name];
            if (!info) {
                log.warn(`Unknow attribute named ${name}!`);
                continue;
            }
            let isDecode = !(this.isUnQuantizeInShader && info.decodeMatName);

            geometry[info.name] = this.getAccessorData(attr[name], isDecode);
            if (!isDecode) {
                geometry[info.decodeMatName] = geometry[info.name].decodeMat;
                delete geometry[info.name].decodeMat;
            }
        }
        return geometry;
    },
    handlerSkinedMesh(mesh, skeleton) {
        if (!skeleton) {
            return;
        }

        mesh.skeleton = skeleton;
        if (this.useInstanced) {
            mesh.useInstanced = true;
        }
    },
    fixProgressiveGeometry(primitive, geometry) {
        primitive._geometry = geometry;
        if (this.isProgressive && primitive._meshes) {
            primitive._meshes.forEach((mesh) => {
                mesh.visible = true;
                mesh.geometry = geometry;
            });
        }
    },
    parseGeometries() {
        const promise = util.serialRun(this.json.meshes, (meshData) => {
            return util.serialRun(meshData.primitives, (primitive) => {
                let geometry;
                if (primitive.targets && primitive.targets.length) {
                    geometry = this.createMorphGeometry(primitive, meshData.weights);
                }
                primitive._geometry = geometry;
                let result = this.handlerGeometry(geometry, primitive);
                if (result && result.then) {
                    return result.then((geometry) => {
                        this.fixProgressiveGeometry(primitive, geometry);
                    }, (err) => {
                        log.error('geometry parse error', err);
                    });
                }
                this.fixProgressiveGeometry(primitive, result);
                return result;
            });
        });
        return this.isProgressive ? null : promise;
    },
    parseMesh(meshName, node, nodeData) {
        let meshData = this.json.meshes[meshName];
        meshData.primitives.forEach((primitive) => {
            let mesh;
            const skin = this.skins && this.skins[nodeData.skin];
            if (primitive.meshNode) {
                mesh = primitive.meshNode.clone();
            } else {
                let material = this.materials[primitive.material] || new BasicMaterial();
                const MeshClass = skin ? SkinedMesh : Mesh;
                mesh = new MeshClass({
                    geometry: primitive._geometry,
                    material,
                    name: 'mesh-' + (meshData.name || meshName)
                });

                primitive.meshNode = mesh;
            }
            this.handlerSkinedMesh(mesh, skin);
            if (this.isProgressive && !mesh.geometry) {
                mesh.visible = false;
                primitive._meshes = primitive._meshes || [];
                primitive._meshes.push(mesh);
            }
            node.addChild(mesh);
            this.meshes.push(mesh);
        });
    },
    parseCameras() {
        this.cameras = {};
        const defaultAspect = window.innerWidth / window.innerHeight;
        util.each(this.json.cameras, (cameraData, name) => {
            let camera;
            if (cameraData.type === 'perspective' && cameraData.perspective) {
                camera = new PerspectiveCamera();
                camera.fov = math.radToDeg(cameraData.perspective.yfov);
                camera.near = cameraData.perspective.znear;
                camera.far = cameraData.perspective.zfar;
                if (cameraData.aspectRatio) {
                    camera.aspect = cameraData.aspectRatio;
                } else {
                    camera.aspect = defaultAspect;
                }
            } else if (cameraData.type === 'orthographic' && cameraData.orthographic) {
                camera = new OrthographicCamera();
                camera.near = cameraData.orthographic.znear;
                camera.far = cameraData.orthographic.zfar;
                camera.right = cameraData.orthographic.xmag;
                camera.left = camera.right * -1;
                camera.top = cameraData.orthographic.ymag;
                camera.bottom = camera.top * -1;
            }

            camera = this.parseExtensions(cameraData.extensions, camera, {
                isCamera: true
            });

            if (camera) {
                camera.name = cameraData.name || name;
                this.cameras[name] = camera;
            }
        });
    },
    handlerNodeTransform(node, data) {
        if (data.matrix) {
            node.matrix.fromArray(data.matrix);
        } else {
            if (data.rotation) {
                node.quaternion.fromArray(data.rotation);
            }
            if (data.scale) {
                node.setScale(data.scale[0], data.scale[1], data.scale[2]);
            }
            if (data.translation) {
                node.x = data.translation[0];
                node.y = data.translation[1];
                node.z = data.translation[2];
            }
        }
    },
    parseNode(nodeName, parentNode) {
        let node;
        let data = this.json.nodes[nodeName];

        if (!data) {
            log.warn(`GLTFParser.parseNode: nodes[${nodeName}] has nothing.`);
        }

        node = new Node({
            name: data.name,
            animationId: nodeName
        });

        node = this.parseExtensions(data.extensions, node, {
            isNode: true
        });

        if ('camera' in data && this.cameras[data.camera]) {
            node.addChild(this.cameras[data.camera]);
        }
        this.handlerNodeTransform(node, data);

        if (data.jointName) {
            node.jointName = data.jointName;
            this.jointMap[node.jointName] = node;
        } else if (this.isGLTF2) {
            node.jointName = nodeName;
            this.jointMap[nodeName] = node;
        }

        if (data.meshes) {
            data.meshes.forEach(meshName => this.parseMesh(meshName, node, data));
        } else if ('mesh' in data) {
            this.parseMesh(data.mesh, node, data);
        }

        if (data.children) {
            data.children.forEach(name => this.parseNode(name, node));
        }

        parentNode.addChild(node);
    },
    parseAnimations() {
        if (!this.json.animations) {
            return null;
        }
        const isMultiAnim = this.isMultiAnim;
        const clips = {};
        let animStatesList = [];
        const validAnimationIds = {};
        util.each(this.json.animations, (info) => {
            info.channels.forEach((channel) => {
                let path = channel.target.path;
                let nodeId = channel.target.id;
                if (this.isGLTF2) {
                    nodeId = channel.target.node;
                }

                const sampler = info.samplers[channel.sampler];
                const inputAccessName = this.isGLTF2 ? sampler.input : info.parameters[sampler.input];
                const outputAccessName = this.isGLTF2 ? sampler.output : info.parameters[path];
                const keyTime = this.getArrayByAccessor(inputAccessName, true);
                let states = this.getArrayByAccessor(outputAccessName, true);
                if (path === 'rotation') {
                    path = 'quaternion';
                }
                const animStates = new AnimationStates({
                    interpolationType: sampler.interpolation || 'LINEAR',
                    nodeName: nodeId,
                    keyTime,
                    states,
                    type: AnimationStates.getType(path)
                });
                animStatesList.push(animStates);
                validAnimationIds[nodeId] = true;
            });

            if (isMultiAnim && animStatesList.length) {
                clips[info.name] = {
                    animStatesList
                };
                animStatesList = [];
            }
        });
        if (isMultiAnim && Object.keys(clips).length > 0) {
            animStatesList = Object.values(clips)[0].animStatesList;
        }
        if (animStatesList.length) {
            return new Animation({
                rootNode: this.node,
                animStatesList,
                validAnimationIds,
                clips
            });
        }

        return null;
    },
    parseScene() {
        this.parseMaterials();
        this.jointMap = {};
        this.meshes = [];
        this.lights = [];

        this.node = new Node({
            needCallChildUpdate: false
        });

        this.parseCameras();

        const scene = this.json.scenes[this.getDefaultSceneName()];
        if (!scene) {
            log.warn('GLTFParser:no scene!');
            return {
                node: this.node,
                meshes: [],
                cameras: [],
                lights: [],
                textures: [],
                materials: []
            };
        }

        const nodes = scene.nodes;
        this.parseSkins();
        nodes.forEach(node => this.parseNode(node, this.node));
        this.node.resetSkinedMeshRootNode();

        const model = {
            node: this.node,
            scene: this.node,
            meshes: this.meshes,
            json: this.json,
            cameras: Object.values(this.cameras),
            lights: this.lights,
            textures: Object.values(this.textures),
            materials: Object.values(this.materials)
        };

        const anim = this.parseAnimations();
        if (anim) {
            this.node.setAnim(anim);
            anim.play();
            model.anim = anim;
        }

        this.parseExtensions(scene.extensions, null, {
            isScene: true
        });

        this.parseExtensions(this.json.extensions, model, {
            isGlobal: true,
            methodName: 'parseOnEnd'
        });

        return model;
    },
    getDefaultSceneName() {
        if (this.defaultScene !== undefined) {
            return this.defaultScene;
        }

        if (this.json.scenes) {
            return Object.keys(this.json.scenes)[0];
        }

        return null;
    },
    parseSkins() {
        this.skins = [];
        const skins = this.json.skins;
        if (skins && skins.length) {
            this.skins = skins.map((skin) => {
                const skeleton = new Skeleton();
                const jointCount = skin.joints.length;

                const inverseBindMatrices = this.getArrayByAccessor(skin.inverseBindMatrices, true);
                for (let i = 0; i < jointCount; i++) {
                    const inverseBindMatrice = new Matrix4().fromArray(inverseBindMatrices[i]);
                    skeleton.inverseBindMatrices.push(inverseBindMatrice);
                }
                skeleton.jointNames = skin.joints;
                return skeleton;
            });
        }
    }
});

export default GLTFParser;
