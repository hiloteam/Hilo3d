import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Geometry from '../../../src/geometry/Geometry';
import LightManager from '../../../src/light/LightManager';
import Material from '../../../src/material/BasicMaterial';
import type RendererCore from '../../../src/render/RendererCore';
import type { RHIUploadBatch } from '../../../src/render/frame/RHIUploadBatch';
import {
    createRenderGraphFrameContext,
    type RenderGraphFrameContext
} from '../../../src/render/frame/RenderGraphFrameContext';
import { ForwardRenderer } from '../../../src/render/renderer/ForwardRenderer';
import { MeshDrawProcessor } from '../../../src/render/renderer/MeshDrawProcessor';
import {
    PreparedDrawCache,
    type PreparedDraw,
    type PreparedDrawRevision
} from '../../../src/render/renderer/PreparedDraw';
import {
    RHITextureUsage,
    type RHISubmission,
    type RHIGraphicsPipeline,
    type RHITextureFormat
} from '../../../src/render/rhi/core';
import { describe, expect, it, vi } from 'vitest';
import {
    FakeWebGLRHIBackend,
    FakeWebGPURHIBackend,
    type FakeRHIBackend,
    type FakeRHIDevice
} from '../rhi/portable/FakeRHIBackend';

function frameContext(device: FakeRHIDevice, frameIndex = 0, renderer = {} as RendererCore) {
    return createRenderGraphFrameContext({
        renderer,
        rhi: device,
        frameIndex,
        camera: new PerspectiveCamera(),
        lightManager: new LightManager(),
        fog: null,
        viewport: { x: 0, y: 0, width: 8, height: 8, minDepth: 0, maxDepth: 1 }
    });
}

function pipeline(
    device: FakeRHIDevice,
    format: RHITextureFormat,
    sampleCount: number,
    depthStencilFormat?: RHITextureFormat
): RHIGraphicsPipeline {
    const webGL = device.backend === 'webgl2';
    const vertex = device.createShader({
        artifact: {
            backend: device.backend,
            stage: 'vertex',
            code: webGL
                ? '#version 300 es\nvoid main() { gl_Position = vec4(0.0); }'
                : '@vertex fn main() -> @builtin(position) vec4f { return vec4f(); }',
            entryPoint: 'main',
            reflection: { bindings: [], vertexInputs: [] },
            cacheKey: 701
        }
    });
    const fragment = device.createShader({
        artifact: {
            backend: device.backend,
            stage: 'fragment',
            code: webGL
                ? '#version 300 es\nout vec4 color; void main() { color = vec4(1.0); }'
                : '@fragment fn main() -> @location(0) vec4f { return vec4f(1.0); }',
            entryPoint: 'main',
            reflection: { bindings: [], fragmentOutputs: [{ location: 0 }] },
            cacheKey: 702
        }
    });
    return device.createGraphicsPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [] }),
        vertex: { shader: vertex, buffers: [] },
        fragment: { shader: fragment, targets: [{ format }] },
        primitive: {},
        ...(depthStencilFormat === undefined
            ? {}
            : {
                  depthStencil: {
                      format: depthStencilFormat,
                      depthWriteEnabled: true,
                      depthCompare: 'less' as const
                  }
              }),
        multisample: { count: sampleCount }
    });
}

function preparedDraw(
    device: FakeRHIDevice,
    format: RHITextureFormat,
    sampleCount = 1,
    depthStencilFormat?: RHITextureFormat,
    vertexCount = 3
): PreparedDraw {
    const revision: PreparedDrawRevision = {
        geometry: 1,
        materialVariant: 1,
        renderState: 1,
        resourceBindings: 1,
        target: sampleCount,
        deviceGeneration: device.generation
    };
    return new PreparedDrawCache<object>(1, 1).prepare({}, revision, draw => {
        draw.setPipeline(pipeline(device, format, sampleCount, depthStencilFormat));
        draw.setDraw(vertexCount);
    });
}

function configuredSurface(device: FakeRHIDevice) {
    const surface = device.createSurface({ width: 0, height: 0 } as HTMLCanvasElement);
    surface.configure({
        width: 8,
        height: 8,
        format: 'rgba8unorm',
        usage: RHITextureUsage.RENDER_ATTACHMENT
    });
    return surface;
}

