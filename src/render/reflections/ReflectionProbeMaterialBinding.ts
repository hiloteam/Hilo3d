import { ReflectionProbe, reflectionProbeState } from './ReflectionProbe';
import UniformBuffer from '../UniformBuffer';
import { createStd140Layout } from '../ubo/Std140Layout';
import type Texture from '../../texture/Texture';

const layout = createStd140Layout({
    u_reflectionPosition: { type: 'vec4', arrayLength: 2 },
    u_reflectionBoxMin: { type: 'vec4', arrayLength: 2 },
    u_reflectionBoxMax: { type: 'vec4', arrayLength: 2 },
    u_reflectionAtlas: { type: 'vec4', arrayLength: 2 }
});

/** @internal Shared portable material ABI, independent of light iteration and SSR composition. */
export class ReflectionProbeMaterialBinding {
    readonly probes: readonly ReflectionProbe[];
    readonly #buffer = new UniformBuffer(layout);
    readonly #revisions = [-1, -1];
    readonly #textureRevisions = [-1, -1];
    readonly #positions = new Float32Array(8);
    readonly #minimum = new Float32Array(8);
    readonly #maximum = new Float32Array(8);
    readonly #atlas = new Float32Array(8);

    constructor(probes: readonly ReflectionProbe[]) {
        const candidate: unknown = probes;
        if (
            !Array.isArray(candidate) ||
            probes.length < 1 ||
            probes.length > 2 ||
            probes.some(probe => !(probe instanceof ReflectionProbe)) ||
            new Set(probes).size !== probes.length
        ) {
            throw new TypeError(
                'PBR reflectionProbes requires one or two distinct ReflectionProbe objects'
            );
        }
        this.probes = Object.freeze([...probes]);
    }

    get buffer(): UniformBuffer {
        let dirty = false;
        for (let index = 0; index < this.probes.length; index++) {
            const probe = this.probes[index];
            if (probe === undefined) throw new Error('Missing reflection probe');
            const state = reflectionProbeState(probe);
            const offset = index * 4;
            const maxLod = probe.dynamic
                ? state.maxLod
                : state.texture.useMipmap
                  ? Math.max(0, state.texture.mipmapCount - 1)
                  : 0;
            if (
                this.#revisions[index] === state.revision &&
                this.#textureRevisions[index] === state.texture.updateRevision &&
                this.#maximum[offset + 3] === maxLod
            )
                continue;
            this.#revisions[index] = state.revision;
            this.#textureRevisions[index] = state.texture.updateRevision;
            this.#positions.set(probe.position, offset);
            this.#positions[offset + 3] = state.ready ? probe.intensity : 0;
            this.#minimum.set(probe.boxMin, offset);
            this.#minimum[offset + 3] = probe.blendDistance;
            this.#maximum.set(probe.boxMax, offset);
            this.#maximum[offset + 3] = maxLod;
            this.#atlas.set(
                [state.atlasWidth, state.atlasHeight, probe.encoding === 'rgbd' ? 1 : 0, 0],
                offset
            );
            dirty = true;
        }
        if (dirty) {
            this.#buffer.set('u_reflectionPosition', this.#positions);
            this.#buffer.set('u_reflectionBoxMin', this.#minimum);
            this.#buffer.set('u_reflectionBoxMax', this.#maximum);
            this.#buffer.set('u_reflectionAtlas', this.#atlas);
        }
        return this.#buffer;
    }

    texture(index: number): Texture<unknown> {
        const probe = this.probes[index];
        if (probe === undefined) throw new Error('Missing reflection probe texture');
        return reflectionProbeState(probe).texture;
    }
}
