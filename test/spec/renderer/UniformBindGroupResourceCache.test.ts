import { describe, expect, it, vi } from 'vitest';
import {
    RHIBufferUsage,
    type RHIBindGroup,
    type RHIBindGroupLayout,
    type RHIBuffer
} from '../../../src/render/rhi/core';
import {
    ResourceRegistry,
    type ResourceRegistryHandle
} from '../../../src/render/renderer/ResourceRegistry';
import {
    compileShaderBindingLayout,
    type ShaderBindingLayoutPlan
} from '../../../src/render/renderer/ShaderBindingLayoutCompiler';
import { UniformBindGroupResourceCache } from '../../../src/render/renderer/UniformBindGroupResourceCache';
import { FakeWebGLRHIBackend, type FakeRHIDevice } from '../rhi/portable/FakeRHIBackend';

const cacheSource =
    Object.values(
        import.meta.glob<string>('../../../src/render/renderer/UniformBindGroupResourceCache.ts', {
            eager: true,
            query: '?raw',
            import: 'default'
        })
    )[0] ?? '';

interface UniformBlockLocation {
    readonly name: string;
    readonly group: number;
    readonly binding: number;
    readonly stage?: 'vertex' | 'fragment' | 'both';
}

function bindingPlan(blocks: readonly UniformBlockLocation[]): Readonly<ShaderBindingLayoutPlan> {
    const vertex = blocks
        .filter(block => block.stage !== 'fragment')
        .map(block => ({
            group: block.group,
            binding: block.binding,
            kind: 'uniform-buffer' as const,
            name: block.name
        }));
    const fragment = blocks
        .filter(block => block.stage === 'fragment' || block.stage === 'both')
        .map(block => ({
            group: block.group,
            binding: block.binding,
            kind: 'uniform-buffer' as const,
            name: block.name
        }));
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
            label: `test bind group layout ${String(group)}`,
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

function boundBuffer(group: RHIBindGroup, binding: number): RHIBuffer {
    const entry = group.entries.find(candidate => candidate.binding === binding);
    if (entry === undefined || !('buffer' in entry.resource)) {
        throw new Error(`Test bind group has no buffer at binding ${String(binding)}`);
    }
    return entry.resource.buffer;
}

function requireGroup(group: RHIBindGroup | null): RHIBindGroup {
    if (group === null) throw new Error('Test expected an active uniform bind group');
    return group;
}

function requireAt<T>(values: readonly T[], index: number): T {
    const value = values[index];
    if (value === undefined) throw new Error(`Test array has no value at ${String(index)}`);
    return value;
}

describe('UniformBindGroupResourceCache', () => {
    it('creates sparse continuous groups and hits on exact logical identity', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const createBindGroup = vi.spyOn(device, 'createBindGroup');
        const registry = new ResourceRegistry(device);
        const cache = new UniformBindGroupResourceCache(registry);
        const plan = bindingPlan([
            { name: 'CustomBlock', group: 3, binding: 2, stage: 'fragment' }
        ]);
        const layouts = registerLayouts(registry, plan);
        const buffer = registerUniformBuffer(registry, 'custom uniform');
        const owner = {};

        const handles = cache.prepare(owner, 7, plan, layouts, [buffer]);

        expect(handles).toMatchObject({ token: 1, layoutToken: 7, activeGroupIndices: [3] });
        expect(handles.groupHandles).toHaveLength(4);
        expect(handles.groupHandles.slice(0, 3)).toEqual([null, null, null]);
        expect(handles.groupHandles[3]).not.toBeNull();
        expect(Object.isFrozen(handles)).toBe(true);
        expect(Object.isFrozen(handles.groupHandles)).toBe(true);
        expect(Object.isFrozen(handles.activeGroupIndices)).toBe(true);

        expect(cache.resolveGroup(owner, 0)).toBeNull();
        const resolved = cache.resolveGroup(owner, 3);
        expect(resolved?.layout).toBe(registry.resolve(requireAt(layouts, 3)));
        expect(resolved && boundBuffer(resolved, 2)).toBe(registry.resolve(buffer));
        expect(createBindGroup).toHaveBeenCalledTimes(1);

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
        expect(cache.prepare(owner, 7, poisonedPlan, layouts, [buffer])).toBe(handles);
        expect(cache.resolveGroup(owner, 3)).toBe(resolved);
        expect(createBindGroup).toHaveBeenCalledTimes(1);

        cache.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('keeps exact identity hits ahead of allocation-heavy miss validation in source', () => {
        const prepareStart = cacheSource.indexOf('    prepare(');
        const identityHit = cacheSource.indexOf('current?.layoutToken', prepareStart);
        const missValidation = cacheSource.indexOf('this.validateShape(', prepareStart);

        expect(prepareStart).toBeGreaterThanOrEqual(0);
        expect(identityHit).toBeGreaterThan(prepareStart);
        expect(missValidation).toBeGreaterThan(identityHit);
    });

    it('misses on buffer, layout token, and layout handle identity changes', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const createBindGroup = vi.spyOn(device, 'createBindGroup');
        const registry = new ResourceRegistry(device);
        const cache = new UniformBindGroupResourceCache(registry);
        const plan = bindingPlan([{ name: 'MaterialBlock', group: 0, binding: 0 }]);
        const layouts = registerLayouts(registry, plan);
        const firstBuffer = registerUniformBuffer(registry, 'first material uniform');
        const owner = {};

        const first = cache.prepare(owner, 10, plan, layouts, [firstBuffer]);
        const firstGroup = requireGroup(cache.resolveGroup(owner, 0));
        expect(cache.prepare(owner, 10, plan, layouts, [firstBuffer])).toBe(first);

        const secondBuffer = registerUniformBuffer(registry, 'second material uniform');
        const bufferMiss = cache.prepare(owner, 10, plan, layouts, [secondBuffer]);
        const bufferMissGroup = requireGroup(cache.resolveGroup(owner, 0));
        expect(bufferMiss.token).toBeGreaterThan(first.token);
        expect(bufferMiss.groupHandles[0]).not.toBe(first.groupHandles[0]);
        expect(boundBuffer(bufferMissGroup, 0)).toBe(registry.resolve(secondBuffer));

        const tokenMiss = cache.prepare(owner, 11, plan, layouts, [secondBuffer]);
        const tokenMissGroup = requireGroup(cache.resolveGroup(owner, 0));
        expect(tokenMiss.token).toBeGreaterThan(bufferMiss.token);
        expect(tokenMiss.groupHandles[0]).not.toBe(bufferMiss.groupHandles[0]);

        const replacementLayouts = registerLayouts(registry, plan);
        const layoutHandleMiss = cache.prepare(owner, 11, plan, replacementLayouts, [secondBuffer]);
        expect(layoutHandleMiss.token).toBeGreaterThan(tokenMiss.token);
        expect(layoutHandleMiss.groupHandles[0]).not.toBe(tokenMiss.groupHandles[0]);
        expect(cache.resolveGroup(owner, 0)?.layout).toBe(
            registry.resolve(requireAt(replacementLayouts, 0))
        );
        expect(createBindGroup).toHaveBeenCalledTimes(4);
        expect(registry.diagnostics().pendingReleaseCount).toBe(3);

        expect(registry.collect(0)).toBe(3);
        expect(firstGroup.destroyed).toBe(true);
        expect(bufferMissGroup.destroyed).toBe(true);
        expect(tokenMissGroup.destroyed).toBe(true);
        expect(cache.resolveGroup(owner, 0)?.destroyed).toBe(false);

        cache.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('rebuilds bind groups through logical layout and buffer dependencies on recovery', () => {
        const backend = new FakeWebGLRHIBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const cache = new UniformBindGroupResourceCache(registry);
        const plan = bindingPlan([{ name: 'CameraBlock', group: 0, binding: 1, stage: 'both' }]);
        const layouts = registerLayouts(registry, plan);
        const buffer = registerUniformBuffer(registry, 'camera uniform');
        const owner = {};
        const handles = cache.prepare(owner, 3, plan, layouts, [buffer]);
        const firstGroup = requireGroup(cache.resolveGroup(owner, 0));
        const firstLayout = registry.resolve(requireAt(layouts, 0));
        const firstBuffer = registry.resolve(buffer);

        const secondDevice = backend.createDevice();
        const createBindGroup = vi.spyOn(secondDevice, 'createBindGroup');
        registry.recover(secondDevice);
        const recovered = requireGroup(cache.resolveGroup(owner, 0));

        expect(recovered).not.toBe(firstGroup);
        expect(recovered.deviceId).toBe(secondDevice.id);
        expect(recovered.layout).toBe(registry.resolve(requireAt(layouts, 0)));
        expect(boundBuffer(recovered, 1)).toBe(registry.resolve(buffer));
        expect(createBindGroup).toHaveBeenCalledTimes(1);
        expect(cache.prepare(owner, 3, plan, layouts, [buffer])).toBe(handles);
        expect(firstGroup.destroyed).toBe(true);
        expect(firstLayout.destroyed).toBe(true);
        expect(firstBuffer.destroyed).toBe(true);

        cache.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('rolls back partially registered replacement groups and preserves the old record', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const originalCreateBindGroup = device.createBindGroup.bind(device);
        const createBindGroup = vi.spyOn(device, 'createBindGroup');
        const registry = new ResourceRegistry(device);
        const cache = new UniformBindGroupResourceCache(registry);
        const plan = bindingPlan([
            { name: 'CameraBlock', group: 0, binding: 0 },
            { name: 'MaterialBlock', group: 1, binding: 0 }
        ]);
        const layouts = registerLayouts(registry, plan);
        const camera = registerUniformBuffer(registry, 'camera uniform');
        const firstMaterial = registerUniformBuffer(registry, 'first material uniform');
        const owner = {};
        const first = cache.prepare(owner, 1, plan, layouts, [camera, firstMaterial]);
        const firstGroup0 = requireGroup(cache.resolveGroup(owner, 0));
        const firstGroup1 = requireGroup(cache.resolveGroup(owner, 1));
        const secondMaterial = registerUniformBuffer(registry, 'second material uniform');
        let partialGroup: RHIBindGroup | undefined;
        createBindGroup
            .mockImplementationOnce(descriptor => {
                partialGroup = originalCreateBindGroup(descriptor);
                return partialGroup;
            })
            .mockImplementationOnce(() => {
                throw new Error('injected bind-group creation failure');
            });

        expect(() => cache.prepare(owner, 1, plan, layouts, [camera, secondMaterial])).toThrow(
            'injected bind-group creation failure'
        );

        expect(cache.resolveGroup(owner, 0)).toBe(firstGroup0);
        expect(cache.resolveGroup(owner, 1)).toBe(firstGroup1);
        expect(first.groupHandles).toEqual([first.groupHandles[0], first.groupHandles[1]]);
        expect(registry.diagnostics().pendingReleaseCount).toBe(0);
        expect(partialGroup?.destroyed).toBe(true);
        expect(registry.collect(0)).toBe(0);
        expect(firstGroup0.destroyed).toBe(false);
        expect(firstGroup1.destroyed).toBe(false);

        const retry = cache.prepare(owner, 1, plan, layouts, [camera, secondMaterial]);
        expect(retry.token).toBeGreaterThan(first.token);
        expect(cache.resolveGroup(owner, 1)).not.toBe(firstGroup1);

        cache.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('marks dependencies through group lifetime, detaches, destroys, and accepts an empty plan', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new UniformBindGroupResourceCache(registry);
        const plan = bindingPlan([{ name: 'FrameBlock', group: 0, binding: 0 }]);
        const layouts = registerLayouts(registry, plan);
        const buffer = registerUniformBuffer(registry, 'frame uniform');
        const owner = {};
        cache.prepare(owner, 1, plan, layouts, [buffer]);
        const group = requireGroup(cache.resolveGroup(owner, 0));
        const layout = registry.resolve(requireAt(layouts, 0));
        const uniform = registry.resolve(buffer);

        cache.markUsed(owner, 5);
        registry.release(requireAt(layouts, 0));
        registry.release(buffer);
        expect(cache.detach(owner)).toBe(true);
        expect(cache.detach(owner)).toBe(false);
        expect(() => cache.resolveGroup(owner, 0)).toThrow(/not prepared/);
        expect(registry.collect(4)).toBe(0);
        expect(group.destroyed).toBe(false);
        expect(layout.destroyed).toBe(false);
        expect(uniform.destroyed).toBe(false);
        expect(registry.collect(5)).toBe(3);
        expect(group.destroyed).toBe(true);
        expect(layout.destroyed).toBe(true);
        expect(uniform.destroyed).toBe(true);

        const emptyOwner = {};
        const emptyPlan = bindingPlan([]);
        const empty = cache.prepare(emptyOwner, 2, emptyPlan, [], []);
        expect(empty.groupHandles).toEqual([]);
        expect(empty.activeGroupIndices).toEqual([]);
        expect(cache.prepare(emptyOwner, 2, emptyPlan, [], [])).toBe(empty);
        cache.markUsed(emptyOwner, 6);
        expect(cache.detach(emptyOwner)).toBe(true);

        const remainingLayouts = registerLayouts(registry, plan);
        const remainingBuffer = registerUniformBuffer(registry, 'remaining uniform');
        const remainingOwner = {};
        cache.prepare(remainingOwner, 3, plan, remainingLayouts, [remainingBuffer]);
        const remainingGroup = requireGroup(cache.resolveGroup(remainingOwner, 0));
        cache.destroy();
        cache.destroy();
        expect(() =>
            cache.prepare(remainingOwner, 3, plan, remainingLayouts, [remainingBuffer])
        ).toThrow(/resource cache is destroyed/);
        expect(() => {
            cache.markUsed(remainingOwner, 7);
        }).toThrow(/resource cache is destroyed/);
        expect(registry.collect(0)).toBe(1);
        expect(remainingGroup.destroyed).toBe(true);

        registry.destroy();
        backend.destroy();
    });

    it('validates continuous layout and uniform-buffer handle counts before creating resources', () => {
        const backend = new FakeWebGLRHIBackend();
        const device: FakeRHIDevice = backend.createDevice();
        const createBindGroup = vi.spyOn(device, 'createBindGroup');
        const registry = new ResourceRegistry(device);
        const cache = new UniformBindGroupResourceCache(registry);
        const plan = bindingPlan([{ name: 'FrameBlock', group: 0, binding: 0 }]);
        const layouts = registerLayouts(registry, plan);
        const buffer = registerUniformBuffer(registry, 'frame uniform');

        expect(() => cache.prepare({}, 1, plan, [], [buffer])).toThrow(/layout handles must match/);
        expect(() => cache.prepare({}, 1, plan, layouts, [])).toThrow(
            /Uniform buffer handles must match/
        );
        expect(createBindGroup).not.toHaveBeenCalled();

        cache.destroy();
        registry.destroy();
        backend.destroy();
    });
});
