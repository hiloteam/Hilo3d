import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    RHIBufferUsage,
    RHITextureUsage,
    type RHI,
    type RHIBackend,
    type RHIBuffer,
    type RHICommandBuffer,
    type RHIObject,
    type RHIPipelineLayout,
    type RHIRenderPassDescriptor,
    type RHIShaderModuleDescriptor
} from '../../../src/rhi/RHI';

/**
 * Backend-specific state exposed to the shared RHI contract tests.
 *
 * Native calls intentionally stay out of this interface. Each backend test owns those assertions,
 * while the shared suite verifies behavior observable through the portable RHI surface.
 */
export interface RHIContractHarness {
    readonly rhi: RHI;
    readonly backend: RHIBackend;
    getSubmissionCount(): number;
    dispose?(): void | Promise<void>;
}

export type CreateRHIContractHarness = () => RHIContractHarness | Promise<RHIContractHarness>;

function expectUniqueObjects(objects: readonly RHIObject[]): void {
    expect(new Set(objects.map(object => object.id)).size).toBe(objects.length);
    for (const object of objects) {
        expect(Number.isSafeInteger(object.id)).toBe(true);
        expect(object.id).toBeGreaterThan(0);
        expect(typeof object.label).toBe('string');
    }
}

function createColorPass(harness: RHIContractHarness): {
    readonly texture: ReturnType<RHIContractHarness['rhi']['device']['createTexture']>;
    readonly descriptor: RHIRenderPassDescriptor;
} {
    const texture = harness.rhi.device.createTexture({
        label: 'contract color attachment',
        size: { width: 8, height: 4 },
        format: 'rgba8unorm',
        usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.TEXTURE_BINDING
    });
    return {
        texture,
        descriptor: {
            label: 'contract pass',
            colorAttachments: [
                {
                    view: texture.createView({ label: 'contract color view' }),
                    clearValue: { r: 0.125, g: 0.25, b: 0.5, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store'
                }
            ]
        }
    };
}

/** Runs the backend-neutral behavioral contract against one RHI implementation. */
export function describeRHIContract(
    name: string,
    backend: RHIBackend,
    createHarness: CreateRHIContractHarness
): void {
    describe(`${name} RHI contract`, () => {
        let harness: RHIContractHarness;

        beforeEach(async () => {
            harness = await createHarness();
            await harness.rhi.ready;
        });

        afterEach(async () => {
            harness.rhi.destroy();
            await harness.dispose?.();
        });

        it('exposes stable, backend-qualified identity for every resource', () => {
            const { rhi } = harness;
            const buffer = rhi.device.createBuffer({
                label: 'identity buffer',
                size: 32,
                usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.VERTEX
            });
            const texture = rhi.device.createTexture({
                label: 'identity texture',
                size: { width: 4, height: 2 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.TEXTURE_BINDING
            });
            const view = texture.createView({ label: 'identity view' });
            const sampler = rhi.device.createSampler({ label: 'identity sampler' });
            const module = rhi.device.createShaderModule({
                label: 'identity shader',
                code:
                    backend === 'webgpu'
                        ? '@vertex fn main() -> @builtin(position) vec4f { return vec4f(); }'
                        : '#version 300 es\nvoid main() { gl_Position = vec4(0.0); }',
                language: backend === 'webgpu' ? 'wgsl' : 'glsl',
                stage: 'vertex'
            });
            const layout = rhi.device.createBindGroupLayout({
                label: 'identity bind group layout',
                entries: []
            });
            const pipelineLayout = rhi.device.createPipelineLayout({
                label: 'identity pipeline layout',
                bindGroupLayouts: [layout]
            });
            const bindGroup = rhi.device.createBindGroup({
                label: 'identity bind group',
                layout,
                entries: []
            });

            const objects = [
                rhi,
                rhi.device,
                rhi.device.queue,
                rhi.surface,
                buffer,
                texture,
                view,
                sampler,
                module,
                layout,
                pipelineLayout,
                bindGroup
            ];
            expectUniqueObjects(objects);
            for (const object of objects) expect(object.backend).toBe(backend);
            expect(harness.backend).toBe(backend);
            expect(buffer.label).toBe('identity buffer');
            expect(texture.label).toBe('identity texture');
            expect(view.label).toBe('identity view');
            expect(module.language).toBe(backend === 'webgpu' ? 'wgsl' : 'glsl');
            expect(module.stage).toBe('vertex');
            expect(pipelineLayout.bindGroupLayouts).toEqual([layout]);
            expect(bindGroup.layout).toBe(layout);
            expect(bindGroup.entries).toEqual([]);
        });

        it('normalizes WebGPU-shaped buffer, texture, view, and sampler descriptors', () => {
            const { device } = harness.rhi;
            const buffer = device.createBuffer({
                label: 'descriptor buffer',
                size: 48,
                usage: RHIBufferUsage.COPY_SRC | RHIBufferUsage.UNIFORM
            });
            expect(buffer).toMatchObject({
                label: 'descriptor buffer',
                size: 48,
                usage: RHIBufferUsage.COPY_SRC | RHIBufferUsage.UNIFORM,
                mapState: 'unmapped'
            });

            const texture = device.createTexture({
                label: 'descriptor texture',
                size: { width: 16 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.COPY_DST | RHITextureUsage.TEXTURE_BINDING
            });
            expect(texture).toMatchObject({
                label: 'descriptor texture',
                width: 16,
                height: 1,
                depthOrArrayLayers: 1,
                mipLevelCount: 1,
                sampleCount: 1,
                dimension: '2d',
                format: 'rgba8unorm',
                usage: RHITextureUsage.COPY_DST | RHITextureUsage.TEXTURE_BINDING
            });

            const defaultView = texture.createView();
            expect(defaultView).toMatchObject({
                texture,
                format: 'rgba8unorm',
                dimension: '2d',
                aspect: 'all',
                baseMipLevel: 0,
                mipLevelCount: 1,
                baseArrayLayer: 0,
                arrayLayerCount: 1
            });

            const arrayTexture = device.createTexture({
                size: { width: 8, height: 8, depthOrArrayLayers: 6 },
                mipLevelCount: 4,
                format: 'rgba8unorm',
                usage: RHITextureUsage.TEXTURE_BINDING
            });
            expect(arrayTexture.createView()).toMatchObject({
                texture: arrayTexture,
                dimension: '2d-array',
                baseArrayLayer: 0,
                arrayLayerCount: 6
            });
            expect(
                arrayTexture.createView({ baseArrayLayer: 2, arrayLayerCount: 1 })
            ).toMatchObject({
                texture: arrayTexture,
                dimension: '2d-array',
                baseArrayLayer: 2,
                arrayLayerCount: 1
            });
            const explicitView = arrayTexture.createView({
                label: 'array mip view',
                dimension: '2d-array',
                baseMipLevel: 1,
                mipLevelCount: 2,
                baseArrayLayer: 0,
                arrayLayerCount: 6
            });
            expect(explicitView).toMatchObject({
                label: 'array mip view',
                texture: arrayTexture,
                format: 'rgba8unorm',
                dimension: '2d-array',
                aspect: 'all',
                baseMipLevel: 1,
                mipLevelCount: 2,
                baseArrayLayer: 0,
                arrayLayerCount: 6
            });
            if (backend === 'webgpu') {
                expect(
                    arrayTexture.createView({
                        dimension: 'cube',
                        baseArrayLayer: 0,
                        arrayLayerCount: 6
                    }).dimension
                ).toBe('cube');
            } else {
                expect(() =>
                    arrayTexture.createView({
                        dimension: 'cube',
                        baseArrayLayer: 0,
                        arrayLayerCount: 6
                    })
                ).toThrow();
            }

            const defaultSampler = device.createSampler();
            expect(defaultSampler.descriptor).toMatchObject({
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
                addressModeW: 'clamp-to-edge',
                magFilter: 'nearest',
                minFilter: 'nearest',
                mipmapFilter: 'nearest',
                lodMinClamp: 0,
                lodMaxClamp: 32,
                maxAnisotropy: 1
            });
            const sampler = device.createSampler({
                label: 'descriptor sampler',
                addressModeU: 'repeat',
                addressModeV: 'mirror-repeat',
                addressModeW: 'clamp-to-edge',
                magFilter: 'linear',
                minFilter: 'nearest',
                mipmapFilter: 'linear',
                lodMinClamp: 1,
                lodMaxClamp: 7,
                compare: 'less-equal',
                maxAnisotropy: 4
            });
            expect(sampler.descriptor).toEqual({
                addressModeU: 'repeat',
                addressModeV: 'mirror-repeat',
                addressModeW: 'clamp-to-edge',
                magFilter: 'linear',
                minFilter: 'nearest',
                mipmapFilter: 'linear',
                lodMinClamp: 1,
                lodMaxClamp: 7,
                compare: 'less-equal',
                maxAnisotropy: 4
            });
        });

        it('reports portable limits and rejects foreign or compute shader modules', () => {
            const { device } = harness.rhi;
            expect(device.features.has('compute-pipelines')).toBe(false);
            const rgba8Capabilities = device.getTextureFormatCapabilities('rgba8unorm');
            expect(rgba8Capabilities).toMatchObject({
                sampled: true,
                filterable: true,
                renderable: true,
                storage: backend === 'webgpu'
            });
            expect(rgba8Capabilities.sampleCounts).toContain(1);
            expect(Object.isFrozen(rgba8Capabilities)).toBe(true);
            expect(Object.isFrozen(rgba8Capabilities.sampleCounts)).toBe(true);
            for (const [limitName, value] of Object.entries(device.limits)) {
                expect(Number.isFinite(value), limitName).toBe(true);
                expect(value, limitName).toBeGreaterThanOrEqual(0);
            }
            if (backend === 'webgpu') {
                expect(device.features.has('buffer-mapping')).toBe(true);
                expect(device.features.has('texture-1d')).toBe(true);
                expect(device.features.has('draw-base-vertex')).toBe(true);
                expect(device.features.has('draw-first-instance')).toBe(true);
                expect(device.features.has('storage-buffers')).toBe(true);
                expect(device.features.has('storage-textures')).toBe(true);
                expect(device.limits.maxTextureDimension1D).toBeGreaterThan(0);
                expect(device.limits.maxStorageBuffersPerShaderStage).toBeGreaterThan(0);
                expect(device.limits.maxStorageTexturesPerShaderStage).toBeGreaterThan(0);
                expect(device.limits.maxStorageBufferBindingSize).toBeGreaterThan(0);
                expect(device.limits.minStorageBufferOffsetAlignment).toBeGreaterThan(0);
            } else {
                expect(device.features.has('buffer-mapping')).toBe(false);
                expect(device.features.has('texture-1d')).toBe(false);
                expect(device.features.has('draw-base-vertex')).toBe(false);
                expect(device.features.has('draw-first-instance')).toBe(false);
                expect(device.features.has('storage-buffers')).toBe(false);
                expect(device.features.has('storage-textures')).toBe(false);
                expect(device.limits.maxTextureDimension1D).toBe(0);
                expect(device.limits.maxStorageBuffersPerShaderStage).toBe(0);
                expect(device.limits.maxStorageTexturesPerShaderStage).toBe(0);
                expect(device.limits.maxStorageBufferBindingSize).toBe(0);
                expect(device.limits.minStorageBufferOffsetAlignment).toBe(0);
                expect(() =>
                    device.createTexture({
                        size: { width: 8 },
                        dimension: '1d',
                        format: 'rgba8unorm',
                        usage: RHITextureUsage.TEXTURE_BINDING
                    })
                ).toThrow();
                expect(() =>
                    device.createBuffer({
                        size: 16,
                        usage: RHIBufferUsage.STORAGE
                    })
                ).toThrow();
                expect(() =>
                    device.createTexture({
                        size: { width: 2, height: 2 },
                        format: 'rgba8unorm',
                        usage: RHITextureUsage.STORAGE_BINDING
                    })
                ).toThrow();
                expect(() =>
                    device.createTexture({
                        size: { width: 2, height: 2 },
                        format: 'rgba8unorm',
                        usage: RHITextureUsage.TEXTURE_BINDING,
                        viewFormats: ['rgba8unorm-srgb']
                    })
                ).toThrow();
            }

            const foreignDescriptor: RHIShaderModuleDescriptor = {
                code:
                    backend === 'webgpu'
                        ? '#version 300 es\nvoid main() { gl_Position = vec4(0.0); }'
                        : '@vertex fn main() -> @builtin(position) vec4f { return vec4f(); }',
                language: backend === 'webgpu' ? 'glsl' : 'wgsl',
                stage: 'vertex'
            };
            expect(() => device.createShaderModule(foreignDescriptor)).toThrow();
            expect(() =>
                device.createShaderModule({
                    code: '',
                    language: backend === 'webgpu' ? 'wgsl' : 'glsl',
                    stage: 'compute'
                } as unknown as RHIShaderModuleDescriptor)
            ).toThrow();
        });

        it('deduplicates only immutable device state descriptors', () => {
            const { device } = harness.rhi;
            const firstSampler = device.createSampler({
                label: 'first sampler label',
                minFilter: 'linear',
                magFilter: 'linear'
            });
            const equivalentSampler = device.createSampler({
                label: 'ignored sampler label',
                minFilter: 'linear',
                magFilter: 'linear'
            });
            expect(equivalentSampler).toBe(firstSampler);

            const firstBindGroupLayout = device.createBindGroupLayout({
                label: 'first layout label',
                entries: []
            });
            const equivalentBindGroupLayout = device.createBindGroupLayout({
                label: 'ignored layout label',
                entries: []
            });
            expect(equivalentBindGroupLayout).toBe(firstBindGroupLayout);

            const firstPipelineLayout = device.createPipelineLayout({
                label: 'first pipeline layout label',
                bindGroupLayouts: [firstBindGroupLayout]
            });
            const equivalentPipelineLayout = device.createPipelineLayout({
                label: 'ignored pipeline layout label',
                bindGroupLayouts: [equivalentBindGroupLayout]
            });
            expect(equivalentPipelineLayout).toBe(firstPipelineLayout);

            const vertex = device.createShaderModule({
                code:
                    backend === 'webgpu'
                        ? '@vertex fn main() -> @builtin(position) vec4f { return vec4f(); }'
                        : '#version 300 es\nvoid main() { gl_Position = vec4(0.0); }',
                language: backend === 'webgpu' ? 'wgsl' : 'glsl',
                stage: 'vertex'
            });
            const fragment = device.createShaderModule({
                code:
                    backend === 'webgpu'
                        ? '@fragment fn main() -> @location(0) vec4f { return vec4f(1.0); }'
                        : '#version 300 es\nprecision mediump float;\nout vec4 color;\nvoid main() { color = vec4(1.0); }',
                language: backend === 'webgpu' ? 'wgsl' : 'glsl',
                stage: 'fragment'
            });
            const duplicateVertex = device.createShaderModule({
                code:
                    backend === 'webgpu'
                        ? '@vertex fn main() -> @builtin(position) vec4f { return vec4f(); }'
                        : '#version 300 es\nvoid main() { gl_Position = vec4(0.0); }',
                language: backend === 'webgpu' ? 'wgsl' : 'glsl',
                stage: 'vertex'
            });
            const pipelineDescriptor = {
                layout: firstPipelineLayout,
                vertex: { module: vertex, entryPoint: 'main' },
                primitive: { topology: 'triangle-list' as const },
                fragment: {
                    module: fragment,
                    entryPoint: 'main',
                    targets: [{ format: 'rgba8unorm' as const }]
                }
            };
            const firstPipeline = device.createRenderPipeline({
                label: 'first pipeline label',
                ...pipelineDescriptor
            });
            const equivalentPipeline = device.createRenderPipeline({
                label: 'ignored pipeline label',
                ...pipelineDescriptor
            });
            expect(equivalentPipeline).toBe(firstPipeline);
            expect(() =>
                device.createRenderPipeline({
                    ...pipelineDescriptor,
                    layout: 'auto' as unknown as RHIPipelineLayout
                })
            ).toThrow();

            const firstBuffer = device.createBuffer({
                size: 16,
                usage: RHIBufferUsage.VERTEX
            });
            const secondBuffer = device.createBuffer({
                size: 16,
                usage: RHIBufferUsage.VERTEX
            });
            const firstTexture = device.createTexture({
                size: { width: 2, height: 2 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.TEXTURE_BINDING
            });
            const secondTexture = device.createTexture({
                size: { width: 2, height: 2 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.TEXTURE_BINDING
            });
            const firstBindGroup = device.createBindGroup({
                layout: firstBindGroupLayout,
                entries: []
            });
            const secondBindGroup = device.createBindGroup({
                layout: firstBindGroupLayout,
                entries: []
            });
            expect(secondBuffer).not.toBe(firstBuffer);
            expect(secondTexture).not.toBe(firstTexture);
            expect(secondBindGroup).not.toBe(firstBindGroup);
            expect(duplicateVertex).not.toBe(vertex);
        });

        it('makes resource destruction idempotent and rejects use after destroy', () => {
            const buffer = harness.rhi.device.createBuffer({
                label: 'destroyed buffer',
                size: 16,
                usage: RHIBufferUsage.COPY_DST
            });
            buffer.destroy();
            expect(buffer.destroyed).toBe(true);
            expect(() => {
                buffer.destroy();
            }).not.toThrow();
            expect(buffer.destroyed).toBe(true);
            expect(() => buffer.getMappedRange()).toThrow();

            const texture = harness.rhi.device.createTexture({
                size: { width: 2, height: 2 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.TEXTURE_BINDING
            });
            texture.destroy();
            texture.destroy();
            expect(texture.destroyed).toBe(true);
            expect(() => texture.createView()).toThrow();
        });

        it('exposes asynchronous buffer mapping only when the backend advertises it', async () => {
            if (backend === 'webgpu') {
                const buffer = harness.rhi.device.createBuffer({
                    label: 'mapped buffer',
                    size: 16,
                    usage: RHIBufferUsage.MAP_WRITE | RHIBufferUsage.COPY_SRC,
                    mappedAtCreation: true
                });
                expect(buffer.mapState).toBe('mapped');
                const initialRange = buffer.getMappedRange();
                expect(initialRange.byteLength).toBe(16);
                new Uint8Array(initialRange).set([1, 2, 3, 4]);
                buffer.unmap();
                expect(buffer.mapState).toBe('unmapped');
                await buffer.mapAsync('write', 8, 8);
                expect(buffer.mapState).toBe('mapped');
                expect(buffer.getMappedRange(8, 8).byteLength).toBe(8);
                buffer.unmap();
                return;
            }

            let unsupportedBuffer: RHIBuffer;
            try {
                unsupportedBuffer = harness.rhi.device.createBuffer({
                    size: 16,
                    usage: RHIBufferUsage.MAP_WRITE | RHIBufferUsage.COPY_SRC
                });
            } catch {
                return;
            }
            await expect(
                Promise.resolve().then(() => unsupportedBuffer.mapAsync('write'))
            ).rejects.toThrow();
        });

        it('enforces one active pass and one finish transition per command encoder', () => {
            const { texture, descriptor } = createColorPass(harness);
            const encoder = harness.rhi.device.createCommandEncoder({ label: 'contract encoder' });
            const pass = encoder.beginRenderPass(descriptor);

            expect(pass.label).toBe('contract pass');
            expect(() => encoder.beginRenderPass(descriptor)).toThrow();
            expect(() => encoder.finish()).toThrow();

            pass.setViewport(0, 0, texture.width, texture.height, 0, 1);
            pass.setScissorRect(0, 0, texture.width, texture.height);
            pass.setBlendConstant({ r: 1, g: 0.5, b: 0.25, a: 1 });
            pass.setStencilReference(3);
            pass.end();

            expect(() => {
                pass.setViewport(0, 0, 1, 1, 0, 1);
            }).toThrow();
            expect(() => {
                pass.end();
            }).toThrow();

            const commandBuffer = encoder.finish();
            expect(commandBuffer.backend).toBe(backend);
            expect(() => encoder.finish()).toThrow();
            expect(() => encoder.beginRenderPass(descriptor)).toThrow();
        });

        it('crosses the execution boundary only when a finished command buffer is submitted', () => {
            const encoder = harness.rhi.device.createCommandEncoder({ label: 'submit encoder' });
            const commandBuffer: RHICommandBuffer = encoder.finish();
            const before = harness.getSubmissionCount();

            harness.rhi.device.queue.submit([commandBuffer]);

            expect(harness.getSubmissionCount()).toBe(before + 1);
            expect(() => {
                harness.rhi.device.queue.submit([]);
            }).not.toThrow();
            expect(harness.getSubmissionCount()).toBe(before + 2);
        });

        it('propagates destruction through the top-level RHI exactly once', () => {
            expect(harness.rhi.isReady).toBe(true);
            harness.rhi.destroy();
            expect(harness.rhi.destroyed).toBe(true);
            expect(harness.rhi.device.destroyed).toBe(true);
            expect(harness.rhi.surface.destroyed).toBe(true);
            expect(harness.rhi.isReady).toBe(false);
            expect(() => {
                harness.rhi.destroy();
            }).not.toThrow();
        });
    });
}
