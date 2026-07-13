import math from '../math/math';
import Cache from '../utils/Cache';
import capabilities from '../renderer/capabilities';
import basicFragCode from './basic.frag';
import basicVertCode from './basic.vert';
import geometryFragCode from './geometry.frag';
import pbrFragCode from './pbr.frag';
import type Mesh from '../core/Mesh';
import type Fog from '../core/Fog';
import type LightManager from '../light/LightManager';
import type Material from '../material/Material';
import type WebGLResourceManager from '../renderer/WebGLResourceManager';
import type { GLContext, ShaderPrecision } from '../renderer/types';

const cache = new Cache<Shader>();
const headerCache = new Cache<string>();
const CUSTUM_OPTION_PREFIX = 'HILO_CUSTUM_OPTION_';
const shaderModules = import.meta.glob<string>('./**/*.{frag,glsl,vert}', {
    eager: true,
    import: 'default'
});
const shaderSources = Object.fromEntries(
    Object.entries(shaderModules).map(([path, source]) => [path.slice(2), source])
);

export interface ShaderParameters {
    vs?: string;
    fs?: string;
    alwaysUse?: boolean;
}

export interface ShaderRenderer {
    vertexPrecision: ShaderPrecision;
    fragmentPrecision: ShaderPrecision;
    resourceManager: WebGLResourceManager;
}

interface BasicShaderMaterial extends Material {
    readonly isBasicMaterial: true;
    readonly isGeometryMaterial?: boolean;
}

interface PBRShaderMaterial extends Material {
    readonly isPBRMaterial: true;
}

interface CustomShaderMaterial extends Material {
    readonly isShaderMaterial: true;
    vs: string;
    fs: string;
    useHeaderCache: boolean;
}

function hasTrueFlag<Name extends string>(
    value: object,
    name: Name
): value is object & Record<Name, true> {
    return Reflect.get(value, name) === true;
}

function isBasicMaterial(material: Material): material is BasicShaderMaterial {
    return hasTrueFlag(material, 'isBasicMaterial');
}

function isPBRMaterial(material: Material): material is PBRShaderMaterial {
    return hasTrueFlag(material, 'isPBRMaterial');
}

function isCustomMaterial(material: Material): material is CustomShaderMaterial {
    return (
        hasTrueFlag(material, 'isShaderMaterial') &&
        typeof Reflect.get(material, 'vs') === 'string' &&
        typeof Reflect.get(material, 'fs') === 'string' &&
        typeof Reflect.get(material, 'useHeaderCache') === 'boolean'
    );
}

function beforeCompile(material: Material): Material['onBeforeCompile'] {
    const callback = material.onBeforeCompile;
    if (!callback) return null;
    return (vs, fs) => {
        const result: unknown = callback.call(material, vs, fs);
        if (typeof result !== 'object' || result === null) {
            throw new TypeError('Material.onBeforeCompile must return shader source strings');
        }
        const nextVS: unknown = Reflect.get(result, 'vs');
        const nextFS: unknown = Reflect.get(result, 'fs');
        if (typeof nextVS !== 'string' || typeof nextFS !== 'string') {
            throw new TypeError('Material.onBeforeCompile must return { vs, fs }');
        }
        return { vs: nextVS, fs: nextFS };
    };
}

function skeletonJointCount(mesh: Mesh): number | null {
    if (!hasTrueFlag(mesh, 'isSkinedMesh')) return null;
    const skeleton: unknown = Reflect.get(mesh, 'skeleton');
    if (typeof skeleton !== 'object' || skeleton === null) return null;
    const count: unknown = Reflect.get(skeleton, 'jointCount');
    return typeof count === 'number' ? count : null;
}
/**
 * Shader类
 */