function meshProcessorStub(methods: object): MeshDrawProcessor {
    return Object.assign(
        {
            sampledGraphDependencies: [],
            beginPass: vi.fn()
        },
        methods
    ) as unknown as MeshDrawProcessor;
}

async function complete(backend: FakeRHIBackend): Promise<void> {
    if (backend.executionMode === 'deferred') {
        await backend.completeNextSubmission().done;
    }
}

function classifiedMesh(
    id: string,
    renderOrder: number,
    transparent = false,
    useInstanced = false
): Mesh {
    const value = new Mesh({
        geometry: new Geometry(),
        material: new Material({
            compositing: transparent
                ? { mode: 'alpha-blend', premultiplied: true }
                : { mode: 'opaque' }
        }),
        renderOrder,
        useInstanced
    });
    value.id = id;
    return value;
}

describe.each([
    ['WebGL immediate', () => new FakeWebGLRHIBackend()],
    ['WebGPU deferred', () => new FakeWebGPURHIBackend()]
] as const)('ForwardRenderer on %s', (_name, createBackend) => {
    it('runs the same single-camera main pass and explicit present path', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const surface = configuredSurface(device);
        const getCurrentTexture = vi.spyOn(surface, 'getCurrentTexture');
        const renderer = new ForwardRenderer(1);
        const result = renderer.render(frameContext(device, 9), surface, {
            draws: [preparedDraw(device, 'rgba8unorm')],
            clearColor: { r: 0.1, g: 0.2, b: 0.3, a: 1 }
        });

        await complete(backend);
        await result.submission.done;
        expect(getCurrentTexture).toHaveBeenCalledTimes(1);
        expect(surface.state).toBe('configured');
        expect(result.diagnostics.drawCount).toBe(1);
        expect(backend.executionLog).toContain('draw:3');
        expect(backend.executionLog.at(-1)).toBe(`present:${String(surface.id)}`);
        expect(renderer.active).toBe(false);
        renderer.destroy();
        backend.destroy();
    });

    it('builds matching transient MSAA and depth attachments above both backends', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const surface = configuredSurface(device);
        const renderer = new ForwardRenderer(1);
        const createTexture = vi.spyOn(device, 'createTexture');
        const result = renderer.render(frameContext(device), surface, {
            draws: [preparedDraw(device, 'rgba8unorm', 4, 'depth24plus')],
            sampleCount: 4,
            depthStencilFormat: 'depth24plus'
        });

        await complete(backend);
        await result.submission.done;
        expect(
            createTexture.mock.calls.some(
                ([descriptor]) => descriptor.sampleCount === 4 && descriptor.format === 'rgba8unorm'
            )
        ).toBe(true);
        expect(
            createTexture.mock.calls.some(
                ([descriptor]) =>
                    descriptor.sampleCount === 4 && descriptor.format === 'depth24plus'
            )
        ).toBe(true);
        expect(result.diagnostics.transientAllocations).toBe(2);
        expect(surface.state).toBe('configured');
        renderer.destroy();
        backend.destroy();
    });

    it('executes opaque then transparent draws through shared pass templates', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const surface = configuredSurface(device);
        const renderer = new ForwardRenderer(2);
        const result = renderer.render(frameContext(device), surface, {
            opaqueDraws: [preparedDraw(device, 'rgba8unorm', 1, 'depth24plus')],
            transparentDraws: [preparedDraw(device, 'rgba8unorm', 1, 'depth24plus')],
            depthStencilFormat: 'depth24plus'
        });

        await complete(backend);
        await result.submission.done;
        expect(result.diagnostics.drawCount).toBe(2);
        expect(
            backend.executionLog.filter(command =>
                command.startsWith('render-pass:Forward main pass')
            )
        ).toHaveLength(2);
        expect(backend.executionLog.filter(command => command === 'draw:3')).toHaveLength(2);
        expect(backend.executionLog.at(-1)).toBe(`present:${String(surface.id)}`);
        renderer.destroy();
        backend.destroy();
    });

    it('prepares opaque and transparent Mesh inputs inside the RenderGraphFrame transaction', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const surface = configuredSurface(device);
        const context = frameContext(device, 13);
        const renderer = new ForwardRenderer(2);
        const opaqueMesh = {} as Mesh;
        const transparentMesh = {} as Mesh;
        const opaqueDraw = preparedDraw(device, 'rgba8unorm', 4, 'depth24plus');
        const transparentDraw = preparedDraw(device, 'rgba8unorm', 4, 'depth24plus', 6);
        const calls: string[] = [];
        const beginFrame = vi.fn(
            (receivedContext: RenderGraphFrameContext, uploads: RHIUploadBatch) => {
                expect(renderer.frame.active).toBe(true);
                expect(receivedContext).toBe(context);
                expect(uploads).toBe(renderer.frame.uploads);
                calls.push('begin');
            }
        );
        const prepare = vi.fn((mesh: Mesh) => {
            expect(renderer.frame.active).toBe(true);
            calls.push(mesh === opaqueMesh ? 'opaque' : 'transparent');
            return mesh === opaqueMesh ? opaqueDraw : transparentDraw;
        });
        const trackSubmission = vi.fn(
            (_frameIndex: number, submission: RHISubmission) => submission.done
        );
        const meshProcessor = meshProcessorStub({
            beginFrame,
            prepare,
            trackSubmission
        });

        const result = renderer.render(context, surface, {
            meshProcessor,
            meshes: [opaqueMesh],
            transparentMeshes: [transparentMesh],
            sampleCount: 4,
            depthStencilFormat: 'depth24plus'
        });

        await complete(backend);
        await result.submission.done;
        expect(calls).toEqual(['begin', 'opaque', 'transparent']);
        expect(beginFrame).toHaveBeenCalledTimes(1);
        expect(trackSubmission).toHaveBeenCalledWith(13, result.submission);
        expect(prepare).toHaveBeenNthCalledWith(
            1,
            opaqueMesh,
            expect.objectContaining({
                colorFormats: ['rgba8unorm'],
                depthStencilFormat: 'depth24plus',
                sampleCount: 4
            })
        );
        expect(prepare).toHaveBeenNthCalledWith(
            2,
            transparentMesh,
            expect.objectContaining({
                colorFormats: ['rgba8unorm'],
                depthStencilFormat: 'depth24plus',
                sampleCount: 4
            })
        );
        expect(
            backend.executionLog.filter(command =>
                command.startsWith('render-pass:Forward main pass')
            )
        ).toHaveLength(2);
        const mainPassIndex = backend.executionLog.findIndex(command =>
            command.startsWith('render-pass:Forward main pass')
        );
        const transparentPassIndex = backend.executionLog.findIndex(
            (command, index) =>
                index > mainPassIndex &&
                command.startsWith('render-pass:Forward main pass transparent')
        );
        expect(backend.executionLog.indexOf('draw:3')).toBeGreaterThan(mainPassIndex);
        expect(backend.executionLog.indexOf('draw:3')).toBeLessThan(transparentPassIndex);
        expect(backend.executionLog.indexOf('draw:6')).toBeGreaterThan(transparentPassIndex);
        expect(result.diagnostics.drawCount).toBe(2);
        expect(backend.executionLog.at(-1)).toBe(`present:${String(surface.id)}`);
        renderer.destroy();
        backend.destroy();
    });

    it('automatically classifies and sorts one Mesh list before preparing shared passes', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const surface = configuredSurface(device);
        const context = frameContext(device, 17);
        const renderer = new ForwardRenderer(3);
        const opaqueLate = classifiedMesh('opaque-late', 2);
        const transparent = classifiedMesh('transparent', 0, true);
        const opaqueEarly = classifiedMesh('opaque-early', -2);
        const draws = new Map<Mesh, PreparedDraw>([
            [opaqueEarly, preparedDraw(device, 'rgba8unorm', 1, undefined, 3)],
            [opaqueLate, preparedDraw(device, 'rgba8unorm', 1, undefined, 4)],
            [transparent, preparedDraw(device, 'rgba8unorm', 1, undefined, 6)]
        ]);
        const calls: Mesh[] = [];
        const beginFrame = vi.fn();
        const prepare = vi.fn((value: Mesh) => {
            calls.push(value);
            const draw = draws.get(value);
            if (draw === undefined) throw new Error('Missing classified Mesh draw');
            return draw;
        });
        const trackSubmission = vi.fn(
            (_frameIndex: number, submission: RHISubmission) => submission.done
        );
        const meshProcessor = meshProcessorStub({
            beginFrame,
            prepare,
            trackSubmission
        });

        const result = renderer.render(context, surface, {
            meshProcessor,
            classifiedMeshes: [opaqueLate, transparent, opaqueEarly]
        });

        await complete(backend);
        await result.submission.done;
        expect(calls).toEqual([opaqueEarly, opaqueLate, transparent]);
        expect(beginFrame).toHaveBeenCalledTimes(1);
        expect(trackSubmission).toHaveBeenCalledWith(17, result.submission);
        expect(result.diagnostics.drawCount).toBe(3);
        expect(
            backend.executionLog.filter(command =>
                command.startsWith('render-pass:Forward main pass')
            )
        ).toHaveLength(2);
        const transparentPassIndex = backend.executionLog.findIndex(command =>
            command.startsWith('render-pass:Forward main pass transparent')
        );
        expect(backend.executionLog.indexOf('draw:3')).toBeLessThan(transparentPassIndex);
        expect(backend.executionLog.indexOf('draw:4')).toBeLessThan(transparentPassIndex);
        expect(backend.executionLog.indexOf('draw:6')).toBeGreaterThan(transparentPassIndex);
        expect(backend.executionLog.at(-1)).toBe(`present:${String(surface.id)}`);

        transparent.material = new Material();
        calls.length = 0;
        const previousLogLength = backend.executionLog.length;
        const second = renderer.render(frameContext(device, 18), surface, {
            meshProcessor,
            classifiedMeshes: [opaqueLate, transparent, opaqueEarly]
        });
        await complete(backend);
        await second.submission.done;
        expect(calls).toEqual([opaqueEarly, transparent, opaqueLate]);
        expect(
            backend.executionLog
                .slice(previousLogLength)
                .filter(command => command.startsWith('render-pass:Forward main pass'))
        ).toHaveLength(1);
        expect(renderer.detachMesh(transparent)).toBe(true);
        renderer.destroy();
        backend.destroy();
    });

    it('routes stable planner batches of at most 128 instances through one frame transaction', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const surface = configuredSurface(device);
        const renderer = new ForwardRenderer(2);
        const sharedGeometry = new Geometry();
        const sharedMaterial = new Material();
        const meshes = Array.from({ length: 129 }, (_value, index) => {
            const mesh = new Mesh({
                geometry: sharedGeometry,
                material: sharedMaterial,
                useInstanced: true
            });
            mesh.id = `instanced-${String(index)}`;
            return mesh;
        });
        const draw = preparedDraw(device, 'rgba8unorm');
        const beginFrame = vi.fn();
        const prepare = vi.fn();
        const prepareInstancedBatch = vi.fn((_owner: object, _meshes: readonly Mesh[]) => draw);
        const trackSubmission = vi.fn(
            (_frameIndex: number, submission: RHISubmission) => submission.done
        );
        const meshProcessor = meshProcessorStub({
            beginFrame,
            prepare,
            prepareInstancedBatch,
            trackSubmission
        });

        const first = renderer.render(frameContext(device, 1), surface, {
            meshProcessor,
            classifiedMeshes: meshes
        });
        await complete(backend);
        await first.submission.done;

        expect(beginFrame).toHaveBeenCalledTimes(1);
        expect(prepare).not.toHaveBeenCalled();
        expect(prepareInstancedBatch).toHaveBeenCalledTimes(2);
        expect(prepareInstancedBatch.mock.calls.map(call => call[1].length)).toEqual([128, 1]);
        expect(first.diagnostics.drawCount).toBe(2);
        const firstOwners = prepareInstancedBatch.mock.calls.map(call => call[0]);
        const firstMeshArrays = prepareInstancedBatch.mock.calls.map(call => call[1]);

        prepareInstancedBatch.mockClear();
        const second = renderer.render(frameContext(device, 2), surface, {
            meshProcessor,
            classifiedMeshes: meshes
        });
        await complete(backend);
        await second.submission.done;
        for (let index = 0; index < firstOwners.length; index += 1) {
            expect(prepareInstancedBatch.mock.calls[index]?.[0]).toBe(firstOwners[index]);
            expect(prepareInstancedBatch.mock.calls[index]?.[1]).toBe(firstMeshArrays[index]);
        }
        expect(trackSubmission).toHaveBeenLastCalledWith(2, second.submission);
        const firstMesh = meshes[0];
        if (firstMesh === undefined) throw new Error('Instanced test fixture is empty');
        expect(renderer.detachMesh(firstMesh)).toBe(true);
        renderer.destroy();
        backend.destroy();
    });

    it('routes transparent instanced batches through the transparent pass', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const surface = configuredSurface(device);
        const renderer = new ForwardRenderer(1);
        const instanced = classifiedMesh('transparent-instanced', 0, true, true);
        const draw = preparedDraw(device, 'rgba8unorm', 1, undefined, 6);
        const prepareInstancedBatch = vi.fn((_owner: object, _meshes: readonly Mesh[]) => draw);
        const meshProcessor = meshProcessorStub({
            beginFrame: vi.fn(),
            prepare: vi.fn(),
            prepareInstancedBatch,
            trackSubmission: vi.fn(
                (_frameIndex: number, submission: RHISubmission) => submission.done
            )
        });

        const result = renderer.render(frameContext(device, 3), surface, {
            meshProcessor,
            classifiedMeshes: [instanced]
        });
        await complete(backend);
        await result.submission.done;

        expect(prepareInstancedBatch).toHaveBeenCalledOnce();
        const transparentPassIndex = backend.executionLog.findIndex(command =>
            command.startsWith('render-pass:Forward main pass transparent')
        );
        expect(transparentPassIndex).toBeGreaterThan(-1);
        expect(backend.executionLog.indexOf('draw:6')).toBeGreaterThan(transparentPassIndex);
        expect(result.diagnostics.drawCount).toBe(1);
        renderer.destroy();
        backend.destroy();
    });

    it('executes direct and instanced transparent items in one global renderOrder sequence', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const surface = configuredSurface(device);
        const renderer = new ForwardRenderer(1);
        const sharedGeometry = new Geometry();
        const sharedMaterial = new Material({
            compositing: { mode: 'alpha-blend', premultiplied: true }
        });
        const earlyA = new Mesh({
            geometry: sharedGeometry,
            material: sharedMaterial,
            renderOrder: 0,
            useInstanced: true
        });
        const earlyB = new Mesh({
            geometry: sharedGeometry,
            material: sharedMaterial,
            renderOrder: 0,
            useInstanced: true
        });
        const direct = classifiedMesh('direct-middle', 1, true);
        const late = new Mesh({
            geometry: sharedGeometry,
            material: sharedMaterial,
            renderOrder: 2,
            useInstanced: true
        });
        const earlyDraw = preparedDraw(device, 'rgba8unorm', 1, undefined, 3);
        const directDraw = preparedDraw(device, 'rgba8unorm', 1, undefined, 6);
        const lateDraw = preparedDraw(device, 'rgba8unorm', 1, undefined, 9);
        const meshProcessor = meshProcessorStub({
            beginFrame: vi.fn(),
            prepare: vi.fn(() => directDraw),
            prepareInstancedBatch: vi.fn((_owner: object, meshes: readonly Mesh[]) =>
                meshes[0]?.renderOrder === 0 ? earlyDraw : lateDraw
            ),
            trackSubmission: vi.fn(
                (_frameIndex: number, submission: RHISubmission) => submission.done
            )
        });

        const result = renderer.render(frameContext(device, 4), surface, {
            meshProcessor,
            classifiedMeshes: [late, direct, earlyB, earlyA]
        });
        await complete(backend);
        await result.submission.done;

        const earlyIndex = backend.executionLog.indexOf('draw:3');
        const directIndex = backend.executionLog.indexOf('draw:6');
        const lateIndex = backend.executionLog.indexOf('draw:9');
        expect(earlyIndex).toBeGreaterThan(-1);
        expect(earlyIndex).toBeLessThan(directIndex);
        expect(directIndex).toBeLessThan(lateIndex);
        renderer.destroy();
        backend.destroy();
    });

    it('rolls back instanced preparation failures before surface acquire or RHI beginFrame', () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const surface = configuredSurface(device);
        const getCurrentTexture = vi.spyOn(surface, 'getCurrentTexture');
        const queueBeginFrame = vi.spyOn(device.graphicsQueue, 'beginFrame');
        const renderer = new ForwardRenderer();
        const instanced = classifiedMesh('instanced', 0, false, true);
        const rollback = vi.fn();
        const meshProcessor = meshProcessorStub({
            beginFrame: vi.fn((_context: RenderGraphFrameContext, uploads: RHIUploadBatch) => {
                uploads.enlist({ prepareCommit: vi.fn(), commit: vi.fn(), rollback });
            }),
            prepare: vi.fn(),
            prepareInstancedBatch: vi.fn(() => {
                throw new Error('instance preparation failed');
            })
        });

        expect(() =>
            renderer.render(frameContext(device), surface, {
                meshProcessor,
                classifiedMeshes: [instanced]
            })
        ).toThrow('instance preparation failed');
        expect(rollback).toHaveBeenCalledTimes(1);
        expect(queueBeginFrame).not.toHaveBeenCalled();
        expect(getCurrentTexture).not.toHaveBeenCalled();
        expect(surface.state).toBe('configured');
        expect(renderer.active).toBe(false);
        renderer.destroy();
        backend.destroy();
    });

    it('rolls back Mesh preparation failures without acquiring or beginning an RHI frame', () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const surface = configuredSurface(device);
        const getCurrentTexture = vi.spyOn(surface, 'getCurrentTexture');
        const present = vi.spyOn(surface, 'present');
        const queueBeginFrame = vi.spyOn(device.graphicsQueue, 'beginFrame');
        const renderer = new ForwardRenderer(1);
        const rollback = vi.fn();
        const participant = {
            prepareCommit: vi.fn(),
            commit: vi.fn(),
            rollback
        };
        const meshProcessor = meshProcessorStub({
            beginFrame: vi.fn((_context: RenderGraphFrameContext, uploads: RHIUploadBatch) => {
                uploads.enlist(participant);
            }),
            prepare: vi.fn(() => {
                throw new Error('mesh preparation failed');
            })
        });

        expect(() =>
            renderer.render(frameContext(device), surface, {
                meshProcessor,
                meshes: [{} as Mesh]
            })
        ).toThrow('mesh preparation failed');
        expect(rollback).toHaveBeenCalledTimes(1);
        expect(queueBeginFrame).not.toHaveBeenCalled();
        expect(getCurrentTexture).not.toHaveBeenCalled();
        expect(present).not.toHaveBeenCalled();
        expect(surface.state).toBe('configured');
        expect(renderer.active).toBe(false);
        renderer.destroy();
        backend.destroy();
    });

    it('rejects a MeshDrawProcessor from another device before acquire or RHI beginFrame', () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const otherDevice = backend.createDevice();
        const surface = configuredSurface(device);
        const getCurrentTexture = vi.spyOn(surface, 'getCurrentTexture');
        const queueBeginFrame = vi.spyOn(device.graphicsQueue, 'beginFrame');
        const core = {
            width: 8,
            height: 8,
            forceMaterial: null,
            useLogDepth: false,
            vertexPrecision: 'highp',
            fragmentPrecision: 'highp',
            getViewport: () => [0, 0, 8, 8]
        } as unknown as RendererCore;
        const processor = new MeshDrawProcessor(core, otherDevice);
        const renderer = new ForwardRenderer(1);

        expect(() =>
            renderer.render(frameContext(device, 0, core), surface, {
                meshProcessor: processor,
                meshes: [{} as Mesh]
            })
        ).toThrow('another RHI device generation');
        expect(queueBeginFrame).not.toHaveBeenCalled();
        expect(getCurrentTexture).not.toHaveBeenCalled();
        expect(processor.active).toBe(false);
        expect(renderer.active).toBe(false);
        renderer.destroy();
        processor.destroy();
        backend.destroy();
    });
});

