import { beforeAll, describe, expect, it } from 'vitest';
import Color from '../../../src/math/Color';
import Vector3 from '../../../src/math/Vector3';
import PointLight from '../../../src/light/PointLight';
import AreaLight from '../../../src/light/AreaLight';
import SpotLight from '../../../src/light/SpotLight';
import {
    DynamicGlobalIlluminationController,
    createDynamicGlobalIlluminationShader,
    snapshotDynamicGlobalIlluminationOptions
} from '../../../src/render/gi/DynamicGlobalIllumination';
import {
    RayTracingScene,
    type RayTracingSceneSnapshot
} from '../../../src/render/gi/RayTracingScene';
import Node from '../../../src/core/Node';
import { WgslComputeShaderCompiler } from '../../../src/render/shader/WgslComputeCompiler';
import type {
    StorageBuffer,
    StorageBufferDescriptor,
    StorageBufferRange,
    StorageBufferReadback
} from '../../../src/render/StorageBuffer';
import type {
    RenderPipelineContext,
    RenderPipelineCreateContext
} from '../../../src/render/pipeline/RenderPipeline';
import {
    acquireRenderPassParameters,
    type RenderPassParameterPool
} from '../../../src/render/pipeline/RenderPassParameterPool';
import type { RenderGraphBufferHandle } from '../../../src/render/pipeline/ScriptableRenderGraph';

class TestStorage implements StorageBuffer {
    readonly backend = 'webgpu';
    readonly label: string;
    readonly byteLength: number;
    readonly usage: ReadonlySet<StorageBufferDescriptor['usage'][number]>;
    readonly recovery: 'cpu-shadow' | 'reinitialize';
    isDestroyed = false;
    readonly writes: Float32Array[] = [];
    readonly writeOffsets: number[] = [];

    constructor(descriptor: Readonly<StorageBufferDescriptor>) {
        this.label = descriptor.label ?? '';
        this.byteLength = descriptor.byteLength;
        this.usage = new Set(descriptor.usage);
        this.recovery = descriptor.recovery ?? 'cpu-shadow';
    }
    write(offset: number, data: ArrayBufferView): void {
        this.writeOffsets.push(offset);
        this.writes.push(
            new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
        );
    }
    range(byteOffset: number, byteLength: number): StorageBufferRange {
        return { buffer: this, byteOffset, byteLength };
    }
    read(): Promise<StorageBufferReadback> {
        return Promise.resolve({ data: new Uint8Array(0), byteOffset: 0, byteLength: 0 });
    }
    destroy(): void {
        this.isDestroyed = true;
    }
}

function fixture(options: Parameters<typeof snapshotDynamicGlobalIlluminationOptions>[0] = {}): {
    readonly controller: DynamicGlobalIlluminationController;
    readonly buffers: TestStorage[];
    readonly scene: RayTracingSceneSnapshot;
    readonly context: (frameIndex: number, valid?: boolean) => RenderPipelineContext;
} {
    const buffers: TestStorage[] = [];
    const owner = {};
    const handles = new Map<StorageBuffer, RenderGraphBufferHandle>();
    const createContext = {
        createStorageBuffer(descriptor: Readonly<StorageBufferDescriptor>): StorageBuffer {
            const buffer = new TestStorage(descriptor);
            buffers.push(buffer);
            handles.set(buffer, buffers.length as RenderGraphBufferHandle);
            return buffer;
        }
    } as unknown as RenderPipelineCreateContext;
    const settings = snapshotDynamicGlobalIlluminationOptions({
        probeCounts: [2, 2, 2],
        maxProbesPerFrame: 3,
        maxTriangles: 16,
        ...(options as object)
    });
    const controller = new DynamicGlobalIlluminationController(settings, createContext);
    return {
        controller,
        buffers,
        scene: new RayTracingScene().update(new Node()),
        context(frameIndex: number, valid = true): RenderPipelineContext {
            return {
                frameIndex,
                writeStorageBuffer(
                    buffer: StorageBuffer,
                    offset: number,
                    data: ArrayBufferView
                ): void {
                    buffer.write(offset, data);
                },
                acquirePassParameters<P extends object>(pool: RenderPassParameterPool<P>): P {
                    return acquireRenderPassParameters(pool, owner, frameIndex);
                },
                graph: {
                    acquireHistoryTexture(): { valid: boolean; current: number } {
                        return { valid, current: 100 };
                    },
                    importStorageBuffer(buffer: StorageBuffer): RenderGraphBufferHandle {
                        const handle = handles.get(buffer);
                        if (handle === undefined) throw new Error('Missing imported storage');
                        return handle;
                    },
                    addPass(): void {
                        void 0;
                    }
                }
            } as unknown as RenderPipelineContext;
        }
    };
}

