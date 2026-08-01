import { describe, expect, it, vi } from 'vitest';
import { RenderGraph } from '../../../src/render/graph/RenderGraph';
import type { RenderPassTemplate } from '../../../src/render/graph/RenderGraphBuilder';
import type {
    RGPassContext,
    RGPrepareContext
} from '../../../src/render/graph/RenderGraphExecutor';
import type {
    RGTextureAccessHandle,
    RGTextureHandle
} from '../../../src/render/graph/RenderGraphResource';
import type { RenderGraphError } from '../../../src/render/graph/RenderGraphValidation';
import { RHIBufferUsage, RHITextureUsage } from '../../../src/render/rhi/core';
import {
    FakeRHIBuffer,
    FakeWebGLRHIBackend,
    FakeWebGPURHIBackend,
    type FakeRHITextureView
} from '../rhi/portable/FakeRHIBackend';

interface AccessParams {
    readonly reads?: readonly RGTextureAccessHandle[];
    readonly writes?: readonly RGTextureAccessHandle[];
    readonly log: string[];
    readonly name: string;
    readonly sideEffect?: boolean;
}

const texturePass: RenderPassTemplate<AccessParams> = {
    name: 'texture access',
    setup(builder, params) {
        for (const handle of params.reads ?? []) builder.readTexture(handle);
        for (const handle of params.writes ?? []) builder.writeTexture(handle);
        if (params.sideEffect) builder.markSideEffect();
    },
    execute(_context, params) {
        params.log.push(params.name);
    }
};