describe('ForwardRenderer failure boundaries', () => {
    it('rejects mixed PreparedDraw and Mesh entry points before starting a frame', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const surface = configuredSurface(device);
        const getCurrentTexture = vi.spyOn(surface, 'getCurrentTexture');
        const renderer = new ForwardRenderer();
        const meshProcessor = {} as MeshDrawProcessor;

        expect(() =>
            renderer.render(frameContext(device), surface, {
                draws: [],
                meshes: [],
                meshProcessor
            })
        ).toThrow('PreparedDraw and Mesh inputs are mutually exclusive');
        expect(() =>
            renderer.render(frameContext(device), surface, {
                meshes: [],
                opaqueMeshes: [],
                meshProcessor
            })
        ).toThrow('meshes and opaqueMeshes are mutually exclusive');
        expect(() =>
            renderer.render(frameContext(device), surface, {
                classifiedMeshes: [],
                transparentMeshes: [],
                meshProcessor
            })
        ).toThrow('classifiedMeshes and explicit Mesh queues are mutually exclusive');
        expect(() =>
            renderer.render(frameContext(device), surface, {
                draws: [],
                classifiedMeshes: [],
                meshProcessor
            })
        ).toThrow('PreparedDraw and Mesh inputs are mutually exclusive');
        expect(() => renderer.render(frameContext(device), surface, { meshes: [] })).toThrow(
            'require a MeshDrawProcessor'
        );
        expect(() =>
            renderer.render(frameContext(device), surface, { classifiedMeshes: [] })
        ).toThrow('require a MeshDrawProcessor');
        expect(getCurrentTexture).not.toHaveBeenCalled();
        expect(renderer.frame.active).toBe(false);
        expect(renderer.active).toBe(false);
        renderer.destroy();
        backend.destroy();
    });

    it('guards automatic draw-list detach, reset, active, and destroy lifecycle', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const surface = configuredSurface(device);
        const renderer = new ForwardRenderer(1);
        const value = classifiedMesh('lifecycle', 0);
        const draw = preparedDraw(device, 'rgba8unorm');
        const prepare = vi.fn((_mesh: Mesh) => {
            expect(() => renderer.detachMesh(value)).toThrow('active ForwardRenderer');
            expect(() => {
                renderer.resetMeshDrawList();
            }).toThrow('active ForwardRenderer');
            return draw;
        });
        const meshProcessor = meshProcessorStub({
            beginFrame: vi.fn(),
            prepare,
            trackSubmission: vi.fn()
        });

        renderer.render(frameContext(device), surface, {
            classifiedMeshes: [value],
            meshProcessor
        });
        expect(prepare).toHaveBeenCalledOnce();
        expect(renderer.detachMesh(value)).toBe(true);
        expect(renderer.detachMesh(value)).toBe(false);

        renderer.render(frameContext(device, 1), surface, {
            classifiedMeshes: [value],
            meshProcessor
        });
        renderer.resetMeshDrawList();
        expect(renderer.detachMesh(value)).toBe(false);

        renderer.destroy();
        expect(() => renderer.detachMesh(value)).toThrow('destroyed ForwardRenderer');
        expect(() => {
            renderer.resetMeshDrawList();
        }).toThrow('destroyed ForwardRenderer');
        backend.destroy();
    });

    it('does not acquire or present the surface when graph compilation fails', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const surface = configuredSurface(device);
        const getCurrentTexture = vi.spyOn(surface, 'getCurrentTexture');
        const present = vi.spyOn(surface, 'present');
        const renderer = new ForwardRenderer();

        expect(() =>
            renderer.render(frameContext(device), surface, {
                draws: [],
                sampleCount: 2
            })
        ).toThrow(expect.objectContaining({ code: 'unsupported-format' }));
        expect(getCurrentTexture).not.toHaveBeenCalled();
        expect(present).not.toHaveBeenCalled();
        expect(surface.state).toBe('configured');
        expect(device.graphicsQueue.state).toBe('idle');
        renderer.destroy();
        backend.destroy();
    });

    it('aborts command execution and releases an acquired surface texture', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const surface = configuredSurface(device);
        const renderer = new ForwardRenderer(1);
        backend.failNextExecute(new Error('native draw failed'));

        expect(() =>
            renderer.render(frameContext(device), surface, {
                draws: [preparedDraw(device, 'rgba8unorm')]
            })
        ).toThrow('native draw failed');
        expect(device.graphicsQueue.state).toBe('idle');
        expect(surface.state).toBe('configured');
        expect(renderer.active).toBe(false);
        renderer.destroy();
        backend.destroy();
    });

    it('rejects a surface owned by another device before acquisition', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const otherDevice = backend.createDevice();
        const surface = configuredSurface(otherDevice);
        const getCurrentTexture = vi.spyOn(surface, 'getCurrentTexture');
        const renderer = new ForwardRenderer();

        expect(() => renderer.render(frameContext(device), surface, { draws: [] })).toThrow(
            expect.objectContaining({ code: 'wrong-device' })
        );
        expect(getCurrentTexture).not.toHaveBeenCalled();
        renderer.destroy();
        backend.destroy();
    });
});
