/* eslint camelcase: "off" */
import PointLight from '../light/PointLight';
import DirectionalLight from '../light/DirectionalLight';
import SpotLight from '../light/SpotLight';
import Color from '../math/Color';
import math from '../math/math';
import * as util from '../utils/util';
import log from '../utils/log';
import ShaderMaterial from '../material/ShaderMaterial';
import semantic from '../material/semantic';
import constants from '../constants';

const {
    SAMPLER_2D
} = constants;

export {
    default as ALI_amc_mesh_compression
} from './AliAMCExtension';

/**
 * GLTFExtension Handler 接口
 * @interface IGLTFExtensionHandler
 */

/**
 * 解析元素扩展
 * @function
 * @name IGLTFExtensionHandler#[parse]
 * @param {Object} [extensionData] 扩展数据
 * @param {GLTFParser} [parser] parser
 * @param {Object} [element] parse的元素，e.g. material, mesh, geometry
 * @param {Object} [options]
 * @return {Object} [result] 一般需要返回原始元素或者替换的新的元素
 */

/**
 * 解析全局扩展，在资源加载后执行
 * @function
 * @name IGLTFExtensionHandler#[parseOnLoad]
 * @param {Object} [extensionData] 扩展数据
 * @param {GLTFParser} [parser] parser
 * @param {Object} [element] parse的元素，这里为 null
 * @param {Object} [options]
 */

/**
 * 解析全局扩展，在所有元素解析结束后执行
 * @function
 * @name IGLTFExtensionHandler#[parseOnEnd]
 * @param {Object} [extensionData] 扩展数据
 * @param {GLTFParser} [parser] parser
 * @param {GLTFModel} [element] parse的元素，这里为加载后的model，{node, scene, meshes, json, cameras, lights, textures, materials}
 * @param {Object} [options]
 */

/**
 * 初始化全局扩展，在加载前执行，可进行添加需要加载的资源
 * @function
 * @name IGLTFExtensionHandler#[init]
 * @param {GLTFLoader} [gltfLoader]
 * @param {GLTFParser} [parser]
 */

/**
 * 获取扩展用到的贴图信息, parser.isLoadAllTextures 为 false 时生效
 * @function
 * @name IGLTFExtensionHandler#[getUsedTextureNameMap]
 * @param {Object} [extensionData] 扩展数据
 * @param {Object} [map] used texture map
 * @example
 * getUsedTextureNameMap(extension, map) {
 *     if (extension.diffuseTexture) {
 *         map[extension.diffuseTexture.index] = true;
 *     }
 * }
 */


export const WEB3D_quantized_attributes = {
    unQuantizeData(data, decodeMat) {
        if (!decodeMat) {
            return data;
        }

        const matSize = Math.sqrt(decodeMat.length);
        const itemLen = matSize - 1;
        const result = new Float32Array(data.length);
        const tempArr = [];
        data.traverse((d, i) => {
            if (d.toArray) {
                d.toArray(tempArr);
            } else {
                tempArr[0] = d;
            }
            const idx = i * itemLen;
            for (let j = 0; j < matSize; j++) {
                result[idx + j] = 0;
                for (let k = 0; k < matSize; k++) {
                    let v = k === itemLen ? 1 : tempArr[k];
                    result[idx + j] += decodeMat[k * matSize + j] * v;
                }
            }
        });
        data.data = result;
        data.stride = 0;
        data.offset = 0;
        return data;
    },
    parse(quantizeInfo, parser, result, options) {
        let decodeMat = quantizeInfo.decodeMatrix;
        if (options.isDecode) {
            result = WEB3D_quantized_attributes.unQuantizeData(result, decodeMat);
        } else {
            result.decodeMat = decodeMat;
        }
        return result;
    }
};

export const HILO_animation_clips = {
    parseOnEnd(animClips, parser, model) {
        if (!model.anim || parser.isMultiAnim) {
            return model;
        }
        for (let name in animClips) {
            let clip = animClips[name];
            model.anim.addClip(name, clip[0], clip[1]);
        }
        return model;
    }
};
export const ALI_animation_clips = HILO_animation_clips;

