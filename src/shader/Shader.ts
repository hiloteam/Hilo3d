import math from '../math/math';
import Cache from '../utils/Cache';
import basicFragCode from './basic.frag';
import basicVertCode from './basic.vert';
import geometryFragCode from './geometry.frag';
import pbrFragCode from './pbr.frag';
import type Mesh from '../core/Mesh';
import type Fog from '../core/Fog';
import type LightManager from '../light/LightManager';
import type Material from '../material/Material';
import type GraphicsResourceManager from '../renderer/GraphicsResourceManager';
import type { GLContext, ShaderPrecision } from '../renderer/types';
import {
    MAX_AREA_LIGHTS,
    MAX_DIRECTIONAL_LIGHTS,
    MAX_POINT_LIGHTS,
    MAX_SPOT_LIGHTS
} from '../renderer/ubo/BuiltInUniformBlocks';

const cache = new Cache<Shader>();
const headerCache = new Cache<string>();
const rendererHeaderCache = new WeakMap<ShaderPrecisionProvider, RendererHeaderSnapshot>();
const CUSTOM_OPTION_PREFIX = 'HILO_CUSTOM_OPTION_';
const DEFAULT_COMMON_HEADER = `
#define HILO_MAX_PRECISION highp
#define HILO_MAX_VERTEX_PRECISION highp
#define HILO_MAX_FRAGMENT_PRECISION highp
`;
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

export interface ShaderPrecisionProvider {
    vertexPrecision: ShaderPrecision;
    fragmentPrecision: ShaderPrecision;
}

export interface ShaderRenderer extends ShaderPrecisionProvider {
    resourceManager: GraphicsResourceManager;
}

interface RendererHeaderSnapshot {
    readonly vertexPrecision: ShaderPrecision;
    readonly fragmentPrecision: ShaderPrecision;
    readonly header: string;
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
    if (!hasTrueFlag(mesh, 'isSkinnedMesh')) return null;
    const skeleton: unknown = Reflect.get(mesh, 'skeleton');
    if (typeof skeleton !== 'object' || skeleton === null) return null;
    const count: unknown = Reflect.get(skeleton, 'jointCount');
    return typeof count === 'number' ? count : null;
}