class Shader {
    readonly isShader = true;
    readonly className = 'Shader';
    readonly id: string;
    private _isDestroyed = false;
    /**
     * vs 顶点代码
     */
    vs = '';
    /**
     * vs 片段代码
     */
    fs = '';
    static commonOptions: Record<string, number> = {};
    static commonHeader = '';
    static renderer: ShaderRenderer | null = null;
    /**
     * 内部的所有shader块字符串，可以用来拼接glsl代码
     */
    static shaders = shaderSources;
    /**
     * 初始化
     * @param renderer -
     */
    static init(renderer: ShaderRenderer): void {
        this.renderer = renderer;
        this.commonHeader = this.getCommonHeader(renderer);
    }
    /**
     * Shader 缓存
     */
    static get cache(): Cache<Shader> {
        return cache;
    }
    /**
     * Shader header缓存，一般不用管
     */
    static get headerCache(): Cache<string> {
        return headerCache;
    }
    /**
     * 重置
     */
    static reset(_gl?: GLContext): void {
        cache.removeAll();
    }
    /**
     * 获取header缓存的key
     * @param mesh - mesh
     * @param material - 材质
     * @param lightManager - lightManager
     * @param fog - fog
     * @param useLogDepth - 是否使用对数深度
     */
    static getHeaderKey(
        mesh: Mesh,
        material: Material,
        lightManager: LightManager,
        fog: Fog | null,
        useLogDepth: boolean
    ): string {
        let headerKey = `header_${material.id}_${lightManager.lightInfo.uid}`;
        const jointCount = skeletonJointCount(mesh);
        if (jointCount !== null) headerKey += `_joint${String(jointCount)}`;
        if (fog) {
            headerKey += `_fog_${fog.mode}`;
        }
        if (!mesh.geometry)
            throw new Error('Cannot create a shader header for a mesh without geometry');
        headerKey += `_${mesh.geometry.getShaderKey()}`;
        if (useLogDepth) {
            headerKey += '_fogDepth';
        }
        return headerKey;
    }
    /**
     * 获取header
     * @param mesh -
     * @param material -
     * @param lightManager -
     * @param fog -
     */
    static getHeader(
        mesh: Mesh,
        material: Material,
        lightManager: LightManager,
        fog: Fog | null,
        useLogDepth: boolean
    ): string {
        const headerKey = this.getHeaderKey(mesh, material, lightManager, fog, useLogDepth);
        let header = headerCache.get(headerKey);
        if (!header || material.isDirty) {
            const headers: Record<string, number> = { ...this.commonOptions };
            const lightType = material.lightType;
            if (lightType && lightType !== 'NONE') {
                lightManager.getRenderOption(headers);
            }
            material.getRenderOption(headers);
            mesh.getRenderOption(headers);
            if (fog) {
                headers['HAS_FOG'] = 1;
                fog.getRenderOption(headers);
            }
            if (useLogDepth) {
                headers['USE_LOG_DEPTH'] = 1;
                if (capabilities.FRAG_DEPTH) {
                    headers['USE_FRAG_DEPTH'] = 1;
                }
            }
            if (headers['HAS_NORMAL'] && headers['NORMAL_MAP']) {
                headers['HAS_TANGENT'] = 1;
            }
            if (!headers['RECEIVE_SHADOWS']) {
                delete headers['DIRECTIONAL_LIGHTS_SMC'];
                delete headers['SPOT_LIGHTS_SMC'];
                delete headers['POINT_LIGHTS_SMC'];
            }
            header = `#define SHADER_NAME ${material.shaderName ?? material.className}\n`;
            header += `${Object.entries(headers)
                .map(([name, value]) => {
                    if (name.includes(CUSTUM_OPTION_PREFIX)) {
                        return `#define ${name.replace(CUSTUM_OPTION_PREFIX, '')} ${String(value)}`;
                    }
                    return `#define HILO_${name} ${String(value)}`;
                })
                .join('\n')}\n`;
            headerCache.add(headerKey, header);
        }
        return header;
    }
    private static getCommonHeader(renderer: ShaderRenderer): string {
        const vertexPrecision = capabilities.getMaxPrecision(
            capabilities.MAX_VERTEX_PRECISION,
            renderer.vertexPrecision
        );
        const fragmentPrecision = capabilities.getMaxPrecision(
            capabilities.MAX_FRAGMENT_PRECISION,
            renderer.fragmentPrecision
        );
        const precision = capabilities.getMaxPrecision(vertexPrecision, fragmentPrecision);
        return `