export const ALI_bounding_box = {
    parse(bounds, parser, model) {
        bounds.center = bounds.max.map((a, i) => (a + bounds.min[i]) / 2);
        bounds.width = bounds.max[0] - bounds.min[0];
        bounds.height = bounds.max[1] - bounds.min[1];
        bounds.depth = bounds.max[2] - bounds.min[2];
        bounds.size = Math.sqrt(bounds.width ** 2 + bounds.height ** 2 + bounds.depth ** 2);
        model.bounds = bounds;
        return model;
    }
};

export const KHR_materials_pbrSpecularGlossiness = {
    getUsedTextureNameMap(extension, map) {
        if (extension.diffuseTexture) {
            map[extension.diffuseTexture.index] = true;
        }
        if (extension.specularGlossinessTexture) {
            map[extension.specularGlossinessTexture.index] = true;
        }
    },
    parse(info, parser, material) {
        if (info.diffuseFactor) {
            material.baseColor.fromArray(info.diffuseFactor);
        }
        if (info.diffuseTexture) {
            material.baseColorMap = parser.getTexture(info.diffuseTexture);
        }

        if (info.specularFactor) {
            material.specular.fromArray(info.specularFactor);
            material.specular.a = 1;
        }
        if ('glossinessFactor' in info) {
            material.glossiness = info.glossinessFactor;
        }
        if (info.specularGlossinessTexture) {
            material.specularGlossinessMap = parser.getTexture(info.specularGlossinessTexture);
        }
        material.isSpecularGlossiness = true;

        return material;
    }
};

export const KHR_lights_punctual = {
    parse(info, parser, node) {
        if (!parser.isUseExtension(parser.json, 'KHR_lights_punctual') || !parser.json.extensions.KHR_lights_punctual.lights) {
            return node;
        }

        const lightInfo = parser.json.extensions.KHR_lights_punctual.lights[info.light];

        if (!lightInfo) {
            return node;
        }

        let light;
        const color = new Color(1, 1, 1, 1);
        if (lightInfo.color) {
            color.r = lightInfo.color[0];
            color.g = lightInfo.color[1];
            color.b = lightInfo.color[2];
        }

        const amount = lightInfo.intensity !== undefined ? lightInfo.intensity : 1;
        const name = lightInfo.name || '';

        // spot light
        const spotInfo = lightInfo.spot || {};
        const cutoff = spotInfo.innerConeAngle !== undefined ? math.radToDeg(spotInfo.innerConeAngle) : 0;
        const outerCutoff = spotInfo.outerConeAngle !== undefined ? math.radToDeg(spotInfo.outerConeAngle) : 45;
        const range = lightInfo.range || 0;
        switch (lightInfo.type) {
            case 'directional':
                light = new DirectionalLight({
                    color,
                    amount,
                    name,
                    range
                });
                light.direction.set(0, 0, -1);
                break;
            case 'point':
                light = new PointLight({
                    color,
                    amount,
                    name,
                    range
                });
                break;
            case 'spot':
                light = new SpotLight({
                    color,
                    amount,
                    name,
                    range,
                    cutoff,
                    outerCutoff
                });
                light.direction.set(0, 0, -1);
                break;
            default:
                return node;
        }

        if (light) {
            node.addChild(light);
            parser.lights.push(light);
        }
        return node;
    }
};