describe('DDGI settings and submission lifecycle', () => {
    it('deeply snapshots origin, spacing, environment and explicit grid budgets', () => {
        const origin = new Vector3(-3, 1, -4);
        const spacing = new Vector3(2, 1, 2);
        const environment = new Color(0.5, 0.25, 0.1);
        const counts: [number, number, number] = [4, 3, 5];
        const settings = snapshotDynamicGlobalIlluminationOptions({
            origin,
            spacing,
            environment,
            probeCounts: counts
        });
        origin.x = 99;
        spacing.y = 5;
        environment.r = 8;
        counts[0] = 128;
        expect(settings.origin.x).toBe(-3);
        expect(settings.spacing.y).toBe(1);
        expect(settings.environment.r).toBe(0.5);
        expect(settings.probeCounts).toEqual([4, 3, 5]);
        expect(settings.probeBufferBytes).toBe(64 + 60 * 2080);
        expect(Object.isFrozen(settings)).toBe(true);
        expect(Object.isFrozen(settings.probeCounts)).toBe(true);
        expect(Object.isFrozen(settings.environment)).toBe(true);
    });

    it.each([
        { probeCounts: [1, 3, 3] },
        { probeCounts: [64, 64, 2] },
        { raysPerProbe: 65 },
        { maxProbesPerFrame: 0 },
        { hysteresis: 1 },
        { bounceStrength: 1 },
        { intensity: -1 },
        { maxRayDistance: Number.NaN },
        { spacing: new Vector3(0, 1, 1) },
        { relocation: 'false' },
        { texturePolicy: 'approximate' },
        { maxLights: 129 }
    ])('rejects invalid setting %j before allocating resources', options => {
        expect(() => snapshotDynamicGlobalIlluminationOptions(options)).toThrow();
    });

    it('advances the bounded round robin only after submission and retries scene uploads after a discard', () => {
        const { controller, context, scene, buffers } = fixture();
        controller.record(context(10, false), { scene, lights: [] });
        const params = buffers[0];
        if (params === undefined) throw new Error('Missing parameters buffer');
        expect(params.writes.at(-1)?.[20]).toBe(0);
        expect(controller.getDiagnostics().submittedFrameCount).toBe(0);
        controller.frameDiscarded(10);
        controller.record(context(11), { scene, lights: [] });
        expect(params.writes.at(-1)?.[20]).toBe(0);
        expect(buffers[1]?.writes).toHaveLength(2);
        controller.frameSubmitted(11);
        controller.record(context(12), { scene, lights: [] });
        expect(params.writes.at(-1)?.[20]).toBe(3);
        expect(buffers[1]?.writes).toHaveLength(2);
        controller.frameSubmitted(12);
        expect(controller.getDiagnostics()).toMatchObject({
            submittedFrameCount: 2,
            updatedProbeCount: 3,
            tracedRayCount: 384,
            updateCycleFrames: 3
        });
        controller.record(context(13), { scene, lights: [] });
        expect(params.writes.at(-1)?.[20]).toBe(6);
        controller.frameSubmitted(13);
        controller.record(context(14), { scene, lights: [] });
        expect(params.writes.at(-1)?.[20]).toBe(1);
        controller.destroy();
        expect(buffers.every(buffer => buffer.isDestroyed)).toBe(true);
    });

    it('uploads dirty spans only over their submitted base and retries/falls back correctly', () => {
        const { controller, context, scene, buffers } = fixture();
        controller.record(context(1), { scene, lights: [] });
        controller.frameSubmitted(1);
        const partial: RayTracingSceneSnapshot = {
            ...scene,
            revision: scene.revision + 1,
            baseRevision: scene.revision,
            triangleDirtyRanges: [{ byteOffset: 32, byteLength: 16 }],
            nodeDirtyRanges: []
        };
        controller.record(context(2), { scene: partial, lights: [] });
        expect(buffers[1]?.writes.at(-1)?.byteLength).toBe(16);
        expect(buffers[1]?.writeOffsets.at(-1)).toBe(32);
        expect(buffers[2]?.writes).toHaveLength(1);
        controller.frameDiscarded(2);
        controller.record(context(3), { scene: partial, lights: [] });
        expect(buffers[1]?.writes.at(-1)?.byteLength).toBe(16);
        controller.frameSubmitted(3);
        expect(controller.getDiagnostics()).toMatchObject({
            sceneUploadedBytes: 16,
            uploadedBytes: 224
        });
        const skipped: RayTracingSceneSnapshot = {
            ...partial,
            revision: partial.revision + 2,
            baseRevision: partial.revision + 1
        };
        controller.record(context(4), { scene: skipped, lights: [] });
        expect(buffers[1]?.writes.at(-1)?.byteLength).toBe(scene.triangles.byteLength);
        expect(buffers[2]?.writes.at(-1)?.byteLength).toBe(scene.nodes.byteLength);
        controller.frameSubmitted(4);
        expect(controller.getDiagnostics().sceneUploadedBytes).toBe(
            scene.triangles.byteLength + scene.nodes.byteLength
        );
        controller.destroy();
    });

    it('invalidates GPU history on device generation changes and explicit resets', () => {
        const { controller, context, scene, buffers } = fixture();
        controller.record(context(1, false), { scene, lights: [] });
        controller.frameSubmitted(1);
        controller.record(context(2), { scene, lights: [] });
        expect(buffers[0]?.writes.at(-1)?.[23]).toBe(1);
        controller.frameSubmitted(2);
        controller.record(context(3, false), { scene, lights: [] });
        expect(buffers[0]?.writes.at(-1)?.[23]).toBe(0);
        expect(buffers[0]?.writes.at(-1)?.[20]).toBe(0);
        controller.frameSubmitted(3);
        controller.invalidateAll();
        controller.record(context(4), { scene, lights: [] });
        expect(buffers[0]?.writes.at(-1)?.[23]).toBe(0);
        controller.destroy();
    });

    it('changes display intensity independently from submitted multibounce transport', () => {
        const { controller, context, scene, buffers } = fixture();
        controller.setIntensity(0);
        controller.record(context(1), { scene, lights: [] });
        controller.frameSubmitted(1);
        expect(buffers[0]?.writes.at(-1)?.[3]).toBe(0);
        expect(buffers[0]?.writes.at(-1)?.[31]).toBeCloseTo(0.7);
        controller.setIntensity(2);
        controller.record(context(2), { scene, lights: [] });
        expect(buffers[0]?.writes.at(-1)?.[3]).toBe(2);
        expect(buffers[0]?.writes.at(-1)?.[23]).toBe(1);
        expect(() => {
            controller.setIntensity(Number.NaN);
        }).toThrow();
        controller.destroy();
        expect(() => {
            controller.setIntensity(1);
        }).toThrow(/destroyed/u);
    });

    it('snapshots a changed environment and restarts its bounded update cycle without changing immutable settings', () => {
        const { controller, context, scene, buffers } = fixture({
            environment: new Color(1, 2, 3)
        });
        controller.record(context(1, false), { scene, lights: [] });
        controller.frameSubmitted(1);
        const night = new Color(0.01, 0.02, 0.03);
        controller.setEnvironment(night);
        night.set(9, 8, 7, 1);
        controller.record(context(2), { scene, lights: [] });
        expect(buffers[0]?.writes.at(-1)?.[28]).toBeCloseTo(0.01);
        expect(buffers[0]?.writes.at(-1)?.[29]).toBeCloseTo(0.02);
        expect(buffers[0]?.writes.at(-1)?.[30]).toBeCloseTo(0.03);
        expect(buffers[0]?.writes.at(-1)?.[20]).toBe(0);
        expect(buffers[0]?.writes.at(-1)?.[21]).toBe(3);
        expect(buffers[0]?.writes.at(-1)?.[23]).toBe(0);
        expect(controller.settings.environment).toEqual({ r: 1, g: 2, b: 3 });
        expect(buffers).toHaveLength(6);
        controller.destroy();
    });

    it('preserves valid history when the same environment RGB is set again', () => {
        const { controller, context, scene, buffers } = fixture({
            environment: new Color(1, 2, 3)
        });
        controller.record(context(1, false), { scene, lights: [] });
        controller.frameSubmitted(1);
        controller.setEnvironment(new Color(1, 2, 3, 0));
        controller.record(context(2), { scene, lights: [] });
        expect(buffers[0]?.writes.at(-1)?.[20]).toBe(3);
        expect(buffers[0]?.writes.at(-1)?.[23]).toBe(1);
        controller.destroy();
    });

    it('rejects invalid environment colors atomically without invalidating the previous environment', () => {
        const { controller, context, scene, buffers } = fixture({
            environment: new Color(1, 2, 3)
        });
        controller.record(context(1, false), { scene, lights: [] });
        controller.frameSubmitted(1);
        for (const color of [
            new Color(-1, 0, 0),
            new Color(0, Number.NaN, 0),
            new Color(0, 0, Number.POSITIVE_INFINITY),
            new Color(0, 10_001, 0),
            { r: 1, g: 2, b: 3 } as unknown as Color
        ]) {
            expect(() => {
                controller.setEnvironment(color);
            }).toThrow();
        }
        controller.record(context(2), { scene, lights: [] });
        expect(buffers[0]?.writes.at(-1)?.slice(28, 31)).toEqual(new Float32Array([1, 2, 3]));
        expect(buffers[0]?.writes.at(-1)?.[20]).toBe(3);
        expect(buffers[0]?.writes.at(-1)?.[23]).toBe(1);
        controller.destroy();
        expect(() => {
            controller.setEnvironment(new Color());
        }).toThrow(/destroyed/u);
    });

    it('retries an environment reset after discard and retains environment changes made after frame recording', () => {
        const { controller, context, scene, buffers } = fixture({
            environment: new Color(1, 1, 1)
        });
        controller.record(context(1, false), { scene, lights: [] });
        controller.frameSubmitted(1);
        controller.setEnvironment(new Color(0, 0, 0));
        controller.record(context(2), { scene, lights: [] });
        controller.frameDiscarded(2);
        controller.record(context(3), { scene, lights: [] });
        expect(buffers[0]?.writes.at(-1)?.[20]).toBe(0);
        expect(buffers[0]?.writes.at(-1)?.[23]).toBe(0);
        expect(controller.getDiagnostics().submittedFrameCount).toBe(1);
        controller.frameSubmitted(3);
        controller.record(context(4), { scene, lights: [] });
        expect(buffers[0]?.writes.at(-1)?.[20]).toBe(3);
        expect(buffers[0]?.writes.at(-1)?.[23]).toBe(1);
        controller.setEnvironment(new Color(2, 1, 0));
        controller.frameSubmitted(4);
        controller.record(context(5), { scene, lights: [] });
        expect(buffers[0]?.writes.at(-1)?.slice(28, 31)).toEqual(new Float32Array([2, 1, 0]));
        expect(buffers[0]?.writes.at(-1)?.[20]).toBe(0);
        expect(buffers[0]?.writes.at(-1)?.[23]).toBe(0);
        controller.frameSubmitted(5);
        controller.record(context(6), { scene, lights: [] });
        expect(buffers[0]?.writes.at(-1)?.[23]).toBe(1);
        controller.destroy();
    });

    it('reports mesh changes only for a newly submitted scene revision while retaining the last update operation', () => {
        const { controller, context, scene } = fixture();
        const changed: RayTracingSceneSnapshot = {
            ...scene,
            diagnostics: { ...scene.diagnostics, changedMeshCount: 2, update: 'refit' }
        };
        controller.record(context(1), { scene: changed, lights: [] });
        controller.frameSubmitted(1);
        expect(controller.getDiagnostics()).toMatchObject({
            changedMeshCount: 2,
            sceneUpdate: 'refit'
        });
        controller.record(context(2), { scene: changed, lights: [] });
        controller.frameSubmitted(2);
        expect(controller.getDiagnostics()).toMatchObject({
            changedMeshCount: 0,
            sceneUpdate: 'refit'
        });
        const next: RayTracingSceneSnapshot = {
            ...changed,
            revision: changed.revision + 1,
            baseRevision: changed.revision
        };
        controller.record(context(3), { scene: next, lights: [] });
        controller.frameDiscarded(3);
        expect(controller.getDiagnostics().changedMeshCount).toBe(0);
        controller.record(context(4), { scene: next, lights: [] });
        controller.frameSubmitted(4);
        expect(controller.getDiagnostics().changedMeshCount).toBe(2);
        controller.destroy();
    });

    it('reports explicitly excluded lights and rejects them under the default strict policy', () => {
        const strict = fixture();
        expect(() =>
            strict.controller.record(strict.context(1), {
                scene: strict.scene,
                lights: [new AreaLight()]
            })
        ).toThrow(/area lights/u);
        strict.controller.destroy();
        const excluded = fixture({ unsupported: 'exclude' });
        const spot = new SpotLight({ cookie: { intensity: 1 } });
        excluded.controller.record(excluded.context(1), {
            scene: excluded.scene,
            lights: [new AreaLight(), spot, new PointLight()]
        });
        excluded.controller.frameSubmitted(1);
        expect(excluded.controller.getDiagnostics()).toMatchObject({
            lightCount: 1,
            excludedLightCount: 2,
            excludedMeshCount: 0,
            texturedMeshCount: 0
        });
        excluded.controller.destroy();
    });

    it('advances exact lighting revisions only on transport changes and successful submission', () => {
        const { controller, context, scene, buffers } = fixture();
        const light = new PointLight({ color: new Color(1, 0, 0), lightLayerMask: 0xffffffff });
        controller.record(context(1), { scene, lights: [light] });
        expect(buffers[0]?.writes.at(-1)?.[14]).toBe(1);
        controller.frameSubmitted(1);
        controller.record(context(2), { scene, lights: [light] });
        expect(buffers[0]?.writes.at(-1)?.[14]).toBe(1);
        controller.frameSubmitted(2);
        light.color.g = -0;
        controller.record(context(3), { scene, lights: [light] });
        expect(buffers[0]?.writes.at(-1)?.[14]).toBe(1);
        controller.frameSubmitted(3);
        light.color.r = 2;
        controller.record(context(4), { scene, lights: [light] });
        expect(buffers[0]?.writes.at(-1)?.[14]).toBe(2);
        controller.frameDiscarded(4);
        controller.record(context(5), { scene, lights: [light] });
        expect(buffers[0]?.writes.at(-1)?.[14]).toBe(2);
        controller.frameSubmitted(5);
        light.lightLayerMask = 0x80000002;
        controller.record(context(6), { scene, lights: [light] });
        expect(buffers[0]?.writes.at(-1)?.[14]).toBe(3);
        controller.frameSubmitted(6);
        controller.record(context(7), { scene, lights: [] });
        expect(buffers[0]?.writes.at(-1)?.[14]).toBe(4);
        controller.frameSubmitted(7);
        controller.record(context(8), { scene, lights: [] });
        expect(buffers[0]?.writes.at(-1)?.[14]).toBe(4);
        controller.destroy();
    });

    it('packs lightLayerMask independently from camera collection layers without losing uint bits', () => {
        const { controller, context, scene, buffers } = fixture();
        const light = new PointLight({ layer: 1, lightLayerMask: 0x80000002 });
        controller.record(context(1), { scene, lights: [light] });
        const packed = buffers[3]?.writes.at(-1);
        if (packed === undefined) throw new Error('Missing light upload');
        expect(packed.byteLength).toBe(80);
        expect(new Uint32Array(packed.buffer)[16]).toBe(0x80000002);
        controller.destroy();
    });

    it('reuses one probe update across cameras in the same frame and rejects conflicting scene revisions', () => {
        const { controller, context, scene, buffers } = fixture();
        const first = controller.record(context(1), { scene, lights: [] });
        expect(controller.record(context(1), { scene, lights: [] })).toBe(first);
        expect(buffers[0]?.writes).toHaveLength(1);
        expect(() =>
            controller.record(context(1), {
                scene: { ...scene, revision: scene.revision + 1 },
                lights: []
            })
        ).toThrow(/between cameras/u);
        controller.frameSubmitted(1);
        expect(controller.getDiagnostics().submittedFrameCount).toBe(1);
        controller.destroy();
    });

    it('fails light-budget overflow before recording or publishing a frame', () => {
        const { controller, context, scene, buffers } = fixture({ maxLights: 1 });
        expect(() =>
            controller.record(context(1), { scene, lights: [new PointLight(), new PointLight()] })
        ).toThrow(/maxLights/u);
        expect(buffers[0]?.writes).toHaveLength(0);
        expect(controller.getDiagnostics().submittedFrameCount).toBe(0);
        controller.destroy();
    });
});

describe('DDGI real shader contracts', () => {
    const compiler = new WgslComputeShaderCompiler();
    beforeAll(async () => {
        await compiler.initialize();
    });
    it.each([64, 128, 256] as const)(
        'validates the %i-ray BVH traversal and directional probe update through Naga and WebGPU',
        async raysPerProbe => {
            const shader = createDynamicGlobalIlluminationShader(
                snapshotDynamicGlobalIlluminationOptions({ raysPerProbe })
            );
            const compiled = compiler.compile(shader);
            expect(compiled.reflection.workgroupStorageSize).toBeLessThanOrEqual(16384);
            const adapter = await navigator.gpu.requestAdapter();
            if (adapter === null)
                throw new Error('DDGI compiler coverage requires a WebGPU adapter');
            const device = await adapter.requestDevice();
            try {
                const module = device.createShaderModule({ code: shader.source });
                const info = await module.getCompilationInfo();
                expect(info.messages.filter(message => message.type === 'error')).toEqual([]);
                const pipeline = await device.createComputePipelineAsync({
                    layout: 'auto',
                    compute: { module, entryPoint: 'main' }
                });
                expect(pipeline).toBeDefined();
            } finally {
                device.destroy();
            }
        },
        30_000
    );
});
