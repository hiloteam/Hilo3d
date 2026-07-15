import { describe, expect, it, vi } from 'vitest';
import {
    RHIBufferUsage,
    RHITextureUsage,
    type RHIBindGroup,
    type RHIBindGroupLayout,
    type RHIBuffer,
    type RHISampler,
    type RHIShaderBindingKind,
    type RHIShaderBindingReflection,
    type RHITexture,
    type RHITextureFormat,
    type RHITextureView
} from '../../../src/render/rhi/core';
import {
    ResourceRegistry,
    type ResourceRegistryHandle
} from '../../../src/render/renderer/ResourceRegistry';
import {
    ShaderBindGroupResourceCache,
    type ShaderSampledBindingResources
} from '../../../src/render/renderer/ShaderBindGroupResourceCache';
import {
    compileShaderBindingLayout,
    type ShaderBindingLayoutPlan
} from '../../../src/render/renderer/ShaderBindingLayoutCompiler';
import { FakeWebGLRHIBackend, type FakeRHIDevice } from '../rhi/v2/FakeRHIBackend';

const cacheSource =
    Object.values(
        import.meta.glob<string>('../../../src/render/renderer/ShaderBindGroupResourceCache.ts', {
            eager: true,
            query: '?raw',
            import: 'default'
        })
    )[0] ?? '';

function binding(
    kind: RHIShaderBindingKind,
    name: string,
    group: number,
    bindingIndex: number
): RHIShaderBindingReflection {
    return { group, binding: bindingIndex, kind, name };
}

function uniform(name: string, group: number, bindingIndex: number): RHIShaderBindingReflection {
    return binding('uniform-buffer', name, group, bindingIndex);
}

function sampled(
    name: string,
    group: number,
    textureBinding: number,
    samplerBinding: number,
    samplerKind: 'sampler' | 'comparison-sampler' = 'sampler'
): readonly RHIShaderBindingReflection[] {
    return [
        binding('sampled-texture', name, group, textureBinding),
        binding(samplerKind, name, group, samplerBinding)
    ];
}

function bindingPlan(
    vertex: readonly RHIShaderBindingReflection[] = [],
    fragment: readonly RHIShaderBindingReflection[] = []
): Readonly<ShaderBindingLayoutPlan> {
    return compileShaderBindingLayout(
        {
            vertex: { bindings: vertex },
            fragment: { bindings: fragment }
        },
        4
    );
}

function registerLayouts(
    registry: ResourceRegistry,
    plan: Readonly<ShaderBindingLayoutPlan>
): readonly ResourceRegistryHandle<RHIBindGroupLayout>[] {
    return plan.bindGroupLayoutDescriptors.map((descriptor, group) =>
        registry.register<RHIBindGroupLayout>({
            label: `test shader bind-group layout ${String(group)}`,
            create: device => device.createBindGroupLayout(descriptor)
        })
    );
}

function registerUniformBuffer(
    registry: ResourceRegistry,
    label: string
): ResourceRegistryHandle<RHIBuffer> {
    return registry.registerBuffer({
        label,
        lifetime: 'persistent',
        size: 64,
        usage: RHIBufferUsage.UNIFORM
    });
}

interface RegisteredTextureView {
    readonly texture: ResourceRegistryHandle<RHITexture>;
    readonly view: ResourceRegistryHandle<RHITextureView>;
}

function registerTextureView(
    registry: ResourceRegistry,
    label: string,
    format: RHITextureFormat = 'rgba8unorm'
): RegisteredTextureView {
    const texture = registry.registerTexture({
        label: `${label} texture`,
        lifetime: 'persistent',
        size: { width: 4, height: 4 },
        format,
        usage: RHITextureUsage.TEXTURE_BINDING
    });
    const view = registry.register<RHITextureView>({
        label: `${label} view`,
        dependencies: [texture],
        create(_device, resolve) {
            return resolve(texture).createView({ label: `${label} view` });
        }
    });
    return { texture, view };
}

function registerSampler(
    registry: ResourceRegistry,
    label: string,
    comparison = false
): ResourceRegistryHandle<RHISampler> {
    return registry.registerSampler({
        label,
        lifetime: 'persistent',
        ...(comparison ? { compare: 'less-equal' as const } : { magFilter: 'linear' as const })
    });
}

function requireAt<T>(values: readonly T[], index: number): T {
    const value = values[index];
    if (value === undefined) throw new Error(`Test array has no value at ${String(index)}`);
    return value;
}

function requireGroup(group: RHIBindGroup | null): RHIBindGroup {
    if (group === null) throw new Error('Test expected an active shader bind group');
    return group;
}

