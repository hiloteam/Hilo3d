import { describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Node from '../../../src/core/Node';
import Renderer from '../../../src/render/Renderer';
import type { StorageBuffer } from '../../../src/render/StorageBuffer';
import ComputeKernel from '../../../src/render/compute/ComputeKernel';
import ComputeShader from '../../../src/render/compute/ComputeShader';
import type {
    RenderPipeline,
    RenderPipelineContext
} from '../../../src/render/pipeline/RenderPipeline';
import { ComputeRenderPass } from '../../../src/render/pipeline/passes';
import {
    createScreenSpaceReflectionSpatialFilterPass,
    snapshotScreenSpaceReflectionsOptions
} from '../../../src/render/postprocessing/ScreenSpaceReflections';
import { REFLECTION_HISTORY_WGSL } from '../../../src/render/postprocessing/ScreenSpaceReflectionHistory';

const SIZE = 16;
const TEXELS = SIZE * SIZE;
const stages = ['reconstruction', 'stability', 'cleanup'] as const;
const settings = snapshotScreenSpaceReflectionsOptions({ roughnessCutoff: 0.32 });

function seedPass(pattern: 'isolated' | 'uniform' | 'hole'): ComputeRenderPass {
    const condition =
        pattern === 'uniform' ? 'true' : pattern === 'isolated' ? 'center' : '!center';
    return new ComputeRenderPass(
        new ComputeKernel({
            shader: new ComputeShader({
                label: `SSR ${pattern} sample field`,
                source: `
@group(0) @binding(0) var reflection: texture_storage_2d<rgba16float, write>;
@group(0) @binding(1) var motion: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var attributes: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var state: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let pixel = vec2<i32>(id.xy);
    let center = all(id.xy == vec2<u32>(8u));
    let hit = ${condition};
    textureStore(reflection, pixel, select(vec4<f32>(0.0), vec4<f32>(0.5, 0.25, 0.125, 1.25), hit));
    textureStore(motion, pixel, vec4<f32>(0.0, 0.0, 2.0, 2.0));
    textureStore(attributes, pixel, vec4<f32>(0.5, 0.5, 0.11, 1.0 / 255.0));
    textureStore(state, pixel, vec4<f32>(0.5, 0.5, 0.11, select(0.0, 3.0, hit)));
}`,
                workgroupSize: [8, 8],
                bindings: ['reflection', 'motion', 'attributes', 'state'].map((name, binding) => ({
                    name,
                    group: 0,
                    binding,
                    kind: 'storage-texture' as const,
                    access: 'write-only' as const,
                    format: 'rgba16float' as const
                }))
            })
        })
    );
}

const readback = new ComputeRenderPass(
    new ComputeKernel({
        shader: new ComputeShader({
            source: `
${REFLECTION_HISTORY_WGSL}
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> result: array<vec4<f32>>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let value = textureLoad(source, vec2<i32>(id.xy), 0);
    result[id.y * 16u + id.x] = vec4<f32>(value.rgb, historyConfidence(value.a));
}`,
            workgroupSize: [8, 8],
            bindings: [
                {
                    name: 'source',
                    group: 0,
                    binding: 0,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'result',
                    group: 0,
                    binding: 1,
                    kind: 'storage-buffer',
                    access: 'write-discard'
                }
            ]
        })
    })
);

describe('SSR spatial reflection coverage', () => {
    it.each(['isolated', 'uniform', 'hole'] as const)(
        'filters the %s field without inventing coverage',
        async pattern => {
            const filters = stages.map(stage =>
                createScreenSpaceReflectionSpatialFilterPass(settings, stage)
            );
            const seed = seedPass(pattern);
            const owned: StorageBuffer[] = [];
            const runtime: RenderPipeline = {
                name: 'SSR spatial coverage regression',
                record(context: RenderPipelineContext): void {
                    const [diagnostics, tiles, result] = owned;
                    if (diagnostics === undefined || tiles === undefined || result === undefined)
                        throw new Error('Missing filter buffers');
                    const descriptor = {
                        format: 'rgba16float' as const,
                        extent: { width: SIZE, height: SIZE },
                        usage: ['sampled' as const, 'storage' as const]
                    };
                    const source = context.graph.createTexture('current reflection', descriptor);
                    const motion = context.graph.createTexture('receiver motion', descriptor);
                    const attributes = context.graph.createTexture('receiver material', descriptor);
                    const state = context.graph.createTexture('hit depth', descriptor);
                    const response = attributes;
                    context.graph.addPass(seed, {
                        buffers: [],
                        textures: [source, motion, attributes, state].map(texture => ({
                            texture
                        })),
                        dispatch: { x: 2, y: 2 }
                    });
                    const buffers = [diagnostics, tiles].map(buffer => ({
                        buffer: context.graph.importStorageBuffer(buffer)
                    }));
                    let filtered = source;
                    for (const filter of filters) {
                        const destination = context.graph.createTexture(filter.name, descriptor);
                        context.graph.addPass(filter, {
                            buffers,
                            textures: [
                                filtered,
                                motion,
                                attributes,
                                state,
                                response,
                                destination
                            ].map(texture => ({ texture })),
                            dispatch: { x: 4 }
                        });
                        filtered = destination;
                    }
                    context.graph.addPass(readback, {
                        buffers: [{ buffer: context.graph.importStorageBuffer(result) }],
                        textures: [{ texture: filtered }],
                        dispatch: { x: 2, y: 2 }
                    });
                },
                destroy(): void {
                    for (const buffer of owned) buffer.destroy();
                }
            };
            const renderer = await Renderer.create({
                backend: 'webgpu',
                width: SIZE,
                height: SIZE,
                antialias: false,
                domElement: document.createElement('canvas'),
                renderPipeline: { name: runtime.name, create: (): RenderPipeline => runtime }
            });
            try {
                owned.push(
                    renderer.createStorageBuffer({
                        byteLength: 32,
                        usage: ['storage'],
                        initialData: new Uint32Array([4, 0, 0, 0, 0, 0, 0, 0])
                    })
                );
                owned.push(
                    renderer.createStorageBuffer({
                        byteLength: 16,
                        usage: ['storage'],
                        initialData: new Uint32Array([0, 1, 65536, 65537])
                    })
                );
                const result = renderer.createStorageBuffer({
                    byteLength: TEXELS * 16,
                    usage: ['storage', 'copy-source']
                });
                owned.push(result);
                renderer.render(new Node(), new PerspectiveCamera());
                const snapshot = await result.read();
                const values = new Float32Array(
                    snapshot.data.buffer,
                    snapshot.data.byteOffset,
                    TEXELS * 4
                );
                const confidence = Array.from(
                    { length: TEXELS },
                    (_unused, index) => values[index * 4 + 3] ?? 0
                );
                // Input straight radiance is (1, .5, .25); every output must remain premultiplied.
                // Replacing an equal IBL fallback then contributes exactly zero extra energy.
                for (let offset = 0; offset < values.length; offset += 4) {
                    const coverage = values[offset + 3] ?? 0;
                    for (const [channel, fallback] of [1, 0.5, 0.25].entries()) {
                        expect(
                            Math.abs((values[offset + channel] ?? 0) - fallback * coverage)
                        ).toBeLessThan(0.001);
                    }
                }
                if (pattern === 'isolated') {
                    // A single half-covered hit must not become an opaque 7x7 block after three filters.
                    expect(Math.max(...confidence)).toBeLessThan(0.08);
                    expect(confidence.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(
                        0.55
                    );
                    expect(confidence.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(0.4);
                } else {
                    // A uniform valid field is a fixed point, and one stochastic miss is reconstructed.
                    const first = pattern === 'hole' ? (8 * SIZE + 8) * 4 : 0;
                    for (
                        let offset = first;
                        offset < (pattern === 'hole' ? first + 4 : values.length);
                        offset += 4
                    ) {
                        if (pattern === 'uniform') {
                            expect(values[offset]).toBeCloseTo(0.5, 3);
                            expect(values[offset + 1]).toBeCloseTo(0.25, 3);
                            expect(values[offset + 2]).toBeCloseTo(0.125, 3);
                        }
                        expect(values[offset + 3]).toBeGreaterThan(0.45);
                        expect(values[offset + 3]).toBeLessThanOrEqual(0.5);
                    }
                }
            } finally {
                renderer.destroy();
            }
        }
    );
});