function shaderOptionsSignature(options: Readonly<Record<string, number>>): string {
    return JSON.stringify(
        Object.keys(options)
            .sort()
            .map(name => [name, String(options[name])])
    );
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
    /**
     * 内部的所有shader块字符串，可以用来拼接glsl代码
     */
    static shaders = shaderSources;
    /**
     * 初始化
     * @param renderer -
     */
    static init(renderer: ShaderPrecisionProvider): void {
        this.getRendererHeader(renderer);
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
        const commonOptions = { ...this.commonOptions };
        const headerKey = JSON.stringify([
            this.getHeaderKey(mesh, material, lightManager, fog, useLogDepth),
            shaderOptionsSignature(commonOptions)
        ]);
        let header = headerCache.get(headerKey);
        if (!header || material.isDirty) {
            const headers: Record<string, number> = commonOptions;
            const lightType = material.lightType;
            if (lightType && lightType !== 'NONE') {
                lightManager.getRenderOption(headers);
                const limits: readonly (readonly [string, number])[] = [
                    ['DIRECTIONAL_LIGHTS', MAX_DIRECTIONAL_LIGHTS],
                    ['SPOT_LIGHTS', MAX_SPOT_LIGHTS],
                    ['POINT_LIGHTS', MAX_POINT_LIGHTS],
                    ['AREA_LIGHTS', MAX_AREA_LIGHTS]
                ];
                for (const [name, limit] of limits) {
                    const count = headers[name] ?? 0;
                    if (count > limit) {
                        throw new RangeError(
                            `${name} count ${String(count)} exceeds the fixed UBO capacity ${String(limit)}`
                        );
                    }
                }
            }
            material.getRenderOption(headers);
            mesh.getRenderOption(headers);
            if (fog) {
                headers['HAS_FOG'] = 1;
                fog.getRenderOption(headers);
            }
            if (useLogDepth) {
                headers['USE_LOG_DEPTH'] = 1;
                headers['USE_FRAG_DEPTH'] = 1;
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
                    if (name.includes(CUSTOM_OPTION_PREFIX)) {
                        return `#define ${name.replace(CUSTOM_OPTION_PREFIX, '')} ${String(value)}`;
                    }
                    return `#define HILO_${name} ${String(value)}`;
                })
                .join('\n')}\n`;
            headerCache.add(headerKey, header);
        }
        return header;
    }
    private static getCommonHeader(renderer: ShaderPrecisionProvider): string {
        const vertexPrecision = renderer.vertexPrecision;
        const fragmentPrecision = renderer.fragmentPrecision;
        const precision =
            vertexPrecision === 'highp' || fragmentPrecision === 'highp'
                ? 'highp'
                : vertexPrecision === 'mediump' || fragmentPrecision === 'mediump'
                  ? 'mediump'
                  : 'lowp';
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
        useLogDepth: boolean,
        renderer?: ShaderPrecisionProvider
    ): Shader | null {
        const header = this.getHeader(mesh, material, lightManager, fog, useLogDepth);
        if (isBasicMaterial(material) || isPBRMaterial(material)) {
            return this.getBasicShader(material, isUseInstance, header, renderer);
        }
        if (isCustomMaterial(material)) {
            return this.getCustomShader(
                material.vs,
                material.fs,
                header,
                material.shaderCacheId ?? material.id,
                material.useHeaderCache,
                renderer
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
    static getBasicShader(
        material: Material,
        isUseInstance: boolean,
        header: string,
        renderer?: ShaderPrecisionProvider
    ): Shader {
        if (isUseInstance) {
            header += '#define HILO_INSTANCED 1\n';
        }
        let key = `${material.className}:${isUseInstance ? 'instanced' : 'single'}`;
        const compile = beforeCompile(material);
        if (compile) {
            key += `:${material.shaderCacheId ?? material.id}`;
        }
        const commonHeader = this.getRendererHeader(renderer);
        let shader = cache.get(this.getCustomShaderCacheKey(key, commonHeader, header, true));
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
            shader = this.getCustomShader(vs, fs, header, key, true, renderer);
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
     * @param useHeaderCache - 是否使用 header-aware 缓存命名空间；实际 header 始终参与缓存键
     */
    static getCustomShader(
        vs: string,
        fs: string,
        header = '',
        cacheKey?: string,
        useHeaderCache = false,
        renderer?: ShaderPrecisionProvider
    ): Shader {
        const commonHeader = this.getRendererHeader(renderer);
        let shader: Shader | undefined;
        if (cacheKey) {
            cacheKey = this.getCustomShaderCacheKey(cacheKey, commonHeader, header, useHeaderCache);
            shader = cache.get(cacheKey);
        }
        if (!shader) {
            const shaderHeader = commonHeader + header;
            shader = new Shader({
                vs: this.assembleGLSL300(vs, shaderHeader),
                fs: this.assembleGLSL300(fs, shaderHeader)
            });
            if (cacheKey) {
                cache.add(cacheKey, shader);
            }
        }
        return shader;
    }

    private static getRendererHeader(renderer?: ShaderPrecisionProvider): string {
        if (!renderer) return DEFAULT_COMMON_HEADER;
        const cached = rendererHeaderCache.get(renderer);
        if (
            cached?.vertexPrecision === renderer.vertexPrecision &&
            cached.fragmentPrecision === renderer.fragmentPrecision
        ) {
            return cached.header;
        }
        const snapshot: RendererHeaderSnapshot = Object.freeze({
            vertexPrecision: renderer.vertexPrecision,
            fragmentPrecision: renderer.fragmentPrecision,
            header: this.getCommonHeader(renderer)
        });
        rendererHeaderCache.set(renderer, snapshot);
        return snapshot.header;
    }

    private static getCustomShaderCacheKey(
        cacheKey: string,
        commonHeader: string,
        header: string,
        useHeaderCache: boolean
    ): string {
        return JSON.stringify([cacheKey, commonHeader, useHeaderCache, header]);
    }

    private static assembleGLSL300(source: string, header: string): string {
        const version = /^\s*#version\s+300\s+es\s*/;
        return `#version 300 es\n${header}${source.replace(version, '')}`;
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