describe('RenderGraph compile', () => {
    it('reuses build/compiler storage at historical high-water without reviving stale builders', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const createTexture = vi.spyOn(device, 'createTexture');
        const graph = new RenderGraph();
        const log: string[] = [];
        interface FrameParams {
            readonly color: RGTextureHandle;
            readonly value: string;
        }
        const passTemplate: RenderPassTemplate<FrameParams> = {
            name: 'high-water color pass',
            setup(pass, params) {
                pass.useColorAttachment({
                    texture: params.color,
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store'
                });
            },
            execute(_context, params) {
                log.push(params.value);
            }
        };
        const compileFrame = (value: string) => {
            const builder = graph.createBuilder();
            const color = builder.createTexture(`${value} color`, {
                size: { width: 2, height: 2 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.RENDER_ATTACHMENT
            });
            builder.addPass(passTemplate, { color, value });
            builder.markOutput(color);
            return { builder, compiled: graph.compile(builder, device.capabilities) };
        };

        const first = compileFrame('first');
        const diagnostics = graph.storageDiagnostics;
        const firstCapacity = { ...diagnostics };
        expect(firstCapacity).toMatchObject({
            builderStorageCapacity: 1,
            resourceNodeCapacity: 1,
            passNodeCapacity: 1,
            colorAttachmentCapacity: 1,
            compilerResourceCapacity: 1,
            compilerPassCapacity: 1,
            compilerReaderSetCapacity: 1
        });

        const second = compileFrame('second');
        expect(graph.storageDiagnostics).toBe(diagnostics);
        expect({ ...diagnostics }).toEqual(firstCapacity);
        expect(second.compiled).not.toBe(first.compiled);
        expect(second.compiled.passes[0]).not.toBe(first.compiled.passes[0]);
        expect(() =>
            first.builder.createTexture('stale', {
                size: { width: 1, height: 1 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.RENDER_ATTACHMENT
            })
        ).toThrow(expect.objectContaining<Partial<RenderGraphError>>({ code: 'invalid-state' }));

        graph.execute(first.compiled, device);
        graph.execute(second.compiled, device);
        expect(log).toEqual(['first', 'second']);
        expect(createTexture).toHaveBeenCalledTimes(1);
        graph.destroy();
        backend.destroy();
    });

    it('grows builder stores only to simultaneous-build high-water and recycles failures', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const first = graph.createBuilder();
        const second = graph.createBuilder();
        first.addPass(
            {
                name: 'first concurrent pass',
                setup(pass) {
                    pass.markSideEffect();
                },
                execute(context) {
                    void context;
                }
            },
            undefined
        );
        second.addPass(
            {
                name: 'second concurrent pass',
                setup(pass) {
                    pass.markSideEffect();
                },
                execute(context) {
                    void context;
                }
            },
            undefined
        );
        graph.compile(first, device.capabilities);
        graph.compile(second, device.capabilities);
        expect(graph.storageDiagnostics.builderStorageCapacity).toBe(2);
        const growths = graph.storageDiagnostics.builderStorageGrowths;

        const failed = graph.createBuilder();
        const unreadable = failed.createTexture('unreadable', {
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        failed.addPass(texturePass, {
            reads: [unreadable],
            log: [],
            name: 'invalid read',
            sideEffect: true
        });
        expect(() => graph.compile(failed, device.capabilities)).toThrow(
            expect.objectContaining<Partial<RenderGraphError>>({ code: 'uninitialized-read' })
        );
        const growthsAfterFailure = graph.storageDiagnostics.builderStorageGrowths;
        const compilerGrowthsAfterFailure = graph.storageDiagnostics.compilerStorageGrowths;

        const replacement = graph.createBuilder();
        replacement.addPass(
            {
                name: 'replacement pass',
                setup(pass) {
                    pass.markSideEffect();
                },
                execute(context) {
                    void context;
                }
            },
            undefined
        );
        graph.compile(replacement, device.capabilities);
        expect(graph.storageDiagnostics.builderStorageCapacity).toBe(2);
        expect(growthsAfterFailure).toBeGreaterThanOrEqual(growths);
        expect(graph.storageDiagnostics.builderStorageGrowths).toBe(growthsAfterFailure);
        expect(graph.storageDiagnostics.compilerStorageGrowths).toBe(compilerGrowthsAfterFailure);
        expect(() => {
            failed.markOutput(unreadable);
        }).toThrow(expect.objectContaining<Partial<RenderGraphError>>({ code: 'invalid-state' }));
        graph.destroy();
        backend.destroy();
    });

    it('uses monotonic long-lived identities and rejects handles from another builder', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const descriptor = {
            size: { width: 1, height: 1 },
            format: 'rgba8unorm' as const,
            usage: RHITextureUsage.RENDER_ATTACHMENT
        };
        const firstBuilder = graph.createBuilder();
        const first = firstBuilder.createTexture('first builder texture', descriptor);
        const firstCompiled = graph.compile(firstBuilder, device.capabilities);
        const secondBuilder = graph.createBuilder();
        const second = secondBuilder.createTexture('second builder texture', descriptor);

        expect(Number(second) - Number(first)).toBe(1);
        expect(() => {
            secondBuilder.markOutput(first);
        }).toThrow(expect.objectContaining<Partial<RenderGraphError>>({ code: 'invalid-handle' }));
        const secondCompiled = graph.compile(secondBuilder, device.capabilities);
        expect(secondCompiled.generation).toBe(firstCompiled.generation + 1);
        graph.destroy();
        backend.destroy();
    });

    it('builds dependencies, culls unused passes, and keeps stable order without GPU work', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const createTexture = vi.spyOn(device, 'createTexture');
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const descriptor = {
            size: { width: 4, height: 4 },
            format: 'rgba8unorm' as const,
            usage: RHITextureUsage.RENDER_ATTACHMENT
        };
        const first = builder.createTexture('first', descriptor);
        const unused = builder.createTexture('unused', descriptor);
        const output = builder.createTexture('output', descriptor);
        const log: string[] = [];
        builder.addPass(texturePass, { writes: [first], log, name: 'first' });
        builder.addPass(texturePass, { writes: [unused], log, name: 'unused' });
        builder.addPass(texturePass, { reads: [first], writes: [output], log, name: 'output' });
        builder.markOutput(output);

        const compiled = graph.compile(builder, device.capabilities);

        expect(compiled.passes.map(pass => pass.params)).toEqual([
            { writes: [first], log, name: 'first' },
            { reads: [first], writes: [output], log, name: 'output' }
        ]);
        expect(compiled.resources.map(resource => resource.name)).toEqual(['first', 'output']);
        expect(compiled.resources.map(resource => resource.lifetime)).toEqual([
            { firstUse: 0, lastUse: 1 },
            { firstUse: 1, lastUse: 1 }
        ]);
        expect(createTexture).not.toHaveBeenCalled();
        expect(backend.executeCount).toBe(0);
        expect(device.graphicsQueue.state).toBe('idle');
        backend.destroy();
    });

    it('rejects uninitialized reads, same-pass feedback, and cycles', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();

        const uninitialized = graph.createBuilder();
        const texture = uninitialized.createTexture('uninitialized', {
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        uninitialized.addPass(texturePass, {
            reads: [texture],
            log: [],
            name: 'read',
            sideEffect: true
        });
        expect(() => graph.compile(uninitialized, device.capabilities)).toThrow(
            expect.objectContaining({ code: 'uninitialized-read' })
        );

        const feedback = graph.createBuilder();
        const imported = feedback.importTexture(
            'imported',
            device.createTexture({
                size: { width: 1, height: 1 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.TEXTURE_BINDING | RHITextureUsage.RENDER_ATTACHMENT
            })
        );
        expect(() =>
            feedback.addPass(texturePass, {
                reads: [imported],
                writes: [imported],
                log: [],
                name: 'feedback'
            })
        ).toThrow(expect.objectContaining({ code: 'duplicate-access' }));

        const cycle = graph.createBuilder();
        const firstPass = cycle.addPass(texturePass, {
            log: [],
            name: 'first',
            sideEffect: true
        });
        const secondPass = cycle.addPass(texturePass, {
            log: [],
            name: 'second',
            sideEffect: true
        });
        cycle.addDependency(firstPass, secondPass);
        cycle.addDependency(secondPass, firstPass);
        expect(() => graph.compile(cycle, device.capabilities)).toThrow(
            expect.objectContaining({ code: 'cycle' })
        );
        backend.destroy();
    });

    it('tracks non-overlapping mip views independently and keeps their parent alive', () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const pyramid = builder.createTexture('depth pyramid', {
            size: { width: 16, height: 16 },
            mipLevelCount: 3,
            format: 'r32float',
            usage: RHITextureUsage.TEXTURE_BINDING | RHITextureUsage.STORAGE_BINDING
        });
        const mip0 = builder.createTextureView('depth pyramid mip 0', pyramid, {
            baseMipLevel: 0,
            mipLevelCount: 1
        });
        const mip1 = builder.createTextureView('depth pyramid mip 1', pyramid, {
            baseMipLevel: 1,
            mipLevelCount: 1
        });
        const mip2 = builder.createTextureView('depth pyramid mip 2', pyramid, {
            baseMipLevel: 2,
            mipLevelCount: 1
        });
        const observedMipLevels: number[] = [];
        builder.addPass(texturePass, { writes: [mip0], log: [], name: 'seed mip 0' });
        builder.addPass(
            {
                name: 'reduce mip 1',
                setup(pass) {
                    pass.readTexture(mip0);
                    pass.writeTexture(mip1);
                },
                prepare(context) {
                    observedMipLevels.push(context.getTextureView(mip0).descriptor.baseMipLevel);
                    observedMipLevels.push(context.getTextureView(mip1).descriptor.baseMipLevel);
                    expect(context.getTexture(mip0)).toBe(context.getTexture(mip1));
                },
                execute() {
                    // Dependency and prepared-view contracts are under test.
                }
            },
            undefined
        );
        builder.addPass(texturePass, {
            reads: [mip1],
            writes: [mip2],
            log: [],
            name: 'reduce mip 2'
        });
        builder.markOutput(mip2);

        const compiled = graph.compile(builder, device.capabilities);
        expect(compiled.passes).toHaveLength(3);
        expect(compiled.resources.map(resource => resource.name)).toEqual([
            'depth pyramid',
            'depth pyramid mip 0',
            'depth pyramid mip 1',
            'depth pyramid mip 2'
        ]);
        expect(compiled.resourceByHandle.get(pyramid)?.lifetime).toEqual({
            firstUse: 0,
            lastUse: 2
        });

        graph.execute(compiled, device);
        expect(observedMipLevels).toEqual([0, 1]);
        graph.destroy();
        backend.destroy();
    });

    it('allows disjoint same-pass views and rejects overlapping view feedback', () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const importedTexture = device.createTexture({
            size: { width: 8, height: 8 },
            mipLevelCount: 2,
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING | RHITextureUsage.STORAGE_BINDING
        });

        const disjoint = graph.createBuilder();
        const disjointTexture = disjoint.importTexture('disjoint texture', importedTexture);
        const readMip0 = disjoint.createTextureView('read mip 0', disjointTexture, {
            baseMipLevel: 0,
            mipLevelCount: 1
        });
        const writeMip1 = disjoint.createTextureView('write mip 1', disjointTexture, {
            baseMipLevel: 1,
            mipLevelCount: 1
        });
        disjoint.addPass(texturePass, {
            reads: [readMip0],
            writes: [writeMip1],
            log: [],
            name: 'disjoint feedback',
            sideEffect: true
        });
        expect(() => graph.compile(disjoint, device.capabilities)).not.toThrow();

        const overlapping = graph.createBuilder();
        const overlappingTexture = overlapping.importTexture(
            'overlapping texture',
            importedTexture
        );
        const firstMip0 = overlapping.createTextureView('first mip 0', overlappingTexture, {
            baseMipLevel: 0,
            mipLevelCount: 1
        });
        const secondMip0 = overlapping.createTextureView('second mip 0', overlappingTexture, {
            baseMipLevel: 0,
            mipLevelCount: 1
        });
        overlapping.addPass(texturePass, {
            reads: [firstMip0],
            writes: [secondMip0],
            log: [],
            name: 'overlapping feedback',
            sideEffect: true
        });
        expect(() => graph.compile(overlapping, device.capabilities)).toThrow(
            expect.objectContaining<Partial<RenderGraphError>>({ code: 'duplicate-access' })
        );

        graph.destroy();
        importedTexture.destroy();
        backend.destroy();
    });

    it('preserves explicit imported-texture initialization across subresource views', () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const texture = device.createTexture({
            size: { width: 4, height: 4 },
            mipLevelCount: 2,
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        const builder = graph.createBuilder();
        const imported = builder.importTexture('uninitialized history', texture, false);
        const mip = builder.createTextureView('uninitialized history mip', imported, {
            baseMipLevel: 1,
            mipLevelCount: 1
        });
        builder.addPass(texturePass, {
            reads: [mip],
            log: [],
            name: 'invalid history read',
            sideEffect: true
        });

        expect(() => graph.compile(builder, device.capabilities)).toThrow(
            expect.objectContaining<Partial<RenderGraphError>>({ code: 'uninitialized-read' })
        );
        graph.destroy();
        texture.destroy();
        backend.destroy();
    });

    it('rejects unsupported transient descriptors before beginFrame', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const buffer = builder.createBuffer('storage', {
            size: 16,
            usage: RHIBufferUsage.STORAGE
        });
        const template: RenderPassTemplate<typeof buffer> = {
            name: 'storage write',
            setup(pass, handle) {
                pass.writeBuffer(handle, 'storage');
                pass.markSideEffect();
            },
            execute(context) {
                void context;
            }
        };
        builder.addPass(template, buffer);

        expect(() => graph.compile(builder, device.capabilities)).toThrow(
            expect.objectContaining({ code: 'unsupported-feature' })
        );
        expect(device.graphicsQueue.state).toBe('idle');
        expect(backend.executeCount).toBe(0);
        backend.destroy();
    });

    it('infers transient buffer usages from purpose-aware access declarations', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const buffer = builder.createBuffer('generated vertices', {
            size: 16,
            usage: RHIBufferUsage.COPY_DST
        });
        builder.addPass(
            {
                name: 'upload vertices',
                setup(pass) {
                    pass.writeBuffer(buffer, 'copy-destination');
                },
                execute(context) {
                    void context;
                }
            },
            undefined
        );
        builder.addPass(
            {
                name: 'draw vertices',
                setup(pass) {
                    pass.readBuffer(buffer, 'vertex');
                    pass.markSideEffect();
                },
                execute(context) {
                    void context;
                }
            },
            undefined
        );

        const compiled = graph.compile(builder, device.capabilities);

        expect(compiled.resourceByHandle.get(buffer)?.descriptor.usage).toBe(
            RHIBufferUsage.COPY_DST | RHIBufferUsage.VERTEX
        );
        expect(compiled.passes.map(pass => pass.bufferAccesses)).toEqual([
            [{ buffer, mode: 'write', use: 'copy-destination' }],
            [{ buffer, mode: 'read', use: 'vertex' }]
        ]);

        const rollbackBuilder = graph.createBuilder();
        const rollbackBuffer = rollbackBuilder.createBuffer('rollback usage', {
            size: 16,
            usage: RHIBufferUsage.COPY_DST
        });
        expect(() =>
            rollbackBuilder.addPass(
                {
                    name: 'failed usage inference',
                    setup(pass) {
                        pass.readBuffer(rollbackBuffer, 'vertex');
                        pass.writeBuffer(rollbackBuffer, 'copy-destination');
                    },
                    execute(context) {
                        void context;
                    }
                },
                undefined
            )
        ).toThrow(expect.objectContaining<Partial<RenderGraphError>>({ code: 'duplicate-access' }));
        rollbackBuilder.addPass(
            {
                name: 'valid usage after rollback',
                setup(pass) {
                    pass.writeBuffer(rollbackBuffer, 'copy-destination');
                },
                execute(context) {
                    void context;
                }
            },
            undefined
        );
        rollbackBuilder.markOutput(rollbackBuffer);
        expect(
            graph.compile(rollbackBuilder, device.capabilities).resourceByHandle.get(rollbackBuffer)
                ?.descriptor.usage
        ).toBe(RHIBufferUsage.COPY_DST);
        graph.destroy();
        backend.destroy();
    });

    it('aggregates readonly storage, vertex, index, and indirect roles for one buffer', () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const buffer = builder.createBuffer('GPU-authored draw data', {
            size: 32,
            usage: RHIBufferUsage.COPY_DST
        });
        builder.addPass(
            {
                name: 'initialize GPU-authored draw data',
                setup(pass) {
                    pass.writeBuffer(buffer, 'copy-destination');
                },
                execute(context) {
                    void context;
                }
            },
            undefined
        );
        builder.addPass(
            {
                name: 'consume GPU-authored draw data',
                setup(pass) {
                    pass.readBuffer(buffer, 'storage');
                    pass.readBuffer(buffer, 'vertex');
                    pass.readBuffer(buffer, 'index');
                    pass.readBuffer(buffer, 'indirect');
                    pass.markSideEffect();
                },
                execute(context) {
                    void context;
                }
            },
            undefined
        );

        const compiled = graph.compile(builder, device.capabilities);

        expect(compiled.resourceByHandle.get(buffer)?.descriptor.usage).toBe(
            RHIBufferUsage.COPY_DST |
                RHIBufferUsage.STORAGE |
                RHIBufferUsage.VERTEX |
                RHIBufferUsage.INDEX |
                RHIBufferUsage.INDIRECT
        );
        expect(compiled.passes[1]?.bufferAccesses).toEqual([
            { buffer, mode: 'read', use: 'storage' },
            { buffer, mode: 'read', use: 'vertex' },
            { buffer, mode: 'read', use: 'index' },
            { buffer, mode: 'read', use: 'indirect' }
        ]);
        expect(compiled.passes[1]?.reads).toEqual(new Set([buffer]));
        graph.destroy();
        backend.destroy();
    });

    it('keeps RAW, WAR, and WAW buffer hazards through explicit storage read-write access', () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const buffer = builder.importBuffer(
            'particles',
            device.createBuffer({ size: 16, usage: RHIBufferUsage.STORAGE })
        );
        builder.addPass(
            {
                name: 'initial write',
                setup(pass) {
                    pass.writeBuffer(buffer, 'storage');
                },
                execute(context) {
                    void context;
                }
            },
            undefined
        );
        builder.addPass(
            {
                name: 'read',
                setup(pass) {
                    pass.readBuffer(buffer, 'storage');
                },
                execute(context) {
                    void context;
                }
            },
            undefined
        );
        builder.addPass(
            {
                name: 'overwrite',
                setup(pass) {
                    pass.writeBuffer(buffer, 'storage');
                },
                execute(context) {
                    void context;
                }
            },
            undefined
        );
        builder.addPass(
            {
                name: 'integrate in place',
                setup(pass) {
                    pass.readWriteBuffer(buffer, 'storage');
                    pass.markSideEffect();
                },
                execute(context) {
                    void context;
                }
            },
            undefined
        );

        const compiled = graph.compile(builder, device.capabilities);

        expect(compiled.passes.map(pass => pass.name)).toEqual([
            'initial write',
            'read',
            'overwrite',
            'integrate in place'
        ]);
        const integrate = compiled.passes[3];
        expect(integrate?.reads).toEqual(new Set([buffer]));
        expect(integrate?.writes).toEqual(new Set([buffer]));
        expect(integrate?.bufferAccesses).toEqual([{ buffer, mode: 'read-write', use: 'storage' }]);
        graph.destroy();
        backend.destroy();
    });

    it('requires initialized contents and an explicit storage declaration for buffer feedback', () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();

        const transientBuilder = graph.createBuilder();
        const transient = transientBuilder.createBuffer('uninitialized storage', {
            size: 16,
            usage: RHIBufferUsage.STORAGE
        });
        transientBuilder.addPass(
            {
                name: 'invalid in-place update',
                setup(pass) {
                    pass.readWriteBuffer(transient, 'storage');
                    pass.markSideEffect();
                },
                execute(context) {
                    void context;
                }
            },
            undefined
        );
        expect(() => graph.compile(transientBuilder, device.capabilities)).toThrow(
            expect.objectContaining<Partial<RenderGraphError>>({ code: 'uninitialized-read' })
        );

        const importedBuilder = graph.createBuilder();
        const imported = importedBuilder.importBuffer(
            'explicitly uninitialized import',
            device.createBuffer({ size: 16, usage: RHIBufferUsage.STORAGE }),
            false
        );
        importedBuilder.addPass(
            {
                name: 'invalid imported read',
                setup(pass) {
                    pass.readBuffer(imported, 'storage');
                    pass.markSideEffect();
                },
                execute(context) {
                    void context;
                }
            },
            undefined
        );
        expect(() => graph.compile(importedBuilder, device.capabilities)).toThrow(
            expect.objectContaining<Partial<RenderGraphError>>({ code: 'uninitialized-read' })
        );

        const feedbackBuilder = graph.createBuilder();
        const feedback = feedbackBuilder.importBuffer(
            'ordinary feedback',
            device.createBuffer({ size: 16, usage: RHIBufferUsage.STORAGE })
        );
        expect(() =>
            feedbackBuilder.addPass(
                {
                    name: 'implicit feedback',
                    setup(pass) {
                        pass.readBuffer(feedback, 'storage');
                        pass.writeBuffer(feedback, 'storage');
                    },
                    execute(context) {
                        void context;
                    }
                },
                undefined
            )
        ).toThrow(expect.objectContaining<Partial<RenderGraphError>>({ code: 'duplicate-access' }));
        graph.destroy();
        backend.destroy();
    });

    it('rejects purpose access missing from an imported buffer usage mask', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const buffer = builder.importBuffer(
            'copy-only import',
            device.createBuffer({ size: 16, usage: RHIBufferUsage.COPY_SRC })
        );

        expect(() =>
            builder.addPass(
                {
                    name: 'invalid vertex consumption',
                    setup(pass) {
                        pass.readBuffer(buffer, 'vertex');
                    },
                    execute(context) {
                        void context;
                    }
                },
                undefined
            )
        ).toThrow(
            expect.objectContaining<Partial<RenderGraphError>>({ code: 'invalid-descriptor' })
        );
        graph.destroy();
        backend.destroy();
    });

    it('rejects loading a first-pass transient attachment before allocation or beginFrame', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const createTexture = vi.spyOn(device, 'createTexture');
        const beginFrame = vi.spyOn(device.graphicsQueue, 'beginFrame');
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const color = builder.createTexture('uninitialized attachment', {
            size: { width: 4, height: 4 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        builder.addPass(
            {
                name: 'invalid first load',
                setup(pass) {
                    pass.useColorAttachment({
                        texture: color,
                        loadOp: 'load',
                        storeOp: 'store'
                    });
                    pass.markSideEffect();
                },
                execute() {
                    throw new Error('invalid pass must not execute');
                }
            },
            undefined
        );

        expect(() => graph.compile(builder, device.capabilities)).toThrow(
            expect.objectContaining<Partial<RenderGraphError>>({ code: 'uninitialized-read' })
        );
        expect(createTexture).not.toHaveBeenCalled();
        expect(beginFrame).not.toHaveBeenCalled();
        graph.destroy();
        backend.destroy();
    });

    it('rejects reads after an attachment storeOp discards its contents', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const color = builder.createTexture('discarded attachment', {
            size: { width: 4, height: 4 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.TEXTURE_BINDING
        });
        builder.addPass(
            {
                name: 'discard color',
                setup(pass) {
                    pass.useColorAttachment({
                        texture: color,
                        clearValue: { r: 0, g: 0, b: 0, a: 1 },
                        loadOp: 'clear',
                        storeOp: 'discard'
                    });
                },
                execute(context) {
                    void context;
                }
            },
            undefined
        );
        builder.addPass(texturePass, {
            reads: [color],
            log: [],
            name: 'read discarded color',
            sideEffect: true
        });

        expect(() => graph.compile(builder, device.capabilities)).toThrow(
            expect.objectContaining<Partial<RenderGraphError>>({ code: 'uninitialized-read' })
        );
        graph.destroy();
        backend.destroy();
    });

    it('keeps a final discarded output writer live without making its contents readable', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const log: string[] = [];
        const color = builder.createTexture('discarded output', {
            size: { width: 4, height: 4 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        builder.addPass(
            {
                name: 'discard final color',
                setup(pass) {
                    pass.useColorAttachment({
                        texture: color,
                        clearValue: { r: 0, g: 0, b: 0, a: 1 },
                        loadOp: 'clear',
                        storeOp: 'discard'
                    });
                },
                execute() {
                    log.push('discard final color');
                }
            },
            undefined
        );
        builder.markOutput(color);

        const compiled = graph.compile(builder, device.capabilities);
        expect(compiled.passes).toHaveLength(1);
        expect(() => graph.execute(compiled, device)).not.toThrow();
        expect(log).toEqual(['discard final color']);
        graph.destroy();
        backend.destroy();
    });

    it('still rejects an uninitialized transient output without a writer', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const color = builder.createTexture('uninitialized output', {
            size: { width: 4, height: 4 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        builder.markOutput(color);

        expect(() => graph.compile(builder, device.capabilities)).toThrow(
            expect.objectContaining<Partial<RenderGraphError>>({ code: 'uninitialized-read' })
        );
        graph.destroy();
        backend.destroy();
    });

    it('rejects extracting a texture whose final writer discards its contents', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const color = builder.createTexture('discarded extraction', {
            size: { width: 4, height: 4 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        builder.addPass(
            {
                name: 'discard extracted color',
                setup(pass) {
                    pass.useColorAttachment({
                        texture: color,
                        clearValue: { r: 0, g: 0, b: 0, a: 1 },
                        loadOp: 'clear',
                        storeOp: 'discard'
                    });
                },
                execute() {
                    // Compile-time extraction validation is under test.
                }
            },
            undefined
        );
        builder.extractTexture(color);

        expect(() => graph.compile(builder, device.capabilities)).toThrow(
            expect.objectContaining<Partial<RenderGraphError>>({ code: 'uninitialized-read' })
        );
        graph.destroy();
        backend.destroy();
    });

    it('tracks depth and stencil attachment availability independently', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const depthStencil = builder.createTexture('mixed depth stencil', {
            size: { width: 4, height: 4 },
            format: 'depth24plus-stencil8',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        builder.addPass(
            {
                name: 'initialize depth discard stencil',
                setup(pass) {
                    pass.useDepthStencilAttachment({
                        texture: depthStencil,
                        depthClearValue: 1,
                        depthLoadOp: 'clear',
                        depthStoreOp: 'store',
                        stencilClearValue: 0,
                        stencilLoadOp: 'clear',
                        stencilStoreOp: 'discard'
                    });
                },
                execute() {
                    // Attachment availability is validated during compilation.
                }
            },
            undefined
        );
        builder.addPass(
            {
                name: 'load preserved depth',
                setup(pass) {
                    pass.useDepthStencilAttachment({
                        texture: depthStencil,
                        depthLoadOp: 'load',
                        depthStoreOp: 'store',
                        stencilClearValue: 1,
                        stencilLoadOp: 'clear',
                        stencilStoreOp: 'discard'
                    });
                },
                execute() {
                    // Attachment availability is validated during compilation.
                }
            },
            undefined
        );
        builder.markOutput(depthStencil);

        expect(graph.compile(builder, device.capabilities).passes).toHaveLength(2);
        graph.destroy();
        backend.destroy();
    });

    it('selects the last graph writer independently for depth and stencil views', () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const texture = device.createTexture({
            size: { width: 4, height: 4 },
            format: 'depth24plus-stencil8',
            usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.TEXTURE_BINDING,
            lifetime: 'persistent'
        });
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const depthStencil = builder.importTexture('persistent depth stencil', texture, false);
        builder.readTextureFromLastGraphWriter(depthStencil);
        const depth = builder.createTextureView('depth aspect', depthStencil, {
            aspect: 'depth-only'
        });
        const stencil = builder.createTextureView('stencil aspect', depthStencil, {
            aspect: 'stencil-only'
        });
        builder.addPass(texturePass, {
            reads: [stencil],
            log: [],
            name: 'read stencil',
            sideEffect: true
        });
        builder.addPass(
            {
                name: 'write stencil',
                setup(pass) {
                    pass.useDepthStencilAttachment({
                        texture: stencil,
                        stencilClearValue: 0,
                        stencilLoadOp: 'clear',
                        stencilStoreOp: 'store'
                    });
                },
                execute() {
                    // Dependency and culling selection are asserted below.
                }
            },
            undefined
        );
        builder.addPass(
            {
                name: 'write depth',
                setup(pass) {
                    pass.useDepthStencilAttachment({
                        texture: depth,
                        depthClearValue: 1,
                        depthLoadOp: 'clear',
                        depthStoreOp: 'store'
                    });
                },
                execute() {
                    // A depth-only writer must not satisfy the stencil read.
                }
            },
            undefined
        );

        const compiled = graph.compile(builder, device.capabilities);
        expect(compiled.passes.map(pass => pass.name)).toEqual(['write stencil', 'texture access']);

        graph.destroy();
        texture.destroy();
        backend.destroy();
    });

    it('rejects attachment declarations without RENDER_ATTACHMENT usage', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const createTexture = vi.spyOn(device, 'createTexture');
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const sampled = builder.createTexture('sampled-only attachment', {
            size: { width: 4, height: 4 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        builder.addPass(
            {
                name: 'invalid attachment usage',
                setup(pass) {
                    pass.useColorAttachment({
                        texture: sampled,
                        clearValue: { r: 0, g: 0, b: 0, a: 1 },
                        loadOp: 'clear',
                        storeOp: 'store'
                    });
                },
                execute(context) {
                    void context;
                }
            },
            undefined
        );
        builder.markOutput(sampled);

        expect(() => graph.compile(builder, device.capabilities)).toThrow(
            expect.objectContaining<Partial<RenderGraphError>>({ code: 'invalid-descriptor' })
        );
        expect(createTexture).not.toHaveBeenCalled();
        graph.destroy();
        backend.destroy();
    });

    it('orders a legal attachment load after its writer without treating it as sampled feedback', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const color = builder.createTexture('loaded attachment', {
            size: { width: 4, height: 4 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const log: string[] = [];
        const attachmentPass: RenderPassTemplate<{
            readonly loadOp: 'load' | 'clear';
            readonly name: string;
        }> = {
            name: 'attachment load chain',
            setup(pass, params) {
                pass.useColorAttachment({
                    texture: color,
                    ...(params.loadOp === 'clear'
                        ? { clearValue: { r: 0, g: 0, b: 0, a: 1 } }
                        : {}),
                    loadOp: params.loadOp,
                    storeOp: 'store'
                });
            },
            execute(_context, params) {
                log.push(params.name);
            }
        };
        builder.addPass(attachmentPass, { loadOp: 'clear', name: 'initialize' });
        builder.addPass(attachmentPass, { loadOp: 'load', name: 'preserve' });
        builder.markOutput(color);

        const compiled = graph.compile(builder, device.capabilities);
        expect(compiled.passes.map(pass => pass.params)).toEqual([
            { loadOp: 'clear', name: 'initialize' },
            { loadOp: 'load', name: 'preserve' }
        ]);
        graph.execute(compiled, device);
        expect(log).toEqual(['initialize', 'preserve']);
        graph.destroy();
        backend.destroy();
    });

    it('tracks a read-only depth attachment as a load dependency', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const depth = builder.createTexture('read-only depth', {
            size: { width: 4, height: 4 },
            format: 'depth24plus',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const log: string[] = [];
        builder.addPass(
            {
                name: 'initialize depth',
                setup(pass) {
                    pass.useDepthStencilAttachment({
                        texture: depth,
                        depthClearValue: 1,
                        depthLoadOp: 'clear',
                        depthStoreOp: 'store'
                    });
                },
                execute() {
                    log.push('initialize');
                }
            },
            undefined
        );
        builder.addPass(
            {
                name: 'read depth',
                setup(pass) {
                    pass.useDepthStencilAttachment({ texture: depth, depthReadOnly: true });
                    pass.markSideEffect();
                },
                execute() {
                    log.push('read');
                }
            },
            undefined
        );

        const compiled = graph.compile(builder, device.capabilities);
        expect(compiled.passes.map(pass => pass.name)).toEqual(['initialize depth', 'read depth']);
        graph.execute(compiled, device);
        expect(log).toEqual(['initialize', 'read']);
        graph.destroy();
        backend.destroy();
    });

    it('validates resolve sample counts, formats, and extents and accepts a legal resolve', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const compileResolve = (options: {
            readonly sourceSampleCount: number;
            readonly targetSampleCount: number;
            readonly targetFormat?: 'rgba8unorm' | 'rgba16float';
            readonly targetWidth?: number;
        }) => {
            const builder = graph.createBuilder();
            const source = builder.createTexture('resolve source', {
                size: { width: 4, height: 4 },
                sampleCount: options.sourceSampleCount,
                format: 'rgba8unorm',
                usage: RHITextureUsage.RENDER_ATTACHMENT
            });
            const target = builder.createTexture('resolve target', {
                size: { width: options.targetWidth ?? 4, height: 4 },
                sampleCount: options.targetSampleCount,
                format: options.targetFormat ?? 'rgba8unorm',
                usage: RHITextureUsage.RENDER_ATTACHMENT
            });
            builder.addPass(
                {
                    name: 'resolve color',
                    setup(pass) {
                        pass.useColorAttachment({
                            texture: source,
                            resolveTarget: target,
                            clearValue: { r: 0, g: 0, b: 0, a: 1 },
                            loadOp: 'clear',
                            storeOp: 'discard'
                        });
                    },
                    execute(context) {
                        void context;
                    }
                },
                undefined
            );
            builder.markOutput(target);
            return graph.compile(builder, device.capabilities);
        };

        expect(() => compileResolve({ sourceSampleCount: 1, targetSampleCount: 1 })).toThrow(
            expect.objectContaining({ code: 'invalid-descriptor' })
        );
        expect(() => compileResolve({ sourceSampleCount: 4, targetSampleCount: 4 })).toThrow(
            expect.objectContaining({ code: 'invalid-descriptor' })
        );
        expect(() =>
            compileResolve({
                sourceSampleCount: 4,
                targetSampleCount: 1,
                targetFormat: 'rgba16float'
            })
        ).toThrow(expect.objectContaining({ code: 'invalid-descriptor' }));
        expect(() =>
            compileResolve({
                sourceSampleCount: 4,
                targetSampleCount: 1,
                targetWidth: 8
            })
        ).toThrow(expect.objectContaining({ code: 'invalid-descriptor' }));

        const compiled = compileResolve({ sourceSampleCount: 4, targetSampleCount: 1 });
        expect(compiled.passes).toHaveLength(1);
        expect(() => graph.execute(compiled, device)).not.toThrow();
        graph.destroy();
        backend.destroy();
    });

    it('promotes extracted transient descriptors and allocations to persistent lifetime', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const texture = builder.createTexture('extracted texture', {
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const buffer = builder.createBuffer('extracted buffer', {
            size: 4,
            usage: RHIBufferUsage.COPY_DST
        });
        const template: RenderPassTemplate<undefined> = {
            name: 'write extracted resources',
            setup(pass) {
                pass.writeTexture(texture);
                pass.writeBuffer(buffer, 'copy-destination');
            },
            execute(context) {
                void context;
            }
        };
        builder.addPass(template, undefined);
        builder.extractTexture(texture);
        builder.extractBuffer(buffer);

        const compiled = graph.compile(builder, device.capabilities);
        expect(compiled.resourceByHandle.get(texture)?.descriptor.lifetime).toBe('persistent');
        expect(compiled.resourceByHandle.get(buffer)?.descriptor.lifetime).toBe('persistent');

        const result = graph.execute(compiled, device);
        const extractedTexture = result.getExtractedTexture(texture);
        const extractedBuffer = result.getExtractedBuffer(buffer);
        expect(extractedTexture.lifetime).toBe('persistent');
        expect(extractedBuffer.lifetime).toBe('persistent');
        extractedTexture.destroy();
        extractedBuffer.destroy();
        graph.destroy();
        backend.destroy();
    });
});

describe('RenderGraph execute', () => {
    it('acquires lazy imports after compile and before prepare or beginFrame', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const log: string[] = [];
        const textureProvider = vi.fn(() => {
            log.push('texture');
            return device.createTexture({
                lifetime: 'frame',
                size: { width: 1, height: 1 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.TEXTURE_BINDING
            });
        });
        const bufferProvider = vi.fn(() => {
            log.push('buffer');
            return device.createBuffer({
                lifetime: 'frame',
                size: 4,
                usage: RHIBufferUsage.COPY_SRC | RHIBufferUsage.VERTEX
            });
        });
        const texture = builder.importTextureProvider(
            'late texture',
            {
                size: { width: 1, height: 1 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.TEXTURE_BINDING
            },
            textureProvider
        );
        const buffer = builder.importBufferProvider(
            'late buffer',
            { size: 4, usage: RHIBufferUsage.COPY_SRC },
            bufferProvider
        );
        const queue = device.graphicsQueue;
        const beginFrame = queue.beginFrame.bind(queue);
        vi.spyOn(queue, 'beginFrame').mockImplementation(descriptor => {
            log.push('begin');
            return beginFrame(descriptor);
        });
        const template: RenderPassTemplate<undefined> = {
            name: 'lazy imports',
            setup(pass) {
                pass.readTexture(texture);
                pass.readBuffer(buffer, 'copy-source');
                pass.markSideEffect();
            },
            prepare(context) {
                expect(queue.state).toBe('idle');
                expect(context.getTexture(texture).lifetime).toBe('frame');
                expect(context.getBuffer(buffer).lifetime).toBe('frame');
                log.push('prepare');
            },
            execute() {
                log.push('execute');
            }
        };
        builder.addPass(template, undefined);

        const compiled = graph.compile(builder, device.capabilities);
        expect(textureProvider).not.toHaveBeenCalled();
        expect(bufferProvider).not.toHaveBeenCalled();
        expect(log).toEqual([]);

        graph.execute(compiled, device);

        expect(textureProvider).toHaveBeenCalledTimes(1);
        expect(bufferProvider).toHaveBeenCalledTimes(1);
        expect(log).toEqual(['texture', 'buffer', 'prepare', 'begin', 'execute']);
        graph.destroy();
        backend.destroy();
    });

    it('does not acquire lazy imports referenced only by culled passes', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const provider = vi.fn(() =>
            device.createTexture({
                lifetime: 'frame',
                size: { width: 1, height: 1 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.TEXTURE_BINDING
            })
        );
        const texture = builder.importTextureProvider(
            'culled lazy texture',
            {
                size: { width: 1, height: 1 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.TEXTURE_BINDING
            },
            provider
        );
        builder.addPass(
            {
                name: 'culled lazy reader',
                setup(pass) {
                    pass.readTexture(texture);
                },
                execute() {
                    throw new Error('culled pass must not execute');
                }
            },
            undefined
        );

        const compiled = graph.compile(builder, device.capabilities);
        expect(compiled.passes).toHaveLength(0);
        expect(compiled.resources).toHaveLength(0);
        graph.execute(compiled, device);
        expect(provider).not.toHaveBeenCalled();
        graph.destroy();
        backend.destroy();
    });

    it('rejects lazy import acquisition failures before beginFrame', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const texture = builder.importTextureProvider(
            'failed lazy texture',
            {
                size: { width: 1, height: 1 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.TEXTURE_BINDING
            },
            () => {
                throw new Error('surface acquisition failed');
            }
        );
        builder.addPass(
            {
                name: 'failed lazy reader',
                setup(pass) {
                    pass.readTexture(texture);
                    pass.markSideEffect();
                },
                execute() {
                    throw new Error('execute must not run');
                }
            },
            undefined
        );
        const beginFrame = vi.spyOn(device.graphicsQueue, 'beginFrame');

        expect(() => graph.execute(graph.compile(builder, device.capabilities), device)).toThrow(
            'surface acquisition failed'
        );
        expect(beginFrame).not.toHaveBeenCalled();
        expect(device.graphicsQueue.state).toBe('idle');
        graph.destroy();
        backend.destroy();
    });

    it('validates lazy import ownership and descriptor identity before beginFrame', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const otherDevice = backend.createDevice();
        const graph = new RenderGraph();

        const build = (provider: () => ReturnType<typeof device.createTexture>) => {
            const builder = graph.createBuilder();
            const texture = builder.importTextureProvider(
                'validated lazy texture',
                {
                    size: { width: 1, height: 1 },
                    format: 'rgba8unorm',
                    usage: RHITextureUsage.TEXTURE_BINDING
                },
                provider
            );
            builder.addPass(
                {
                    name: 'validated lazy reader',
                    setup(pass) {
                        pass.readTexture(texture);
                        pass.markSideEffect();
                    },
                    execute() {
                        throw new Error('execute must not run');
                    }
                },
                undefined
            );
            return graph.compile(builder, device.capabilities);
        };
        const beginFrame = vi.spyOn(device.graphicsQueue, 'beginFrame');
        const wrongOwner = otherDevice.createTexture({
            lifetime: 'frame',
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        expect(() =>
            graph.execute(
                build(() => wrongOwner),
                device
            )
        ).toThrow(expect.objectContaining({ code: 'wrong-device' }));

        const wrongDescriptor = device.createTexture({
            lifetime: 'frame',
            size: { width: 2, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        expect(() =>
            graph.execute(
                build(() => wrongDescriptor),
                device
            )
        ).toThrow(
            expect.objectContaining<Partial<RenderGraphError>>({ code: 'invalid-descriptor' })
        );
        expect(beginFrame).not.toHaveBeenCalled();
        graph.destroy();
        backend.destroy();
    });

    it('prepares live passes in compiled order after all resources exist and before beginFrame', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const first = builder.createBuffer('first', {
            size: 4,
            usage: RHIBufferUsage.COPY_DST
        });
        const output = builder.createBuffer('output', {
            size: 4,
            usage: RHIBufferUsage.COPY_DST
        });
        const createBuffer = vi.spyOn(device, 'createBuffer');
        const log: string[] = [];
        const queue = device.graphicsQueue;
        const beginFrame = queue.beginFrame.bind(queue);
        vi.spyOn(queue, 'beginFrame').mockImplementation(descriptor => {
            log.push('begin');
            return beginFrame(descriptor);
        });
        const template: RenderPassTemplate<{ readonly name: string }> = {
            name: 'prepare order',
            setup(pass, params) {
                if (params.name === 'first') pass.writeBuffer(first, 'copy-destination');
                else {
                    pass.writeBuffer(output, 'copy-destination');
                    pass.dependsOn(firstPass);
                }
            },
            prepare(_context, params) {
                expect(queue.state).toBe('idle');
                expect(createBuffer).toHaveBeenCalledTimes(2);
                log.push(`prepare:${params.name}`);
            },
            execute(_context, params) {
                expect(queue.state).toBe('frame-open');
                log.push(`execute:${params.name}`);
            }
        };
        const firstPass = builder.addPass(template, { name: 'first' });
        builder.addPass(template, { name: 'second' });
        builder.markOutput(output);

        graph.execute(graph.compile(builder, device.capabilities), device);

        expect(log).toEqual([
            'prepare:first',
            'prepare:second',
            'begin',
            'execute:first',
            'execute:second'
        ]);
        graph.destroy();
        backend.destroy();
    });

    it('gives prepare only declared resources and no command context', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const declared = builder.createTexture('declared', {
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const undeclared = builder.importTexture(
            'undeclared',
            device.createTexture({
                size: { width: 1, height: 1 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.TEXTURE_BINDING
            })
        );
        const beginFrame = vi.spyOn(device.graphicsQueue, 'beginFrame');
        const template: RenderPassTemplate<undefined> = {
            name: 'restricted prepare',
            setup(pass) {
                pass.writeTexture(declared);
                pass.markSideEffect();
            },
            prepare(context) {
                expect('commandContext' in context).toBe(false);
                expect(context.getTexture(declared)).toBeDefined();
                expect(context.getTextureView(declared)).toBeDefined();
                context.getTexture(undeclared);
            },
            execute() {
                throw new Error('execute must not run');
            }
        };
        builder.addPass(template, undefined);
        const compiled = graph.compile(builder, device.capabilities);

        expect(() => graph.execute(compiled, device)).toThrow(
            expect.objectContaining<Partial<RenderGraphError>>({ code: 'undeclared-access' })
        );
        expect(beginFrame).not.toHaveBeenCalled();
        expect(device.graphicsQueue.state).toBe('idle');
        graph.destroy();
        backend.destroy();
    });

    it('keeps callback context shells stale while reusing their unreachable workspace', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const output = builder.createBuffer('stale callback context output', {
            size: 4,
            usage: RHIBufferUsage.COPY_DST
        });
        let firstPrepareContext: RGPrepareContext | null = null;
        let firstPassContext: RGPassContext | null = null;
        builder.addPass(
            {
                name: 'stale callback contexts',
                setup(pass) {
                    pass.writeBuffer(output, 'copy-destination');
                },
                prepare(context) {
                    if (firstPrepareContext === null) firstPrepareContext = context;
                    else {
                        expect(context).not.toBe(firstPrepareContext);
                        expect(() => firstPrepareContext?.getBuffer(output)).toThrow(
                            /no active pass/u
                        );
                    }
                },
                execute(context) {
                    if (firstPassContext === null) firstPassContext = context;
                    else {
                        expect(context).not.toBe(firstPassContext);
                        expect(context.commandContext).not.toBe(firstPassContext.commandContext);
                        expect(firstPassContext.commandContext.state).toBe('ended');
                        expect(() => firstPassContext?.getBuffer(output)).toThrow(
                            /no active pass/u
                        );
                    }
                }
            },
            undefined
        );
        builder.markOutput(output);
        const compiled = graph.compile(builder, device.capabilities);

        graph.execute(compiled, device);
        const growths = graph.storageDiagnostics.executorStorageGrowths;
        graph.execute(compiled, device);
        expect(graph.storageDiagnostics).toMatchObject({
            executorWorkspaceCapacity: 1,
            executorResourceCapacity: 1,
            executorStorageGrowths: growths
        });
        graph.destroy();
        backend.destroy();
    });

    it('recycles pooled resources and destroys non-pooled views when prepare fails', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const importedTexture = device.createTexture({
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        const createView = vi.spyOn(importedTexture, 'createView');
        const createBuffer = vi.spyOn(device, 'createBuffer');
        const beginFrame = vi.spyOn(device.graphicsQueue, 'beginFrame');
        const params = { fail: true };
        const builder = graph.createBuilder();
        const imported = builder.importTexture('imported', importedTexture);
        const pooled = builder.createBuffer('pooled', {
            size: 4,
            usage: RHIBufferUsage.COPY_DST
        });
        const template: RenderPassTemplate<typeof params> = {
            name: 'recoverable prepare',
            setup(pass) {
                pass.readTexture(imported);
                pass.writeBuffer(pooled, 'copy-destination');
                pass.markSideEffect();
            },
            prepare(context, state) {
                context.getTextureView(imported);
                context.getBuffer(pooled);
                if (state.fail) throw new Error('prepare failed');
            },
            execute(context) {
                void context;
            }
        };
        builder.addPass(template, params);
        const compiled = graph.compile(builder, device.capabilities);

        expect(() => graph.execute(compiled, device)).toThrow('prepare failed');
        const failedView = createView.mock.results[0]?.value as FakeRHITextureView | undefined;
        expect(failedView?.destroyed).toBe(true);
        expect(createBuffer).toHaveBeenCalledTimes(1);
        expect(beginFrame).not.toHaveBeenCalled();
        const storage = graph.storageDiagnostics;
        expect(storage).toMatchObject({
            executorWorkspaceCapacity: 1,
            executorResourceCapacity: 2,
            executorLookupCapacity: 8,
            executorStorageGrowths: 4
        });
        const growths = storage.executorStorageGrowths;

        params.fail = false;
        graph.execute(compiled, device);
        expect(createBuffer).toHaveBeenCalledTimes(1);
        expect(beginFrame).toHaveBeenCalledTimes(1);
        expect(graph.storageDiagnostics).toBe(storage);
        expect(storage.executorStorageGrowths).toBe(growths);
        graph.destroy();
        backend.destroy();
    });

    it('destroys extracted allocations when prepare fails before a frame starts', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const extracted = builder.createBuffer('extracted', {
            size: 4,
            usage: RHIBufferUsage.COPY_DST
        });
        const createBuffer = vi.spyOn(device, 'createBuffer');
        const beginFrame = vi.spyOn(device.graphicsQueue, 'beginFrame');
        const template: RenderPassTemplate<undefined> = {
            name: 'failed extracted prepare',
            setup(pass) {
                pass.writeBuffer(extracted, 'copy-destination');
            },
            prepare(context) {
                context.getBuffer(extracted);
                throw new Error('cannot prepare extracted resource');
            },
            execute(context) {
                void context;
            }
        };
        builder.addPass(template, undefined);
        builder.extractBuffer(extracted);

        expect(() => graph.execute(graph.compile(builder, device.capabilities), device)).toThrow(
            'cannot prepare extracted resource'
        );
        const resource = createBuffer.mock.results[0]?.value as FakeRHIBuffer | undefined;
        expect(resource?.destroyed).toBe(true);
        expect(beginFrame).not.toHaveBeenCalled();
        backend.destroy();
    });

    it('reuses exact transient resources after a synchronous submission completes', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const createBuffer = vi.spyOn(device, 'createBuffer');
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const output = builder.createBuffer('pooled output', {
            size: 16,
            usage: RHIBufferUsage.COPY_DST
        });
        const template: RenderPassTemplate<undefined> = {
            name: 'pooled write',
            setup(pass) {
                pass.writeBuffer(output, 'copy-destination');
            },
            execute(context) {
                void context;
            }
        };
        builder.addPass(template, undefined);
        builder.markOutput(output);
        const compiled = graph.compile(builder, device.capabilities);

        const first = graph.execute(compiled, device);
        const second = graph.execute(compiled, device);
        expect(createBuffer).toHaveBeenCalledTimes(1);
        expect(first.diagnostics.transientAllocations).toBe(1);
        expect(second.diagnostics.transientAllocations).toBe(0);
        const storage = graph.storageDiagnostics;
        expect(storage).toMatchObject({
            executorWorkspaceCapacity: 1,
            executorResourceCapacity: 1,
            executorLookupCapacity: 8,
            executorStorageGrowths: 3
        });
        const pooled = createBuffer.mock.results[0]?.value as FakeRHIBuffer | undefined;
        expect(pooled?.destroyed).toBe(false);
        graph.destroy();
        expect(pooled?.destroyed).toBe(true);
        backend.destroy();
    });

    it('does not revive an unmapped transient buffer as mapped-at-creation', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const createBuffer = vi.spyOn(device, 'createBuffer');
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const output = builder.createBuffer('mapped transient output', {
            size: 4,
            usage: RHIBufferUsage.COPY_DST,
            mappedAtCreation: true
        });
        builder.addPass(
            {
                name: 'consume mapped transient',
                setup(pass) {
                    pass.writeBuffer(output, 'copy-destination');
                },
                prepare(context) {
                    const buffer = context.getBuffer(output);
                    expect(buffer.mapState).toBe('mapped');
                    expect(buffer.getMappedRange().byteLength).toBe(4);
                    buffer.unmap();
                },
                execute(context) {
                    void context;
                }
            },
            undefined
        );
        builder.markOutput(output);
        const compiled = graph.compile(builder, device.capabilities);

        graph.execute(compiled, device);
        graph.execute(compiled, device);

        expect(createBuffer).toHaveBeenCalledTimes(2);
        const first = createBuffer.mock.results[0]?.value as FakeRHIBuffer | undefined;
        const second = createBuffer.mock.results[1]?.value as FakeRHIBuffer | undefined;
        expect(first?.destroyed).toBe(true);
        expect(second?.destroyed).toBe(true);
        graph.destroy();
        backend.destroy();
    });

    it('keeps distinct transient pool entries for different default texture view dimensions', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const createTexture = vi.spyOn(device, 'createTexture');
        const graph = new RenderGraph();
        const observedDimensions: string[] = [];
        const compile = (viewDimension: '2d-array' | 'cube') => {
            const builder = graph.createBuilder();
            const output = builder.createTexture(`${viewDimension} output`, {
                size: { width: 4, height: 4, depthOrArrayLayers: 6 },
                dimension: '2d',
                viewDimension,
                format: 'rgba8unorm',
                usage: RHITextureUsage.RENDER_ATTACHMENT
            });
            const template: RenderPassTemplate<undefined> = {
                name: `${viewDimension} write`,
                setup(pass) {
                    pass.writeTexture(output);
                },
                prepare(context) {
                    observedDimensions.push(context.getTexture(output).descriptor.viewDimension);
                },
                execute(context) {
                    void context;
                }
            };
            builder.addPass(template, undefined);
            builder.markOutput(output);
            return graph.compile(builder, device.capabilities);
        };

        graph.execute(compile('2d-array'), device);
        graph.execute(compile('cube'), device);

        expect(observedDimensions).toEqual(['2d-array', 'cube']);
        expect(createTexture).toHaveBeenCalledTimes(2);
        graph.destroy();
        backend.destroy();
    });

    it('uses exact descriptors when distinct transient textures collide in the numeric pool key', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const createTexture = vi.spyOn(device, 'createTexture');
        const graph = new RenderGraph();
        const observedDescriptors: string[] = [];
        // These normalized descriptors intentionally collide under resourcePoolKey's FNV-style
        // 32-bit bucket. Structural comparison must keep both native allocations in that bucket.
        const descriptors = [
            {
                size: { width: 115, height: 42 },
                mipLevelCount: 5,
                format: 'rg11b10ufloat',
                usage:
                    RHITextureUsage.COPY_SRC |
                    RHITextureUsage.COPY_DST |
                    RHITextureUsage.TEXTURE_BINDING |
                    RHITextureUsage.RENDER_ATTACHMENT
            },
            {
                size: { width: 113, height: 16 },
                mipLevelCount: 6,
                format: 'rg32uint',
                usage: RHITextureUsage.TEXTURE_BINDING | RHITextureUsage.RENDER_ATTACHMENT
            }
        ] as const;
        const compile = (index: number) => {
            const descriptor = descriptors[index];
            if (!descriptor) throw new Error('collision descriptor is unavailable');
            const builder = graph.createBuilder();
            const output = builder.createTexture(`collision output ${String(index)}`, descriptor);
            builder.addPass(
                {
                    name: `collision write ${String(index)}`,
                    setup(pass) {
                        pass.writeTexture(output);
                    },
                    prepare(context) {
                        const texture = context.getTexture(output);
                        observedDescriptors.push(
                            `${String(texture.width)}x${String(texture.height)}:${texture.format}`
                        );
                    },
                    execute(context) {
                        void context;
                    }
                },
                undefined
            );
            builder.markOutput(output);
            return graph.compile(builder, device.capabilities);
        };
        const first = compile(0);
        const second = compile(1);

        graph.execute(first, device);
        graph.execute(second, device);
        graph.execute(first, device);

        expect(observedDescriptors).toEqual([
            '115x42:rg11b10ufloat',
            '113x16:rg32uint',
            '115x42:rg11b10ufloat'
        ]);
        expect(createTexture).toHaveBeenCalledTimes(2);
        graph.destroy();
        backend.destroy();
    });

    it('prunes pooled textures whose cached default view was destroyed', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const createTexture = vi.spyOn(device, 'createTexture');
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const output = builder.createTexture('view invalidation output', {
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const textures: ReturnType<typeof device.createTexture>[] = [];
        const views: ReturnType<ReturnType<typeof device.createTexture>['createView']>[] = [];
        const template: RenderPassTemplate<undefined> = {
            name: 'view invalidation write',
            setup(pass) {
                pass.writeTexture(output);
            },
            prepare(context) {
                textures.push(
                    context.getTexture(output) as ReturnType<typeof device.createTexture>
                );
                views.push(context.getTextureView(output));
            },
            execute(context) {
                void context;
            }
        };
        builder.addPass(template, undefined);
        builder.markOutput(output);
        const compiled = graph.compile(builder, device.capabilities);

        graph.execute(compiled, device);
        views[0]?.destroy();
        graph.execute(compiled, device);

        expect(createTexture).toHaveBeenCalledTimes(2);
        expect(textures[0]?.destroyed).toBe(true);
        expect(textures[1]).not.toBe(textures[0]);
        graph.destroy();
        backend.destroy();
    });

    it('prunes pooled resources from a stale generation before allocating replacements', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const createBuffer = vi.spyOn(device, 'createBuffer');
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const output = builder.createBuffer('generation output', {
            size: 4,
            usage: RHIBufferUsage.COPY_DST
        });
        const template: RenderPassTemplate<undefined> = {
            name: 'generation write',
            setup(pass) {
                pass.writeBuffer(output, 'copy-destination');
            },
            execute(context) {
                void context;
            }
        };
        builder.addPass(template, undefined);
        builder.markOutput(output);
        const compiled = graph.compile(builder, device.capabilities);

        graph.execute(compiled, device);
        const stale = createBuffer.mock.results[0]?.value as FakeRHIBuffer | undefined;
        expect(stale?.destroyed).toBe(false);
        device.advanceGeneration();
        graph.execute(compiled, device);

        expect(createBuffer).toHaveBeenCalledTimes(2);
        expect(stale?.destroyed).toBe(true);
        graph.destroy();
        backend.destroy();
    });

    it('discards every pooled key when execution moves to another device', () => {
        const backend = new FakeWebGLRHIBackend();
        const firstDevice = backend.createDevice();
        const secondDevice = backend.createDevice();
        const firstCreateBuffer = vi.spyOn(firstDevice, 'createBuffer');
        const secondCreateBuffer = vi.spyOn(secondDevice, 'createBuffer');
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const small = builder.createBuffer('small pooled output', {
            size: 4,
            usage: RHIBufferUsage.COPY_DST
        });
        const large = builder.createBuffer('large pooled output', {
            size: 64,
            usage: RHIBufferUsage.COPY_DST
        });
        const template: RenderPassTemplate<undefined> = {
            name: 'multi-key pooled write',
            setup(pass) {
                pass.writeBuffer(small, 'copy-destination');
                pass.writeBuffer(large, 'copy-destination');
            },
            execute(context) {
                void context;
            }
        };
        builder.addPass(template, undefined);
        builder.markOutput(small);
        builder.markOutput(large);
        const compiled = graph.compile(builder, firstDevice.capabilities);

        graph.execute(compiled, firstDevice);
        const firstSmall = firstCreateBuffer.mock.results[0]?.value as FakeRHIBuffer | undefined;
        const firstLarge = firstCreateBuffer.mock.results[1]?.value as FakeRHIBuffer | undefined;
        expect(firstSmall?.destroyed).toBe(false);
        expect(firstLarge?.destroyed).toBe(false);

        graph.execute(compiled, secondDevice);

        expect(firstSmall?.destroyed).toBe(true);
        expect(firstLarge?.destroyed).toBe(true);
        expect(secondCreateBuffer).toHaveBeenCalledTimes(2);
        graph.destroy();
        backend.destroy();
    });

    it('does not reuse a transient resource before deferred submission completion', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const createBuffer = vi.spyOn(device, 'createBuffer');
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const output = builder.createBuffer('deferred pooled output', {
            size: 16,
            usage: RHIBufferUsage.COPY_DST
        });
        const template: RenderPassTemplate<undefined> = {
            name: 'deferred pooled write',
            setup(pass) {
                pass.writeBuffer(output, 'copy-destination');
            },
            execute(context) {
                void context;
            }
        };
        builder.addPass(template, undefined);
        builder.markOutput(output);
        const compiled = graph.compile(builder, device.capabilities);

        const first = graph.execute(compiled, device);
        const second = graph.execute(compiled, device);
        expect(createBuffer).toHaveBeenCalledTimes(2);
        const storage = graph.storageDiagnostics;
        expect(storage).toMatchObject({
            executorWorkspaceCapacity: 2,
            executorResourceCapacity: 2,
            executorLookupCapacity: 16,
            executorStorageGrowths: 6
        });
        const growths = storage.executorStorageGrowths;
        backend.completeNextSubmission();
        await first.submission.done;
        backend.completeNextSubmission();
        await second.submission.done;

        const third = graph.execute(compiled, device);
        expect(createBuffer).toHaveBeenCalledTimes(2);
        expect(third.diagnostics.transientAllocations).toBe(0);
        expect(graph.storageDiagnostics).toBe(storage);
        expect(storage.executorStorageGrowths).toBe(growths);
        backend.completeNextSubmission();
        await third.submission.done;
        graph.destroy();
        backend.destroy();
    });

    it('defers executor-pool destruction until an in-flight submission settles', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const createBuffer = vi.spyOn(device, 'createBuffer');
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const output = builder.createBuffer('destroyed graph pending output', {
            size: 16,
            usage: RHIBufferUsage.COPY_DST
        });
        builder.addPass(
            {
                name: 'pending destroy write',
                setup(pass) {
                    pass.writeBuffer(output, 'copy-destination');
                },
                execute(context) {
                    void context;
                }
            },
            undefined
        );
        builder.markOutput(output);
        const compiled = graph.compile(builder, device.capabilities);
        const result = graph.execute(compiled, device);
        const resource = createBuffer.mock.results[0]?.value as FakeRHIBuffer | undefined;

        graph.destroy();
        expect(resource?.destroyed).toBe(false);
        expect(() => graph.execute(compiled, device)).toThrow('Render graph executor is destroyed');
        backend.completeNextSubmission();
        await result.submission.done;
        expect(resource?.destroyed).toBe(true);
        backend.destroy();
    });

    it('recycles a failed in-flight workspace after device-generation recovery', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const createBuffer = vi.spyOn(device, 'createBuffer');
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const output = builder.createBuffer('generation recovery output', {
            size: 16,
            usage: RHIBufferUsage.COPY_DST
        });
        builder.addPass(
            {
                name: 'generation recovery write',
                setup(pass) {
                    pass.writeBuffer(output, 'copy-destination');
                },
                execute(context) {
                    void context;
                }
            },
            undefined
        );
        builder.markOutput(output);
        const compiled = graph.compile(builder, device.capabilities);
        const failed = graph.execute(compiled, device);
        const stale = createBuffer.mock.results[0]?.value as FakeRHIBuffer | undefined;
        const storage = graph.storageDiagnostics;
        const growths = storage.executorStorageGrowths;

        device.advanceGeneration();
        await expect(failed.submission.done).rejects.toThrow(/generation 1 was lost/u);
        expect(stale?.destroyed).toBe(true);
        expect(stale?.nativeReleased).toBe(true);
        const recovered = graph.execute(compiled, device);
        expect(createBuffer).toHaveBeenCalledTimes(2);
        expect(graph.storageDiagnostics).toBe(storage);
        expect(storage).toMatchObject({
            executorWorkspaceCapacity: 1,
            executorResourceCapacity: 1,
            executorStorageGrowths: growths
        });
        backend.completeNextSubmission();
        await recovered.submission.done;
        graph.destroy();
        backend.destroy();
    });

    it('executes declared copy work and transfers an extracted resource', async () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const source = device.createBuffer({
            size: 4,
            usage: RHIBufferUsage.COPY_SRC,
            initialData: new Uint8Array([3, 1, 4, 1])
        });
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const sourceHandle = builder.importBuffer('source', source);
        const destinationHandle = builder.createBuffer('destination', {
            size: 4,
            usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.COPY_SRC
        });
        const copyPass: RenderPassTemplate<undefined> = {
            name: 'copy',
            setup(pass) {
                pass.readBuffer(sourceHandle, 'copy-source');
                pass.writeBuffer(destinationHandle, 'copy-destination');
            },
            execute(context) {
                context.commandContext.copyBufferToBuffer(
                    context.getBuffer(sourceHandle),
                    0,
                    context.getBuffer(destinationHandle),
                    0,
                    4
                );
            }
        };
        builder.addPass(copyPass, undefined);
        builder.extractBuffer(destinationHandle);
        const compiled = graph.compile(builder, device.capabilities);

        const result = graph.execute(compiled, device, { frameIndex: 7 });
        await result.submission.done;
        const destination = result.getExtractedBuffer(destinationHandle);
        expect(destination).toBeInstanceOf(FakeRHIBuffer);
        expect([...(destination as FakeRHIBuffer).snapshotBytes()]).toEqual([3, 1, 4, 1]);
        expect(destination.destroyed).toBe(false);
        const second = graph.execute(compiled, device);
        await second.submission.done;
        const secondDestination = second.getExtractedBuffer(destinationHandle);
        expect(secondDestination).not.toBe(destination);
        expect(result.getExtractedBuffer(destinationHandle)).toBe(destination);
        secondDestination.destroy();
        destination.destroy();
        graph.destroy();
        backend.destroy();
    });

    it('aborts the frame and preserves the original error on undeclared access', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const declared = builder.createBuffer('declared', {
            size: 4,
            usage: RHIBufferUsage.COPY_DST
        });
        const other = builder.importBuffer(
            'other',
            device.createBuffer({ size: 4, usage: RHIBufferUsage.COPY_SRC })
        );
        const badPass: RenderPassTemplate<undefined> = {
            name: 'bad access',
            setup(pass) {
                pass.writeBuffer(declared, 'copy-destination');
                pass.markSideEffect();
            },
            execute(context) {
                context.getBuffer(other);
            }
        };
        builder.addPass(badPass, undefined);
        const compiled = graph.compile(builder, device.capabilities);

        expect(() => graph.execute(compiled, device)).toThrow(
            expect.objectContaining<Partial<RenderGraphError>>({ code: 'undeclared-access' })
        );
        expect(device.graphicsQueue.state).toBe('idle');
        const storage = graph.storageDiagnostics;
        expect(storage).toMatchObject({
            executorWorkspaceCapacity: 1,
            executorResourceCapacity: 1,
            executorLookupCapacity: 8,
            executorStorageGrowths: 3
        });
        const growths = storage.executorStorageGrowths;
        const validBuilder = graph.createBuilder();
        const validOutput = validBuilder.createBuffer('valid after execute failure', {
            size: 4,
            usage: RHIBufferUsage.COPY_DST
        });
        validBuilder.addPass(
            {
                name: 'valid after execute failure',
                setup(pass) {
                    pass.writeBuffer(validOutput, 'copy-destination');
                },
                execute(context) {
                    void context;
                }
            },
            undefined
        );
        validBuilder.markOutput(validOutput);
        graph.execute(graph.compile(validBuilder, device.capabilities), device);
        expect(graph.storageDiagnostics).toBe(storage);
        expect(storage.executorStorageGrowths).toBe(growths);
        graph.destroy();
        backend.destroy();
    });

    it('keeps extracted WebGPU resources alive until deferred submission completion', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const source = builder.importBuffer(
            'source',
            device.createBuffer({
                size: 4,
                usage: RHIBufferUsage.COPY_SRC,
                initialData: new Uint8Array([1, 2, 3, 4])
            })
        );
        const output = builder.createBuffer('output', {
            size: 4,
            usage: RHIBufferUsage.COPY_DST
        });
        const template: RenderPassTemplate<undefined> = {
            name: 'deferred output',
            setup(pass) {
                pass.readBuffer(source, 'copy-source');
                pass.writeBuffer(output, 'copy-destination');
            },
            execute(context) {
                context.commandContext.copyBufferToBuffer(
                    context.getBuffer(source),
                    0,
                    context.getBuffer(output),
                    0,
                    4
                );
            }
        };
        builder.addPass(template, undefined);
        builder.extractBuffer(output);
        const result = graph.execute(graph.compile(builder, device.capabilities), device);
        const resource = result.getExtractedBuffer(output) as FakeRHIBuffer;
        resource.destroy();
        expect(resource.nativeReleased).toBe(false);
        backend.completeNextSubmission();
        await result.submission.done;
        expect(resource.nativeReleased).toBe(true);
        backend.destroy();
    });
});
