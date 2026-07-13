import { describe, expect, it, vi } from 'vitest';
import Material from '../../../src/material/Material';
import { LINES, LINE_STRIP, TRIANGLES } from '../../../src/constants/webgl';
import { WebGPUPipelineManager } from '../../../src/renderer/webgpu/WebGPUPipelineManager';
import { createWebGPURenderState } from '../../../src/renderer/webgpu/WebGPURenderState';

interface PipelineWithDescriptor extends GPURenderPipeline {
    readonly descriptor: GPURenderPipelineDescriptor;
}

function pipelineObject(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline {
    return { descriptor } as PipelineWithDescriptor;
}

function resolvedPipeline(descriptor: GPURenderPipelineDescriptor): Promise<GPURenderPipeline> {
    return Promise.resolve(pipelineObject(descriptor));
}

function deferred<T>(): {
    readonly promise: Promise<T>;
    readonly resolve: (value: T) => void;
    readonly reject: (reason: unknown) => void;
} {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function pipelineRequest(
    overrides: {
        readonly label?: string;
        readonly layout?: GPUPipelineLayout;
        readonly vertexModule?: GPUShaderModule;
        readonly fragmentModule?: GPUShaderModule;
        readonly material?: Material;
        readonly mode?: GLenum;
        readonly attributesReversed?: boolean;
        readonly constantsReversed?: boolean;
    } = {}
) {
    const attributes: GPUVertexAttribute[] = [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x2' }
    ];
    if (overrides.attributesReversed) attributes.reverse();
    const constants = overrides.constantsReversed
        ? { A_VALUE: 1, Z_VALUE: 2 }
        : { Z_VALUE: 2, A_VALUE: 1 };
    return {
        ...(overrides.label === undefined ? {} : { label: overrides.label }),
        layout: overrides.layout ?? ({} as GPUPipelineLayout),
        vertex: {
            module: overrides.vertexModule ?? ({} as GPUShaderModule),
            entryPoint: 'main',
            constants,
            buffers: [{ arrayStride: 20, attributes }]
        },
        fragment: {
            module: overrides.fragmentModule ?? ({} as GPUShaderModule),
            entryPoint: 'main',
            constants: { EXPOSURE: 1 }
        },
        renderState: createWebGPURenderState(
            overrides.material ?? new Material(),
            overrides.mode ?? TRIANGLES,
            {
                colorFormats: ['bgra8unorm'],
                depthStencilFormat: 'depth24plus'
            }
        )
    };
}

describe('WebGPUPipelineManager', () => {
    it('shares one async compilation for structurally equivalent immutable descriptors', async () => {
        const createRenderPipelineAsync = vi.fn(resolvedPipeline);
        const manager = new WebGPUPipelineManager({
            createRenderPipelineAsync
        } as unknown as GPUDevice);
        const layout = {} as GPUPipelineLayout;
        const vertexModule = {} as GPUShaderModule;
        const fragmentModule = {} as GPUShaderModule;
        const firstRequest = pipelineRequest({
            layout,
            vertexModule,
            fragmentModule,
            label: 'first'
        });
        const secondRequest = pipelineRequest({
            layout,
            vertexModule,
            fragmentModule,
            label: 'diagnostic label does not alter behavior',
            attributesReversed: true,
            constantsReversed: true
        });

        const first = manager.getPipeline(firstRequest);
        const second = manager.getPipeline(secondRequest);

        expect(first).toBe(second);
        expect(manager.getCacheKey(firstRequest)).toBe(manager.getCacheKey(secondRequest));
        expect(manager.size).toBe(1);
        expect(createRenderPipelineAsync).toHaveBeenCalledTimes(1);

        const pipeline = (await first) as PipelineWithDescriptor;
        expect(pipeline.descriptor.label).toBe('first');
        expect(pipeline.descriptor.vertex.constants).toEqual({ A_VALUE: 1, Z_VALUE: 2 });
        expect(pipeline.descriptor.vertex.buffers?.[0]?.attributes).toEqual([
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x2' }
        ]);
        expect(pipeline.descriptor.fragment?.targets).toEqual([
            { format: 'bgra8unorm', writeMask: 0xf }
        ]);
    });

    it('separates every immutable shader, layout, vertex, topology, and material-state change', () => {
        const createRenderPipelineAsync = vi.fn(resolvedPipeline);
        const manager = new WebGPUPipelineManager({
            createRenderPipelineAsync
        } as unknown as GPUDevice);
        const layout = {} as GPUPipelineLayout;
        const vertexModule = {} as GPUShaderModule;
        const fragmentModule = {} as GPUShaderModule;
        const base = pipelineRequest({ layout, vertexModule, fragmentModule });
        const keys = new Set([
            manager.getCacheKey(base),
            manager.getCacheKey(
                pipelineRequest({
                    layout: {} as GPUPipelineLayout,
                    vertexModule,
                    fragmentModule
                })
            ),
            manager.getCacheKey(
                pipelineRequest({
                    layout,
                    vertexModule: {} as GPUShaderModule,
                    fragmentModule
                })
            ),
            manager.getCacheKey(
                pipelineRequest({
                    layout,
                    vertexModule,
                    fragmentModule: {} as GPUShaderModule
                })
            ),
            manager.getCacheKey(
                pipelineRequest({ layout, vertexModule, fragmentModule, mode: LINES })
            ),
            manager.getCacheKey(
                pipelineRequest({
                    layout,
                    vertexModule,
                    fragmentModule,
                    material: new Material({ blend: true })
                })
            )
        ]);

        expect(keys.size).toBe(6);
    });

    it('does not split pipelines for dynamic depth ranges and stencil references', () => {
        const createRenderPipelineAsync = vi.fn(resolvedPipeline);
        const manager = new WebGPUPipelineManager({
            createRenderPipelineAsync
        } as unknown as GPUDevice);
        const layout = {} as GPUPipelineLayout;
        const vertexModule = {} as GPUShaderModule;
        const fragmentModule = {} as GPUShaderModule;
        const first = pipelineRequest({ layout, vertexModule, fragmentModule });
        const second = pipelineRequest({
            layout,
            vertexModule,
            fragmentModule,
            material: new Material({ depthRange: [0.2, 0.7], stencilFuncRef: 22 })
        });

        expect(manager.getCacheKey(first)).toBe(manager.getCacheKey(second));
    });

    it('derives its key from descriptor state instead of trusting a caller-provided key', () => {
        const manager = new WebGPUPipelineManager({
            createRenderPipelineAsync: vi.fn(resolvedPipeline)
        } as unknown as GPUDevice);
        const first = pipelineRequest();
        const forged = {
            ...first,
            renderState: {
                ...first.renderState,
                primitive: { ...first.renderState.primitive, topology: 'line-list' as const },
                cacheKey: first.renderState.cacheKey
            }
        };

        expect(manager.getCacheKey(first)).not.toBe(manager.getCacheKey(forged));
    });

    it('evicts rejected asynchronous compilations and supports an explicit clear', async () => {
        const failure = new Error('shader validation failed');
        const createRenderPipelineAsync = vi
            .fn<(descriptor: GPURenderPipelineDescriptor) => Promise<GPURenderPipeline>>()
            .mockRejectedValueOnce(failure)
            .mockImplementation(resolvedPipeline);
        const manager = new WebGPUPipelineManager({
            createRenderPipelineAsync
        } as unknown as GPUDevice);
        const request = pipelineRequest();

        await expect(manager.getPipeline(request)).rejects.toBe(failure);
        expect(manager.size).toBe(0);
        await expect(manager.getPipeline(request)).resolves.toBeDefined();
        expect(createRenderPipelineAsync).toHaveBeenCalledTimes(2);
        expect(manager.size).toBe(1);

        manager.clear();
        expect(manager.size).toBe(0);
    });

    it('deduplicates pending A/B/A compilations independently of settled LRU capacity', async () => {
        const a = deferred<GPURenderPipeline>();
        const b = deferred<GPURenderPipeline>();
        const pipelineA = {} as GPURenderPipeline;
        const pipelineB = {} as GPURenderPipeline;
        const createRenderPipelineAsync = vi
            .fn<(descriptor: GPURenderPipelineDescriptor) => Promise<GPURenderPipeline>>()
            .mockReturnValueOnce(a.promise)
            .mockReturnValueOnce(b.promise);
        const manager = new WebGPUPipelineManager(
            { createRenderPipelineAsync } as unknown as GPUDevice,
            1
        );
        const layout = {} as GPUPipelineLayout;
        const vertexModule = {} as GPUShaderModule;
        const fragmentModule = {} as GPUShaderModule;
        const requestA = pipelineRequest({ layout, vertexModule, fragmentModule });
        const requestB = pipelineRequest({
            layout,
            vertexModule,
            fragmentModule,
            mode: LINES
        });

        const pendingA = manager.getPipeline(requestA);
        const pendingB = manager.getPipeline(requestB);

        expect(manager.getPipeline(requestA)).toBe(pendingA);
        expect(createRenderPipelineAsync).toHaveBeenCalledTimes(2);
        expect(manager.size).toBe(2);

        b.resolve(pipelineB);
        await expect(pendingB).resolves.toBe(pipelineB);
        expect(manager.size).toBe(2);
        await expect(manager.getPipeline(requestB)).resolves.toBe(pipelineB);

        a.resolve(pipelineA);
        await expect(pendingA).resolves.toBe(pipelineA);
        expect(manager.size).toBe(1);
        await expect(manager.getPipeline(requestA)).resolves.toBe(pipelineA);
        expect(createRenderPipelineAsync).toHaveBeenCalledTimes(2);
    });

    it('rejects synchronous duplication while the same async pipeline is pending', async () => {
        const compilation = deferred<GPURenderPipeline>();
        const pipeline = {} as GPURenderPipeline;
        const createRenderPipelineAsync = vi.fn(() => compilation.promise);
        const createRenderPipeline = vi.fn(pipelineObject);
        const manager = new WebGPUPipelineManager({
            createRenderPipelineAsync,
            createRenderPipeline
        } as unknown as GPUDevice);
        const request = pipelineRequest();

        const pending = manager.getPipeline(request);
        expect(() => manager.getPipelineSync(request)).toThrow(/compiling asynchronously/u);
        expect(createRenderPipeline).not.toHaveBeenCalled();

        compilation.resolve(pipeline);
        await expect(pending).resolves.toBe(pipeline);
        expect(manager.getPipelineSync(request)).toBe(pipeline);
        expect(createRenderPipeline).not.toHaveBeenCalled();
    });

    it('bounds synchronous shader variants with least-recently-used eviction', () => {
        const createRenderPipeline = vi.fn(pipelineObject);
        const manager = new WebGPUPipelineManager(
            { createRenderPipeline } as unknown as GPUDevice,
            2
        );
        const layout = {} as GPUPipelineLayout;
        const vertexModule = {} as GPUShaderModule;
        const fragmentModule = {} as GPUShaderModule;
        const triangles = pipelineRequest({
            layout,
            vertexModule,
            fragmentModule,
            mode: TRIANGLES
        });
        const lines = pipelineRequest({ layout, vertexModule, fragmentModule, mode: LINES });
        const lineStrip = pipelineRequest({
            layout,
            vertexModule,
            fragmentModule,
            mode: LINE_STRIP
        });

        const trianglePipeline = manager.getPipelineSync(triangles);
        const linePipeline = manager.getPipelineSync(lines);
        expect(manager.getPipelineSync(triangles)).toBe(trianglePipeline);
        manager.getPipelineSync(lineStrip);

        expect(manager.size).toBe(2);
        expect(manager.getPipelineSync(triangles)).toBe(trianglePipeline);
        expect(manager.getPipelineSync(lines)).not.toBe(linePipeline);
        expect(createRenderPipeline).toHaveBeenCalledTimes(4);
        expect(manager.size).toBe(2);
    });

    it('rejects an invalid cache capacity', () => {
        const device = { createRenderPipeline: vi.fn(pipelineObject) } as unknown as GPUDevice;
        expect(() => new WebGPUPipelineManager(device, 0)).toThrow(/positive integer/);
        expect(() => new WebGPUPipelineManager(device, 1.5)).toThrow(/positive integer/);
    });

    it('requires a fragment stage whenever color targets are present', () => {
        const createRenderPipelineAsync = vi.fn(resolvedPipeline);
        const manager = new WebGPUPipelineManager({
            createRenderPipelineAsync
        } as unknown as GPUDevice);
        const request = pipelineRequest();
        const invalid = {
            layout: request.layout,
            vertex: request.vertex,
            renderState: request.renderState
        };

        expect(() => manager.getPipeline(invalid)).toThrow(/fragment shader/);
        expect(createRenderPipelineAsync).not.toHaveBeenCalled();
    });

    it('snapshots descriptors so later caller mutation cannot alter an in-flight compilation', async () => {
        let captured: GPURenderPipelineDescriptor | undefined;
        const createRenderPipelineAsync = vi.fn((descriptor: GPURenderPipelineDescriptor) => {
            captured = descriptor;
            return Promise.resolve(pipelineObject(descriptor));
        });
        const manager = new WebGPUPipelineManager({
            createRenderPipelineAsync
        } as unknown as GPUDevice);
        const request = pipelineRequest();

        const pending = manager.getPipeline(request);
        const buffer = request.vertex.buffers[0];
        const attribute = buffer?.attributes[0];
        if (!attribute) throw new Error('Expected a test vertex attribute');
        attribute.offset = 999;
        request.vertex.constants.Z_VALUE = 99;
        await pending;

        const zValue = 'Z_VALUE';
        expect(captured?.vertex.buffers?.[0]?.attributes[0]?.offset).toBe(0);
        expect(captured?.vertex.constants?.[zValue]).toBe(2);
    });
});