function boundBuffer(group: RHIBindGroup, bindingIndex: number): RHIBuffer {
    const resource = group.entries.find(entry => entry.binding === bindingIndex)?.resource;
    if (resource === undefined || !('buffer' in resource)) {
        throw new Error(`Test bind group has no buffer at binding ${String(bindingIndex)}`);
    }
    return resource.buffer;
}

function boundTextureView(group: RHIBindGroup, bindingIndex: number): RHITextureView {
    const resource = group.entries.find(entry => entry.binding === bindingIndex)?.resource;
    if (resource === undefined || !('texture' in resource)) {
        throw new Error(`Test bind group has no texture view at binding ${String(bindingIndex)}`);
    }
    return resource;
}

function boundSampler(group: RHIBindGroup, bindingIndex: number): RHISampler {
    const resource = group.entries.find(entry => entry.binding === bindingIndex)?.resource;
    if (resource === undefined || 'buffer' in resource || 'texture' in resource) {
        throw new Error(`Test bind group has no sampler at binding ${String(bindingIndex)}`);
    }
    return resource;
}

describe('ShaderBindGroupResourceCache', () => {
    it('creates sorted mixed and sparse groups and hits before reading a poisoned plan', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const createBindGroup = vi.spyOn(device, 'createBindGroup');
        const registry = new ResourceRegistry(device);
        const cache = new ShaderBindGroupResourceCache(registry);
        const plan = bindingPlan(
            [uniform('FrameBlock', 0, 5)],
            [
                ...sampled('baseColor', 2, 6, 1),
                ...sampled('shadowMap', 2, 7, 3, 'comparison-sampler')
            ]
        );
        const layouts = registerLayouts(registry, plan);
        const frame = registerUniformBuffer(registry, 'frame uniform');
        const color = registerTextureView(registry, 'color');
        const shadow = registerTextureView(registry, 'shadow', 'depth24plus');
        const colorSampler = registerSampler(registry, 'color sampler');
        const shadowSampler = registerSampler(registry, 'shadow sampler', true);
        const sampledResources: readonly ShaderSampledBindingResources[] = [
            { textureView: color.view, sampler: colorSampler },
            { textureView: shadow.view, sampler: shadowSampler }
        ];
        const owner = {};

        const handles = cache.prepare(owner, 17, plan, layouts, [frame], sampledResources);

        expect(handles).toMatchObject({ token: 1, layoutToken: 17, activeGroupIndices: [0, 2] });
        expect(handles.groupHandles).toHaveLength(3);
        expect(handles.groupHandles[1]).toBeNull();
        expect(Object.isFrozen(handles)).toBe(true);
        expect(Object.isFrozen(handles.groupHandles)).toBe(true);
        expect(Object.isFrozen(handles.activeGroupIndices)).toBe(true);
        expect(cache.resolveGroup(owner, 1)).toBeNull();

        const group0 = requireGroup(cache.resolveGroup(owner, 0));
        const group2 = requireGroup(cache.resolveGroup(owner, 2));
        expect(boundBuffer(group0, 5)).toBe(registry.resolve(frame));
        expect(group2.entries.map(entry => entry.binding)).toEqual([1, 3, 6, 7]);
        expect(boundSampler(group2, 1)).toBe(registry.resolve(colorSampler));
        expect(boundSampler(group2, 3)).toBe(registry.resolve(shadowSampler));
        expect(boundTextureView(group2, 6)).toBe(registry.resolve(color.view));
        expect(boundTextureView(group2, 7)).toBe(registry.resolve(shadow.view));
        expect(createBindGroup).toHaveBeenCalledTimes(2);

        const poisonedPlan: ShaderBindingLayoutPlan = {
            get bindGroupLayoutDescriptors(): never {
                throw new Error('cache hit read bindGroupLayoutDescriptors');
            },
            get activeGroupIndices(): never {
                throw new Error('cache hit read activeGroupIndices');
            },
            get uniformBlocks(): never {
                throw new Error('cache hit read uniformBlocks');
            },
            get sampledBindings(): never {
                throw new Error('cache hit read sampledBindings');
            },
            getUniformBlockBinding(): undefined {
                return undefined;
            },
            getSampledBinding(): undefined {
                return undefined;
            }
        };
        expect(
            cache.prepare(
                owner,
                17,
                poisonedPlan,
                layouts,
                [frame],
                [
                    { textureView: color.view, sampler: colorSampler },
                    { textureView: shadow.view, sampler: shadowSampler }
                ]
            )
        ).toBe(handles);
        expect(cache.resolveGroup(owner, 2)).toBe(group2);
        expect(createBindGroup).toHaveBeenCalledTimes(2);
        expect(cache.metrics).toMatchObject({
            hits: 1,
            misses: 1,
            evictions: 0,
            size: 1,
            highWater: 1
        });

        cache.destroy();
        expect(cache.metrics).toMatchObject({ evictions: 1, size: 0, highWater: 1 });
        registry.destroy();
        backend.destroy();
    });

    it('keeps exact handle identity hits ahead of allocation-heavy miss validation in source', () => {
        const prepareStart = cacheSource.indexOf('    prepare(');
        const identityHit = cacheSource.indexOf('current?.layoutToken', prepareStart);
        const missValidation = cacheSource.indexOf('this.validateShape(', prepareStart);

        expect(prepareStart).toBeGreaterThanOrEqual(0);
        expect(identityHit).toBeGreaterThan(prepareStart);
        expect(missValidation).toBeGreaterThan(identityHit);
    });

    it('misses on every upstream logical identity and keeps tokens monotonic', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const createBindGroup = vi.spyOn(device, 'createBindGroup');
        const registry = new ResourceRegistry(device);
        const cache = new ShaderBindGroupResourceCache(registry);
        const plan = bindingPlan([uniform('MaterialBlock', 0, 0)], sampled('baseColor', 0, 1, 2));
        const layouts = registerLayouts(registry, plan);
        const firstBuffer = registerUniformBuffer(registry, 'first material uniform');
        const firstTexture = registerTextureView(registry, 'first color');
        const firstSampler = registerSampler(registry, 'first sampler');
        const owner = {};
        const resources = [{ textureView: firstTexture.view, sampler: firstSampler }];

        const first = cache.prepare(owner, 1, plan, layouts, [firstBuffer], resources);
        expect(cache.prepare(owner, 1, plan, layouts, [firstBuffer], resources)).toBe(first);

        const secondBuffer = registerUniformBuffer(registry, 'second material uniform');
        const bufferMiss = cache.prepare(owner, 1, plan, layouts, [secondBuffer], resources);
        expect(bufferMiss.token).toBeGreaterThan(first.token);

        const secondTexture = registerTextureView(registry, 'second color');
        const textureMiss = cache.prepare(
            owner,
            1,
            plan,
            layouts,
            [secondBuffer],
            [{ textureView: secondTexture.view, sampler: firstSampler }]
        );
        expect(textureMiss.token).toBeGreaterThan(bufferMiss.token);

        const secondSampler = registerSampler(registry, 'second sampler');
        const samplerMiss = cache.prepare(
            owner,
            1,
            plan,
            layouts,
            [secondBuffer],
            [{ textureView: secondTexture.view, sampler: secondSampler }]
        );
        expect(samplerMiss.token).toBeGreaterThan(textureMiss.token);

        const tokenMiss = cache.prepare(
            owner,
            2,
            plan,
            layouts,
            [secondBuffer],
            [{ textureView: secondTexture.view, sampler: secondSampler }]
        );
        expect(tokenMiss.token).toBeGreaterThan(samplerMiss.token);

        const replacementLayouts = registerLayouts(registry, plan);
        const layoutMiss = cache.prepare(
            owner,
            2,
            plan,
            replacementLayouts,
            [secondBuffer],
            [{ textureView: secondTexture.view, sampler: secondSampler }]
        );
        expect(layoutMiss.token).toBeGreaterThan(tokenMiss.token);
        const resolved = requireGroup(cache.resolveGroup(owner, 0));
        expect(resolved.layout).toBe(registry.resolve(requireAt(replacementLayouts, 0)));
        expect(boundBuffer(resolved, 0)).toBe(registry.resolve(secondBuffer));
        expect(boundTextureView(resolved, 1)).toBe(registry.resolve(secondTexture.view));
        expect(boundSampler(resolved, 2)).toBe(registry.resolve(secondSampler));
        expect(createBindGroup).toHaveBeenCalledTimes(6);

        cache.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('rebuilds mixed bind groups from logical dependencies on same-backend recovery', () => {
        const backend = new FakeWebGLRHIBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const cache = new ShaderBindGroupResourceCache(registry);
        const plan = bindingPlan(
            [uniform('CameraBlock', 0, 0)],
            sampled('shadowMap', 0, 2, 1, 'comparison-sampler')
        );
        const layouts = registerLayouts(registry, plan);
        const camera = registerUniformBuffer(registry, 'camera uniform');
        const shadow = registerTextureView(registry, 'shadow', 'depth24plus');
        const sampler = registerSampler(registry, 'shadow sampler', true);
        const resources = [{ textureView: shadow.view, sampler }];
        const owner = {};
        const handles = cache.prepare(owner, 3, plan, layouts, [camera], resources);
        const firstGroup = requireGroup(cache.resolveGroup(owner, 0));
        const firstLayout = registry.resolve(requireAt(layouts, 0));
        const firstBuffer = registry.resolve(camera);
        const firstView = registry.resolve(shadow.view);
        const firstSampler = registry.resolve(sampler);

        const secondDevice = backend.createDevice();
        const createBindGroup = vi.spyOn(secondDevice, 'createBindGroup');
        registry.recover(secondDevice);
        const recovered = requireGroup(cache.resolveGroup(owner, 0));

        expect(cache.metrics).toMatchObject({
            hits: 0,
            misses: 1,
            evictions: 0,
            size: 1,
            highWater: 1
        });

        expect(recovered).not.toBe(firstGroup);
        expect(recovered.deviceId).toBe(secondDevice.id);
        expect(recovered.layout).toBe(registry.resolve(requireAt(layouts, 0)));
        expect(boundBuffer(recovered, 0)).toBe(registry.resolve(camera));
        expect(boundSampler(recovered, 1)).toBe(registry.resolve(sampler));
        expect(boundTextureView(recovered, 2)).toBe(registry.resolve(shadow.view));
        expect(createBindGroup).toHaveBeenCalledTimes(1);
        expect(cache.prepare(owner, 3, plan, layouts, [camera], resources)).toBe(handles);
        expect(cache.metrics.hits).toBe(1);
        expect(firstGroup.destroyed).toBe(true);
        expect(firstLayout.destroyed).toBe(true);
        expect(firstBuffer.destroyed).toBe(true);
        expect(firstView.destroyed).toBe(true);
        expect(firstSampler.destroyed).toBe(true);

        cache.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('atomically discards a partial replacement and preserves the previous owner record', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const originalCreateBindGroup = device.createBindGroup.bind(device);
        const createBindGroup = vi.spyOn(device, 'createBindGroup');
        const registry = new ResourceRegistry(device);
        const cache = new ShaderBindGroupResourceCache(registry);
        const plan = bindingPlan([uniform('FrameBlock', 0, 0)], sampled('baseColor', 2, 0, 1));
        const layouts = registerLayouts(registry, plan);
        const frame = registerUniformBuffer(registry, 'frame uniform');
        const firstTexture = registerTextureView(registry, 'first color');
        const replacementTexture = registerTextureView(registry, 'replacement color');
        const sampler = registerSampler(registry, 'color sampler');
        const owner = {};
        const first = cache.prepare(
            owner,
            1,
            plan,
            layouts,
            [frame],
            [{ textureView: firstTexture.view, sampler }]
        );
        const firstGroup0 = requireGroup(cache.resolveGroup(owner, 0));
        const firstGroup2 = requireGroup(cache.resolveGroup(owner, 2));
        const trackedBeforeFailure = registry.diagnostics().trackedResourceCount;
        let partialGroup: RHIBindGroup | undefined;
        createBindGroup
            .mockImplementationOnce(descriptor => {
                partialGroup = originalCreateBindGroup(descriptor);
                return partialGroup;
            })
            .mockImplementationOnce(() => {
                throw new Error('injected shader bind-group creation failure');
            });

        expect(() =>
            cache.prepare(
                owner,
                1,
                plan,
                layouts,
                [frame],
                [{ textureView: replacementTexture.view, sampler }]
            )
        ).toThrow('injected shader bind-group creation failure');

        expect(cache.resolveGroup(owner, 0)).toBe(firstGroup0);
        expect(cache.resolveGroup(owner, 2)).toBe(firstGroup2);
        expect(first.groupHandles[0]).toBeDefined();
        expect(partialGroup?.destroyed).toBe(true);
        expect(registry.diagnostics()).toMatchObject({
            trackedResourceCount: trackedBeforeFailure,
            pendingReleaseCount: 0
        });
        expect(firstGroup0.destroyed).toBe(false);
        expect(firstGroup2.destroyed).toBe(false);

        const retry = cache.prepare(
            owner,
            1,
            plan,
            layouts,
            [frame],
            [{ textureView: replacementTexture.view, sampler }]
        );
        expect(retry.token).toBeGreaterThan(first.token);
        expect(cache.resolveGroup(owner, 2)).not.toBe(firstGroup2);

        cache.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('marks dependency lifetimes, detaches, destroys idempotently, and accepts an empty plan', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new ShaderBindGroupResourceCache(registry);
        const plan = bindingPlan([], sampled('baseColor', 0, 0, 1));
        const layouts = registerLayouts(registry, plan);
        const texture = registerTextureView(registry, 'color');
        const sampler = registerSampler(registry, 'color sampler');
        const owner = {};
        cache.prepare(owner, 1, plan, layouts, [], [{ textureView: texture.view, sampler }]);
        const group = requireGroup(cache.resolveGroup(owner, 0));
        const layout = registry.resolve(requireAt(layouts, 0));
        const nativeTexture = registry.resolve(texture.texture);
        const view = registry.resolve(texture.view);
        const nativeSampler = registry.resolve(sampler);

        cache.markUsed(owner, 5);
        registry.release(requireAt(layouts, 0));
        registry.release(texture.texture);
        registry.release(texture.view);
        registry.release(sampler);
        expect(cache.detach(owner)).toBe(true);
        expect(cache.detach(owner)).toBe(false);
        expect(() => cache.resolveGroup(owner, 0)).toThrow(/not prepared/);
        expect(registry.collect(4)).toBe(0);
        expect(registry.collect(5)).toBe(5);
        expect(group.destroyed).toBe(true);
        expect(layout.destroyed).toBe(true);
        expect(nativeTexture.destroyed).toBe(true);
        expect(view.destroyed).toBe(true);
        expect(nativeSampler.destroyed).toBe(true);

        const emptyPlan = bindingPlan();
        const emptyOwner = {};
        const empty = cache.prepare(emptyOwner, 2, emptyPlan, [], [], []);
        expect(empty.groupHandles).toEqual([]);
        expect(empty.activeGroupIndices).toEqual([]);
        expect(cache.prepare(emptyOwner, 2, emptyPlan, [], [], [])).toBe(empty);
        cache.markUsed(emptyOwner, 6);

        cache.destroy();
        cache.destroy();
        expect(() => cache.prepare(emptyOwner, 2, emptyPlan, [], [], [])).toThrow(
            /resource cache is destroyed/
        );
        expect(() => {
            cache.markUsed(emptyOwner, 7);
        }).toThrow(/resource cache is destroyed/);

        registry.destroy();
        backend.destroy();
    });

    it('validates complete plan shape and every registry handle before creating groups', () => {
        const backend = new FakeWebGLRHIBackend();
        const device: FakeRHIDevice = backend.createDevice();
        const createBindGroup = vi.spyOn(device, 'createBindGroup');
        const registry = new ResourceRegistry(device);
        const cache = new ShaderBindGroupResourceCache(registry);
        const plan = bindingPlan([uniform('FrameBlock', 0, 0)], sampled('baseColor', 0, 1, 2));
        const layouts = registerLayouts(registry, plan);
        const buffer = registerUniformBuffer(registry, 'frame uniform');
        const texture = registerTextureView(registry, 'color');
        const sampler = registerSampler(registry, 'color sampler');
        const resources = [{ textureView: texture.view, sampler }];

        expect(() => cache.prepare({}, 1, plan, [], [buffer], resources)).toThrow(
            /layout handles must match/
        );
        expect(() => cache.prepare({}, 1, plan, layouts, [], resources)).toThrow(
            /Uniform buffer handles must match/
        );
        expect(() => cache.prepare({}, 1, plan, layouts, [buffer], [])).toThrow(
            /Sampled resources must match/
        );

        const duplicateBuffer = registerUniformBuffer(registry, 'duplicate uniform');
        const duplicatedPlan: ShaderBindingLayoutPlan = {
            ...plan,
            uniformBlocks: Object.freeze([
                ...plan.uniformBlocks,
                Object.freeze({ ...requireAt(plan.uniformBlocks, 0) })
            ])
        };
        expect(() =>
            cache.prepare({}, 1, duplicatedPlan, layouts, [buffer, duplicateBuffer], resources)
        ).toThrow(/duplicate binding 0/);

        const foreignRegistry = new ResourceRegistry(backend.createDevice());
        const foreignSampler = registerSampler(foreignRegistry, 'foreign sampler');
        expect(() =>
            cache.prepare(
                {},
                1,
                plan,
                layouts,
                [buffer],
                [{ textureView: texture.view, sampler: foreignSampler }]
            )
        ).toThrow(/another registry/);
        expect(createBindGroup).not.toHaveBeenCalled();

        cache.destroy();
        registry.destroy();
        foreignRegistry.destroy();
        backend.destroy();
    });
});
