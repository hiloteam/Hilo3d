import math from '../math/math';
import Cache from '../utils/Cache';
import basicFragCode from './basic.frag';
import basicVertCode from './basic.vert';
import geometryFragCode from './geometry.frag';
import pbrFragCode from './pbr.frag';
import {
    CollisionSafeVariantKeyRegistry,
    hashVariantValues,
    type VariantHashValue
} from './VariantHash';
import type Mesh from '../core/Mesh';
import type Fog from '../core/Fog';
import type LightManager from '../light/LightManager';
import type Material from '../material/Material';
import type { RendererResourceManager } from '../render/RendererCore';
import type { ShaderPrecision } from '../render/types';
import {
    MAX_AREA_LIGHTS,
    MAX_DIRECTIONAL_LIGHTS,
    MAX_POINT_LIGHTS,
    MAX_SPOT_LIGHTS
} from '../render/ubo/BuiltInUniformBlocks';

const cache = new Cache<Shader>();
const headerCache = new Cache<string>();
const headerVariantKeys = new CollisionSafeVariantKeyRegistry();
const shaderVariantKeys = new CollisionSafeVariantKeyRegistry();
const stringFingerprints = new Map<string, string>();
const STRING_FINGERPRINT_CACHE_LIMIT = 4096;
const HEADER_VARIANT_CACHE_LIMIT = 1024;
const SHADER_VARIANT_CACHE_LIMIT = 2048;
const MESH_HEADER_SNAPSHOT_LIMIT = 4;
const trackedHeaderVariantKeys = new Map<string, true>();
const trackedShaderVariants = new Map<string, Shader>();
let meshHeaderSnapshots = new WeakMap<Mesh, HeaderVariantSnapshot[]>();
let beforeCompileSnapshots = new WeakMap<Material, BeforeCompileSnapshot>();
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

function getStringFingerprint(value: string): string {
    let fingerprint = stringFingerprints.get(value);
    if (fingerprint !== undefined) {
        stringFingerprints.delete(value);
        stringFingerprints.set(value, fingerprint);
        return fingerprint;
    }

    fingerprint = hashVariantValues([value]);
    if (stringFingerprints.size >= STRING_FINGERPRINT_CACHE_LIMIT) {
        const oldest = stringFingerprints.keys().next().value;
        if (oldest !== undefined) stringFingerprints.delete(oldest);
    }
    stringFingerprints.set(value, fingerprint);
    return fingerprint;
}

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
    resourceManager: RendererResourceManager;
}

interface RendererHeaderSnapshot {
    readonly vertexPrecision: ShaderPrecision;
    readonly fragmentPrecision: ShaderPrecision;
    readonly header: string;
}

interface HeaderVariant {
    readonly headerKey: string;
    readonly options: Record<string, number>;
    readonly shaderName: string;
}

interface HeaderVariantSnapshot {
    readonly material: Material;
    readonly materialRevision: number;
    readonly geometry: NonNullable<Mesh['geometry']>;
    readonly geometryRevision: number;
    readonly lightManager: LightManager;
    readonly lightUid: string;
    readonly fog: Fog | null;
    readonly fogMode: Fog['mode'] | null;
    readonly useLogDepth: boolean;
    readonly jointCount: number | null;
    readonly shaderName: string;
    readonly lightType: string;
    readonly commonOptions: Readonly<Record<string, number>>;
    readonly variant: HeaderVariant;
}