export const KHR_techniques_webgl = {
    init(loader, parser) {
        const actions = [];
        const extensions = parser.json.extensions || {};
        const KHR_techniques_webgl = extensions.KHR_techniques_webgl || {};

        const programs = KHR_techniques_webgl.programs || [];
        const shaders = KHR_techniques_webgl.shaders || [];
        const techniques = KHR_techniques_webgl.techniques || [];

        parser.shaders = {};
        shaders.forEach((shader, index) => {
            let uri = util.getRelativePath(parser.src, shader.uri);
            if (parser.preHandlerShaderURI) {
                uri = parser.preHandlerShaderURI(uri, index, shader);
            }
            actions.push(loader.loadRes(uri).then((shaderText) => {
                parser.shaders[index] = shaderText;
            }));
        });

        parser.programs = {};
        programs.forEach((program, index) => {
            parser.programs[index] = Object.assign({}, program);
        });

        parser.techniques = {};
        techniques.forEach((technique, index) => {
            const newTechnique = parser.techniques[index] = Object.assign({}, technique);
            const textureInfos = newTechnique.textureInfos = {};
            const uniforms = technique.uniforms || {};
            for (let name in uniforms) {
                const uniform = uniforms[name];
                if (uniform.type === SAMPLER_2D) {
                    textureInfos[name] = uniform.value || {};
                }
            }
        });

        return Promise.all(actions);
    },
    getUsedTextureNameMap(extension, map, parser) {
        const techniques = parser.techniques;
        const technique = techniques[extension.technique];
        const values = extension.values || {};
        if (technique) {
            const textureInfos = technique.textureInfos;
            for (let name in textureInfos) {
                let imageIndex;
                if (values[name] && values[name].index !== undefined) {
                    imageIndex = values[name].index;
                } else if (textureInfos[name].index !== undefined) {
                    imageIndex = textureInfos[name].index;
                }

                if (imageIndex !== undefined) {
                    map[textureInfos[name].index] = true;
                }
            }
        }
    },
    parse(info, parser, material) {
        const textures = parser.textures || [];

        const techniqueInfo = parser.techniques[info.technique];
        if (!techniqueInfo) {
            return material;
        }
        const programInfo = parser.programs[techniqueInfo.program];
        if (!programInfo) {
            return material;
        }

        const fragmentText = parser.shaders[programInfo.fragmentShader];
        const vertexText = parser.shaders[programInfo.vertexShader];

        const uniformsInfo = techniqueInfo.uniforms || {};
        const attributesInfo = techniqueInfo.attributes || {};
        const valuesInfo = info.values || {};

        const attributes = {};
        const uniforms = {};

        for (let uniformName in uniformsInfo) {
            const uniformDef = uniformsInfo[uniformName] || {};
            let uniformValue = valuesInfo[uniformName];
            if (uniformValue === undefined) {
                uniformValue = uniformDef.value;
            }
            let uniformObject;
            if (uniformValue !== undefined) {
                if (uniformDef.type === SAMPLER_2D) {
                    const textureIndex = uniformValue.index || 0;
                    uniformObject = {
                        get(mesh, material, programInfo) {
                            return semantic.handlerTexture(textures[textureIndex], programInfo.textureIndex);
                        }
                    };
                } else {
                    uniformObject = {
                        get() {
                            return uniformValue;
                        }
                    };
                }
            } else if (uniformDef.semantic && semantic[uniformDef.semantic]) {
                const semanticFunc = semantic[uniformDef.semantic];
                const nodeIndex = uniformDef.node;
                let node;
                if (nodeIndex !== undefined) {
                    uniformObject = {
                        get(mesh, material, programInfo) {
                            if (node === undefined) {
                                node = parser.node.getChildByFn((node) => {
                                    return node.animationId === nodeIndex;
                                }) || mesh;
                            }
                            return semanticFunc.get(node, material, programInfo);
                        }
                    };
                } else {
                    uniformObject = uniformDef.semantic;
                }
            } else {
                log.warn(`KHR_techniques_webgl: no ${uniformName} value found!`);
                uniformObject = semantic.blankInfo;
            }
            uniforms[uniformName] = uniformObject;
        }

        for (let attributeName in attributesInfo) {
            const attributeValue = attributesInfo[attributeName] || {};
            if (attributeValue.semantic) {
                attributes[attributeName] = attributeValue.semantic;
            }
        }

        const shaderMaterial = new ShaderMaterial({
            needBasicUnifroms: false,
            needBasicAttributes: false,
            vs: vertexText,
            fs: fragmentText,
            attributes,
            uniforms
        });

        return shaderMaterial;
    }
};
