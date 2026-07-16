import type Shader from '../../shader/Shader';
import type { RHIBackend, RHIDevice, RHIShader, RHIShaderArtifactInput } from '../rhi/core';
import type {
    CompiledShaderArtifactPair,
    ShaderArtifactCompiler,
    ShaderFragmentOutputMode
} from './ShaderArtifactCompiler';
import type { ResourceRegistry, ResourceRegistryHandle } from './ResourceRegistry';

export interface ShaderResourceHandlePair {
    readonly backend: RHIBackend;
    readonly token: number;
    readonly vertex: ResourceRegistryHandle<RHIShader>;
    readonly fragment: ResourceRegistryHandle<RHIShader>;
}

export interface ResolvedShaderResourcePair {
    readonly backend: RHIBackend;
    readonly token: number;
    readonly vertex: RHIShader;
    readonly fragment: RHIShader;
}

interface ShaderResourceRecord {
    readonly shader: Shader;
    readonly fragmentOutputMode: ShaderFragmentOutputMode;
    readonly numericDepthSamplerMask: number;
    readonly handles: Readonly<ShaderResourceHandlePair>;
}

interface ShaderResourceRecordSet {
    readonly color: Map<number, ShaderResourceRecord>;
    readonly 'depth-only': Map<number, ShaderResourceRecord>;
}

function createRecordSet(): ShaderResourceRecordSet {
    return { color: new Map(), 'depth-only': new Map() };
}

function createShaderFromArtifact(
    device: RHIDevice,
    artifact: Readonly<RHIShaderArtifactInput>,
    label: string
): RHIShader {
    if (device.backend !== artifact.backend) {
        throw new Error(
            `Shader artifact backend ${artifact.backend} cannot be rebuilt on ${device.backend}`
        );
    }
    return device.createShader({
        label,
        lifetime: 'persistent',
        artifact
    });
}

/**
 * Owns recoverable logical shader-module handles for final engine Shader sources.
 * Cache records retain registry handles, while recipes close over immutable artifacts. Concrete
 * RHI/native shaders are resolved on demand and never cross the cache boundary as stored state.
 */
export class ShaderResourceCache {
    #recordsByShader = new WeakMap<Shader, ShaderResourceRecordSet>();
    readonly #records = new Set<ShaderResourceRecord>();
    #destroyed = false;

    constructor(
        readonly registry: ResourceRegistry,
        readonly compiler: ShaderArtifactCompiler
    ) {}

    prepare(
        shader: Shader,
        fragmentOutputMode: ShaderFragmentOutputMode = 'color',
        numericDepthSamplerMask = 0
    ): Readonly<ShaderResourceHandlePair> {
        this.assertAlive();
        const compiled = this.compiler.compile(shader, this.registry.deviceBackend, {
            fragmentOutputs: fragmentOutputMode,
            numericDepthSamplerMask
        });
        let recordSet = this.#recordsByShader.get(shader);
        if (recordSet === undefined) {
            recordSet = createRecordSet();
            this.#recordsByShader.set(shader, recordSet);
        }
        const recordsByDepthMask = recordSet[fragmentOutputMode];
        const current = recordsByDepthMask.get(numericDepthSamplerMask);
        if (
            current?.handles.backend === compiled.backend &&
            current.handles.token === compiled.token
        ) {
            return current.handles;
        }

        const replacement = this.createRecord(shader, compiled);
        recordsByDepthMask.set(numericDepthSamplerMask, replacement);
        this.#records.add(replacement);
        if (current !== undefined) {
            this.#records.delete(current);
            this.releaseRecord(current);
        }
        return replacement.handles;
    }