interface BeforeCompileSnapshot {
    readonly callback: NonNullable<Material['onBeforeCompile']>;
    readonly materialRevision: number;
    readonly shaderFamily: string;
    readonly vs: string;
    readonly fs: string;
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

function runBeforeCompile(
    material: Material,
    callback: NonNullable<Material['onBeforeCompile']>,
    vs: string,
    fs: string
): MaterialShaderSource {
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
}

interface MaterialShaderSource {
    readonly vs: string;
    readonly fs: string;
}

function skeletonJointCount(mesh: Mesh): number | null {
    if (!hasTrueFlag(mesh, 'isSkinnedMesh')) return null;
    const skeleton: unknown = Reflect.get(mesh, 'skeleton');
    if (typeof skeleton !== 'object' || skeleton === null) return null;
    const count: unknown = Reflect.get(skeleton, 'jointCount');
    return typeof count === 'number' ? count : null;
}

function optionValueEqual(left: number | undefined, right: number | undefined): boolean {
    return left === right || (Number.isNaN(left) && Number.isNaN(right));
}

function commonOptionsEqual(
    left: Readonly<Record<string, number>>,
    right: Readonly<Record<string, number>>
): boolean {
    let leftCount = 0;
    let rightCount = 0;
    for (const name in left) {
        if (!Object.hasOwn(left, name)) continue;
        leftCount++;
        if (!Object.hasOwn(right, name) || !optionValueEqual(left[name], right[name])) return false;
    }
    for (const name in right) {
        if (Object.hasOwn(right, name)) rightCount++;
    }
    return leftCount === rightCount;
}

/**
 * Shader类
 */
class Shader {
    readonly isShader = true;
    readonly className = 'Shader';
    readonly id: string;
    private _isDestroyed = false;
    private _variantKey: string | null = null;
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
    static reset(): void {
        for (const [variantKey, shader] of trackedShaderVariants) {
            if (shader._variantKey === variantKey) shader._variantKey = null;
        }
        trackedShaderVariants.clear();
        cache.removeAll();
        headerCache.removeAll();
        headerVariantKeys.clear();
        shaderVariantKeys.clear();
        stringFingerprints.clear();
        trackedHeaderVariantKeys.clear();
        meshHeaderSnapshots = new WeakMap<Mesh, HeaderVariantSnapshot[]>();
        beforeCompileSnapshots = new WeakMap<Material, BeforeCompileSnapshot>();
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
        return this.getHeaderVariant(mesh, material, lightManager, fog, useLogDepth).headerKey;
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
        const variant = this.getHeaderVariant(mesh, material, lightManager, fog, useLogDepth);
        const cached = headerCache.get(variant.headerKey);
        if (cached) return cached;

        let header = `#define SHADER_NAME ${variant.shaderName}\n`;
        header += `${Object.entries(variant.options)
            .map(([name, value]) => {
                if (name.includes(CUSTOM_OPTION_PREFIX)) {
                    return `#define ${name.replace(CUSTOM_OPTION_PREFIX, '')} ${String(value)}`;
                }
                return `#define HILO_${name} ${String(value)}`;
            })
            .join('\n')}\n`;
        headerCache.add(variant.headerKey, header);
        return header;
    }

    private static getHeaderVariant(
        mesh: Mesh,
        material: Material,
        lightManager: LightManager,
        fog: Fog | null,
        useLogDepth: boolean
    ): HeaderVariant {
        const geometry = mesh.geometry;
        if (!geometry) {
            throw new Error('Cannot create a shader header for a mesh without geometry');
        }

        const materialRevision = material.revision;
        const geometryRevision = geometry.revision;
        const lightUid = lightManager.lightInfo.uid;
        const fogMode = fog?.mode ?? null;
        const jointCount = skeletonJointCount(mesh);
        const shaderName = material.shaderName ?? material.className;
        const lightType = material.lightType;
        const snapshots = meshHeaderSnapshots.get(mesh);
        let cachedSnapshot: HeaderVariantSnapshot | undefined;
        if (snapshots) {
            for (const snapshot of snapshots) {
                if (
                    snapshot.material === material &&
                    snapshot.materialRevision === materialRevision &&
                    snapshot.geometry === geometry &&
                    snapshot.geometryRevision === geometryRevision &&
                    snapshot.lightManager === lightManager &&
                    snapshot.lightUid === lightUid &&
                    snapshot.fog === fog &&
                    snapshot.fogMode === fogMode &&
                    snapshot.useLogDepth === useLogDepth &&
                    snapshot.jointCount === jointCount &&
                    snapshot.shaderName === shaderName &&
                    snapshot.lightType === lightType &&
                    commonOptionsEqual(snapshot.commonOptions, this.commonOptions)
                ) {
                    cachedSnapshot = snapshot;
                    break;
                }
            }
        }
        if (cachedSnapshot) {
            this.trackHeaderVariantKey(cachedSnapshot.variant.headerKey);
            return cachedSnapshot.variant;
        }

        const options: Record<string, number> = { ...this.commonOptions };
        if (lightType && lightType !== 'NONE') {
            lightManager.getRenderOption(options);
            const limits: readonly (readonly [string, number])[] = [
                ['DIRECTIONAL_LIGHTS', MAX_DIRECTIONAL_LIGHTS],
                ['SPOT_LIGHTS', MAX_SPOT_LIGHTS],
                ['POINT_LIGHTS', MAX_POINT_LIGHTS],
                ['AREA_LIGHTS', MAX_AREA_LIGHTS]
            ];
            for (const [name, limit] of limits) {
                const count = options[name] ?? 0;
                if (count > limit) {
                    throw new RangeError(
                        `${name} count ${String(count)} exceeds the fixed UBO capacity ${String(limit)}`
                    );
                }
            }
        }
        material.getRenderOption(options);
        mesh.getRenderOption(options);
        if (fog) {
            options['HAS_FOG'] = 1;
            fog.getRenderOption(options);
        }
        if (useLogDepth) {
            options['USE_LOG_DEPTH'] = 1;
            options['USE_FRAG_DEPTH'] = 1;
        }
        if (options['HAS_NORMAL'] && options['NORMAL_MAP']) {
            options['HAS_TANGENT'] = 1;
        }
        if (!options['RECEIVE_SHADOWS']) {
            delete options['DIRECTIONAL_LIGHTS_SMC'];
            delete options['SPOT_LIGHTS_SMC'];
            delete options['POINT_LIGHTS_SMC'];
        }

        const values: VariantHashValue[] = [shaderName];
        const optionNames = Object.keys(options).sort();
        for (const name of optionNames) {
            const value = options[name];
            if (typeof value === 'number' && !Number.isFinite(value)) {
                throw new RangeError(
                    `Shader option ${name} must be finite; received ${String(value)}`
                );
            }
            values.push(name, value);
        }
        const variant: HeaderVariant = {
            headerKey: headerVariantKeys.resolve('h', values),
            options,
            shaderName
        };
        this.trackHeaderVariantKey(variant.headerKey);

        const currentSnapshots = meshHeaderSnapshots.get(mesh) ?? [];
        const replacedIndex = currentSnapshots.findIndex(
            snapshot =>
                snapshot.material === material &&
                snapshot.geometry === geometry &&
                snapshot.lightManager === lightManager &&
                snapshot.fog === fog &&
                snapshot.useLogDepth === useLogDepth
        );
        if (replacedIndex >= 0) currentSnapshots.splice(replacedIndex, 1);
        currentSnapshots.unshift({
            material,
            materialRevision,
            geometry,
            geometryRevision,
            lightManager,
            lightUid,
            fog,
            fogMode,
            useLogDepth,
            jointCount,
            shaderName,
            lightType,
            commonOptions: { ...this.commonOptions },
            variant
        });
        if (currentSnapshots.length > MESH_HEADER_SNAPSHOT_LIMIT) currentSnapshots.pop();
        meshHeaderSnapshots.set(mesh, currentSnapshots);
        return variant;
    }

    private static trackHeaderVariantKey(headerKey: string): void {
        if (trackedHeaderVariantKeys.delete(headerKey)) {
            trackedHeaderVariantKeys.set(headerKey, true);
            return;
        }
        trackedHeaderVariantKeys.set(headerKey, true);
        if (trackedHeaderVariantKeys.size <= HEADER_VARIANT_CACHE_LIMIT) return;

        const oldest = trackedHeaderVariantKeys.keys().next().value;
        if (oldest === undefined) return;
        trackedHeaderVariantKeys.delete(oldest);
        headerCache.remove(oldest);
        headerVariantKeys.release(oldest);
        // A snapshot may retain an evicted collision slot, so invalidate all weak snapshots.
        meshHeaderSnapshots = new WeakMap<Mesh, HeaderVariantSnapshot[]>();
    }

    private static trackShaderVariant(variantKey: string, shader: Shader): void {
        trackedShaderVariants.delete(variantKey);
        trackedShaderVariants.set(variantKey, shader);
        if (trackedShaderVariants.size <= SHADER_VARIANT_CACHE_LIMIT) return;

        const oldest = trackedShaderVariants.entries().next().value;
        if (oldest === undefined) return;
        const [oldestKey, oldestShader] = oldest;
        trackedShaderVariants.delete(oldestKey);
        if (cache.get(oldestKey) === oldestShader) cache.remove(oldestKey);
        if (oldestShader._variantKey === oldestKey) oldestShader._variantKey = null;
        shaderVariantKeys.release(oldestKey);
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
        const shaderFamily = isPBRMaterial(material)
            ? 'pbr'
            : isBasicMaterial(material) && material.isGeometryMaterial
              ? 'geometry'
              : 'basic';
        let key = `${shaderFamily}:${material.className}:${isUseInstance ? 'instanced' : 'single'}`;
        let fs = '';
        let vs = basicVertCode;
        if (isBasicMaterial(material)) {
            fs = material.isGeometryMaterial ? geometryFragCode : basicFragCode;
        } else if (isPBRMaterial(material)) {
            fs = pbrFragCode;
        }

        const compile = material.onBeforeCompile;
        if (compile) {
            key += `:${material.shaderCacheId ?? material.id}`;
            const snapshot = beforeCompileSnapshots.get(material);
            if (
                snapshot?.callback === compile &&
                snapshot.materialRevision === material.revision &&
                snapshot.shaderFamily === shaderFamily
            ) {
                vs = snapshot.vs;
                fs = snapshot.fs;
            } else {
                const compiled = runBeforeCompile(material, compile, vs, fs);
                vs = compiled.vs;
                fs = compiled.fs;
                beforeCompileSnapshots.set(material, {
                    callback: compile,
                    materialRevision: material.revision,
                    shaderFamily,
                    vs,
                    fs
                });
            }
        }
        const commonHeader = this.getRendererHeader(renderer);
        const variantValues: VariantHashValue[] = [key, commonHeader, header, true, vs, fs];
        const hashedValues: VariantHashValue[] = [
            key,
            commonHeader,
            getStringFingerprint(header),
            true,
            getStringFingerprint(vs),
            getStringFingerprint(fs)
        ];
        const variantKey = shaderVariantKeys.resolve('b', variantValues, hashedValues);
        let shader = cache.get(variantKey);
        if (!shader) {
            const shaderHeader = commonHeader + header;
            shader = new Shader({
                vs: this.assembleGLSL300(vs, shaderHeader),
                fs: this.assembleGLSL300(fs, shaderHeader)
            });
            shader._variantKey = variantKey;
            cache.add(variantKey, shader);
        }
        this.trackShaderVariant(variantKey, shader);
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
            const variantValues: VariantHashValue[] = [
                cacheKey,
                commonHeader,
                header,
                useHeaderCache,
                vs,
                fs
            ];
            cacheKey = shaderVariantKeys.resolve('c', variantValues, [
                cacheKey,
                commonHeader,
                getStringFingerprint(header),
                useHeaderCache,
                getStringFingerprint(vs),
                getStringFingerprint(fs)
            ]);
            shader = cache.get(cacheKey);
        }
        if (!shader) {
            const shaderHeader = commonHeader + header;
            shader = new Shader({
                vs: this.assembleGLSL300(vs, shaderHeader),
                fs: this.assembleGLSL300(fs, shaderHeader)
            });
            if (cacheKey) {
                shader._variantKey = cacheKey;
                cache.add(cacheKey, shader);
            }
        }
        if (cacheKey) this.trackShaderVariant(cacheKey, shader);
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
        const wasCached = cache.getObject(this) === this;
        if (wasCached) {
            cache.removeObject(this);
            if (this._variantKey) {
                if (trackedShaderVariants.get(this._variantKey) === this) {
                    trackedShaderVariants.delete(this._variantKey);
                }
                shaderVariantKeys.release(this._variantKey);
            }
        }
        this._variantKey = null;
        this._isDestroyed = true;
        return this;
    }
}
export default Shader;