#define HILO_MAX_PRECISION ${precision}
#define HILO_MAX_VERTEX_PRECISION ${vertexPrecision}
#define HILO_MAX_FRAGMENT_PRECISION ${fragmentPrecision}
`;
    }
    /**
     * 获取 shader
     * @param mesh -
     * @param material -
     * @param isUseInstance -
     * @param lightManager -
     * @param fog -
     * @param useLogDepth -
     */
    static getShader(
        mesh: Mesh,
        material: Material,
        isUseInstance: boolean,
        lightManager: LightManager,
        fog: Fog | null,
        useLogDepth: boolean
    ): Shader | null {
        const header = this.getHeader(mesh, material, lightManager, fog, useLogDepth);
        if (isBasicMaterial(material) || isPBRMaterial(material)) {
            return this.getBasicShader(material, isUseInstance, header);
        }
        if (isCustomMaterial(material)) {
            return this.getCustomShader(
                material.vs,
                material.fs,
                header,
                material.shaderCacheId ?? material.id,
                material.useHeaderCache
            );
        }
        return null;
    }
    /**
     * 获取基础 shader
     * @param material -
     * @param isUseInstance -
     * @param header - 已生成的 shader 宏定义
     */
    static getBasicShader(material: Material, isUseInstance: boolean, header: string): Shader {
        let instancedUniforms = '';
        if (isUseInstance) {
            instancedUniforms = material
                .getInstancedUniforms()
                .map(item => item.name)
                .join('|');
        }
        let key = `${material.className}:${instancedUniforms}`;
        const compile = beforeCompile(material);
        if (compile) {
            key += `:${material.shaderCacheId ?? material.id}`;
        }
        let shader = cache.get(key);
        if (!shader) {
            let fs = '';
            let vs = basicVertCode;
            if (isBasicMaterial(material)) {
                if (material.isGeometryMaterial) {
                    fs += geometryFragCode;
                } else {
                    fs += basicFragCode;
                }
            } else if (isPBRMaterial(material)) {
                fs += pbrFragCode;
            }
            if (compile) {
                const newCode = compile(vs, fs);
                fs = newCode.fs;
                vs = newCode.vs;
            }
            if (instancedUniforms) {
                const instancedUniformsReg = new RegExp(
                    `^\\s*uniform\\s+(\\w+)\\s+(${instancedUniforms});`,
                    'gm'
                );
                vs = vs.replace(instancedUniformsReg, 'attribute $1 $2;');
            }
            shader = this.getCustomShader(vs, fs, header, key, true);
        }
        const shaderNumId = this.getNumericId(shader);
        if (shaderNumId !== null) {
            Reflect.set(material, '_shaderNumId', shaderNumId);
        }
        return shader;
    }
    private static getNumericId(obj: Shader): number | null {
        const id = obj.id;
        const res = /_(\d+)/.exec(id);
        if (res?.[1]) {
            return parseInt(res[1], 10);
        }
        return null;
    }
    /**
     * 获取自定义shader
     * @param vs - 顶点代码
     * @param fs - 片段代码
     * @param cacheKey - 如果有，会以此值缓存 shader
     * @param useHeaderCache - 如果cacheKey和useHeaderCache同时存在，使用 cacheKey+useHeaderCache缓存 shader
     */
    static getCustomShader(
        vs: string,
        fs: string,
        header = '',
        cacheKey?: string,
        useHeaderCache = false
    ): Shader {
        const commonHeader = this.commonHeader;
        let shader: Shader | undefined;
        if (cacheKey) {
            if (useHeaderCache) {
                cacheKey += `:${header}`;
            }
            shader = cache.get(cacheKey);
        }
        if (!shader) {
            shader = new Shader({
                vs: commonHeader + header + vs,
                fs: commonHeader + header + fs
            });
            if (cacheKey) {
                cache.add(cacheKey, shader);
            }
        }
        return shader;
    }
    /**
     * 是否始终使用
     */
    alwaysUse = false;
    /**
     * @param params - 初始化参数，所有params都会复制到实例上
     */
    constructor(params: ShaderParameters = {}) {
        this.id = math.generateUUID(this.className);
        Object.assign(this, params);
    }
    /**
     * 没有被引用时销毁资源
     * @param renderer -
     * @returns this
     */
    destroyIfNoRef(renderer: ShaderRenderer): this {
        const resourceManager = renderer.resourceManager;
        resourceManager.destroyIfNoRef(this);
        return this;
    }
    /**
     * 销毁资源
     * @returns this
     */
    destroy(): this {
        if (this._isDestroyed) {
            return this;
        }
        cache.removeObject(this);
        this._isDestroyed = true;
        return this;
    }
}
export default Shader;