    resolve(
        shader: Shader,
        fragmentOutputMode: ShaderFragmentOutputMode = 'color',
        numericDepthSamplerMask = 0
    ): Readonly<ResolvedShaderResourcePair> {
        this.assertAlive();
        const handles = this.requireRecord(
            shader,
            fragmentOutputMode,
            numericDepthSamplerMask
        ).handles;
        if (handles.backend !== this.registry.deviceBackend) {
            throw new Error(
                `Cached shader backend ${handles.backend} does not match registry backend ${this.registry.deviceBackend}`
            );
        }
        return Object.freeze({
            backend: handles.backend,
            token: handles.token,
            vertex: this.registry.resolve(handles.vertex),
            fragment: this.registry.resolve(handles.fragment)
        });
    }

    markUsed(
        shader: Shader,
        frameIndex: number,
        fragmentOutputMode: ShaderFragmentOutputMode = 'color',
        numericDepthSamplerMask = 0
    ): void {
        this.assertAlive();
        const handles = this.requireRecord(
            shader,
            fragmentOutputMode,
            numericDepthSamplerMask
        ).handles;
        this.registry.markUsed(handles.vertex, frameIndex);
        this.registry.markUsed(handles.fragment, frameIndex);
    }

    detach(shader: Shader): boolean {
        this.assertAlive();
        const recordSet = this.#recordsByShader.get(shader);
        if (recordSet === undefined) return false;
        this.#recordsByShader.delete(shader);
        for (const mode of ['color', 'depth-only'] as const) {
            for (const record of recordSet[mode].values()) {
                this.#records.delete(record);
                this.releaseRecord(record);
            }
            recordSet[mode].clear();
        }
        return true;
    }

    destroy(): void {
        if (this.#destroyed) return;
        for (const record of this.#records) this.releaseRecord(record);
        this.#records.clear();
        this.#recordsByShader = new WeakMap();
        this.#destroyed = true;
    }

    private createRecord(
        shader: Shader,
        compiled: Readonly<CompiledShaderArtifactPair>
    ): ShaderResourceRecord {
        if (compiled.backend !== this.registry.deviceBackend) {
            throw new Error('Compiled shader backend does not match the resource registry');
        }
        const specialization = `${
            compiled.fragmentOutputMode === 'color' ? '' : ` ${compiled.fragmentOutputMode}`
        }${
            compiled.numericDepthSamplerMask === 0
                ? ''
                : ` numeric-depth-${String(compiled.numericDepthSamplerMask)}`
        }`;
        const vertexLabel = `Shader ${shader.id}${specialization} vertex`;
        const fragmentLabel = `Shader ${shader.id}${specialization} fragment`;
        const vertex = this.registry.register<RHIShader>({
            label: vertexLabel,
            create: device => createShaderFromArtifact(device, compiled.vertex, vertexLabel)
        });
        let fragment: ResourceRegistryHandle<RHIShader>;
        try {
            fragment = this.registry.register<RHIShader>({
                label: fragmentLabel,
                create: device => createShaderFromArtifact(device, compiled.fragment, fragmentLabel)
            });
        } catch (error) {
            this.registry.discardUnsubmitted(vertex);
            throw error;
        }
        return {
            shader,
            fragmentOutputMode: compiled.fragmentOutputMode,
            numericDepthSamplerMask: compiled.numericDepthSamplerMask,
            handles: Object.freeze({
                backend: compiled.backend,
                token: compiled.token,
                vertex,
                fragment
            })
        };
    }

    private requireRecord(
        shader: Shader,
        fragmentOutputMode: ShaderFragmentOutputMode,
        numericDepthSamplerMask: number
    ): ShaderResourceRecord {
        const record = this.#recordsByShader
            .get(shader)
            ?.[fragmentOutputMode].get(numericDepthSamplerMask);
        if (record === undefined) {
            throw new Error(
                `${fragmentOutputMode === 'color' ? 'Shader' : 'Depth-only shader'} is not prepared in this resource cache`
            );
        }
        return record;
    }

    private releaseRecord(record: ShaderResourceRecord): void {
        this.registry.release(record.handles.vertex);
        this.registry.release(record.handles.fragment);
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('Shader resource cache is destroyed');
    }
}
