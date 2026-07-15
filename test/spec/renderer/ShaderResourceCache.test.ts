import { describe, expect, it, vi } from 'vitest';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { ShaderArtifactCompiler } from '../../../src/render/renderer/ShaderArtifactCompiler';
import { ShaderResourceCache } from '../../../src/render/renderer/ShaderResourceCache';
import Shader from '../../../src/shader/Shader';
import { FakeWebGLRHIBackend, FakeWebGPURHIBackend } from '../rhi/v2/FakeRHIBackend';

const vertexSource = `#version 300 es
in vec2 position;
void main() {
    gl_Position = vec4(position, 0.0, 1.0);
}`;

const fragmentSource = `#version 300 es
precision highp float;
layout(location = 0) out vec4 color;
void main() {
    color = vec4(1.0);
}`;

function shader(): Shader {
    return new Shader({ vs: vertexSource, fs: fragmentSource });
}

describe('ShaderResourceCache', () => {
    it('creates one logical shader pair and reuses it for an artifact-token cache hit', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const createShader = vi.spyOn(device, 'createShader');
        const registry = new ResourceRegistry(device);
        const compiler = new ShaderArtifactCompiler();
        const cache = new ShaderResourceCache(registry, compiler);
        const source = shader();

        const handles = cache.prepare(source);
        const resolved = cache.resolve(source);

        expect(registry.deviceBackend).toBe('webgl2');
        expect(registry.deviceGeneration).toBe(device.generation);
        expect(handles).toMatchObject({ backend: 'webgl2', token: 1 });
        expect(handles.vertex).not.toBe(handles.fragment);
        expect(resolved).toMatchObject({ backend: 'webgl2', token: handles.token });
        expect(resolved.vertex.stage).toBe('vertex');
        expect(resolved.fragment.stage).toBe('fragment');
        expect(resolved.vertex.artifact.code).toBe(vertexSource);
        expect(resolved.fragment.artifact.code).toBe(fragmentSource);
        expect(createShader).toHaveBeenCalledTimes(2);

        expect(cache.prepare(source)).toBe(handles);
        const cached = cache.resolve(source);
        expect(cached.vertex).toBe(resolved.vertex);
        expect(cached.fragment).toBe(resolved.fragment);
        expect(createShader).toHaveBeenCalledTimes(2);
        expect(registry.diagnostics()).toMatchObject({
            trackedResourceCount: 2,
            pendingReleaseCount: 0
        });

        cache.destroy();
        expect(registry.collect(0)).toBe(2);
        registry.destroy();
        backend.destroy();
    });

    it('replaces and releases handles when source or artifact token changes', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const createShader = vi.spyOn(device, 'createShader');
        const registry = new ResourceRegistry(device);
        const compiler = new ShaderArtifactCompiler();
        const cache = new ShaderResourceCache(registry, compiler);
        const source = shader();
        const firstHandles = cache.prepare(source);
        const first = cache.resolve(source);

        source.vs = `${source.vs}\n// source revision`;
        const sourceRevisionHandles = cache.prepare(source);
        const sourceRevision = cache.resolve(source);

        expect(sourceRevisionHandles).not.toBe(firstHandles);
        expect(sourceRevisionHandles.token).toBeGreaterThan(firstHandles.token);
        expect(sourceRevisionHandles.vertex).not.toBe(firstHandles.vertex);
        expect(sourceRevisionHandles.fragment).not.toBe(firstHandles.fragment);
        expect(sourceRevision.vertex).not.toBe(first.vertex);
        expect(sourceRevision.fragment).not.toBe(first.fragment);
        expect(createShader).toHaveBeenCalledTimes(4);
        expect(registry.diagnostics()).toMatchObject({
            trackedResourceCount: 4,
            pendingReleaseCount: 2
        });
        expect(registry.collect(0)).toBe(2);
        expect(first.vertex.destroyed).toBe(true);
        expect(first.fragment.destroyed).toBe(true);

        compiler.clear();
        const tokenRevisionHandles = cache.prepare(source);
        expect(tokenRevisionHandles.token).toBeGreaterThan(sourceRevisionHandles.token);
        expect(tokenRevisionHandles.vertex).not.toBe(sourceRevisionHandles.vertex);
        expect(tokenRevisionHandles.fragment).not.toBe(sourceRevisionHandles.fragment);
        expect(createShader).toHaveBeenCalledTimes(6);
        expect(registry.collect(0)).toBe(2);
        expect(sourceRevision.vertex.destroyed).toBe(true);
        expect(sourceRevision.fragment.destroyed).toBe(true);

        cache.destroy();
        expect(registry.collect(0)).toBe(2);
        registry.destroy();
        backend.destroy();
    });

    it('retains independent color and depth-only shader resources for one Shader identity', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new ShaderResourceCache(registry, new ShaderArtifactCompiler());
        const source = shader();

        const colorHandles = cache.prepare(source);
        const color = cache.resolve(source);
        const depthHandles = cache.prepare(source, 'depth-only');
        const depth = cache.resolve(source, 'depth-only');

        expect(depthHandles).not.toBe(colorHandles);
        expect(depthHandles.token).not.toBe(colorHandles.token);
        expect(depth.fragment.artifact.reflection.fragmentOutputs).toEqual([]);
        expect(depth.fragment.artifact.code).not.toMatch(/\bout\s+vec4\s+color\b/u);
        expect(cache.prepare(source)).toBe(colorHandles);
        expect(cache.resolve(source).vertex).toBe(color.vertex);
        expect(cache.prepare(source, 'depth-only')).toBe(depthHandles);
        expect(cache.resolve(source, 'depth-only').fragment).toBe(depth.fragment);
        expect(registry.diagnostics().trackedResourceCount).toBe(4);

        expect(cache.detach(source)).toBe(true);
        expect(registry.collect(0)).toBe(4);
        cache.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('rebuilds captured artifacts on recovery and rejects a different backend', () => {
        const webGLBackend = new FakeWebGLRHIBackend();
        const firstDevice = webGLBackend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const cache = new ShaderResourceCache(registry, new ShaderArtifactCompiler());
        const source = shader();
        const handles = cache.prepare(source);
        const first = cache.resolve(source);
        const capturedVertexCode = first.vertex.artifact.code;
        source.vs = `${source.vs}\n// not prepared before recovery`;

        const secondDevice = webGLBackend.createDevice();
        const secondCreateShader = vi.spyOn(secondDevice, 'createShader');
        registry.recover(secondDevice);
        const recovered = cache.resolve(source);

        expect(secondCreateShader).toHaveBeenCalledTimes(2);
        expect(handles.backend).toBe('webgl2');
        expect(recovered.vertex).not.toBe(first.vertex);
        expect(recovered.fragment).not.toBe(first.fragment);
        expect(recovered.vertex.deviceId).toBe(secondDevice.id);
        expect(recovered.fragment.deviceId).toBe(secondDevice.id);
        expect(recovered.vertex.artifact.code).toBe(capturedVertexCode);
        expect(first.vertex.destroyed).toBe(true);
        expect(first.fragment.destroyed).toBe(true);
        expect(registry.deviceBackend).toBe('webgl2');
        expect(registry.deviceGeneration).toBe(secondDevice.generation);

        const webGPUBackend = new FakeWebGPURHIBackend();
        const wrongBackendDevice = webGPUBackend.createDevice();
        const wrongCreateShader = vi.spyOn(wrongBackendDevice, 'createShader');
        expect(() => {
            registry.recover(wrongBackendDevice);
        }).toThrow('Resource registry recovery requires the same RHI backend');
        expect(wrongCreateShader).not.toHaveBeenCalled();
        expect(registry.state).toBe('recovery-failed');
        expect(registry.deviceBackend).toBe('webgl2');

        const recoveryDevice = webGLBackend.createDevice();
        registry.recover(recoveryDevice);
        expect(registry.state).toBe('active');
        expect(cache.resolve(source).vertex.deviceId).toBe(recoveryDevice.id);

        cache.destroy();
        registry.collect(0);
        registry.destroy();
        webGPUBackend.destroy();
        webGLBackend.destroy();
    });

    it('marks both handles used, detaches them, and releases all remaining records on destroy', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new ShaderResourceCache(registry, new ShaderArtifactCompiler());
        const detachedSource = shader();
        cache.prepare(detachedSource);
        const detached = cache.resolve(detachedSource);

        cache.markUsed(detachedSource, 5);
        expect(cache.detach(detachedSource)).toBe(true);
        expect(cache.detach(detachedSource)).toBe(false);
        expect(() => cache.resolve(detachedSource)).toThrow(
            'Shader is not prepared in this resource cache'
        );
        expect(registry.collect(4)).toBe(0);
        expect(detached.vertex.destroyed).toBe(false);
        expect(detached.fragment.destroyed).toBe(false);
        expect(registry.collect(5)).toBe(2);
        expect(detached.vertex.destroyed).toBe(true);
        expect(detached.fragment.destroyed).toBe(true);

        const remainingSource = shader();
        cache.prepare(remainingSource);
        const remaining = cache.resolve(remainingSource);
        cache.destroy();
        cache.destroy();
        expect(() => cache.prepare(remainingSource)).toThrow('Shader resource cache is destroyed');
        expect(registry.diagnostics().pendingReleaseCount).toBe(2);
        expect(registry.collect(0)).toBe(2);
        expect(remaining.vertex.destroyed).toBe(true);
        expect(remaining.fragment.destroyed).toBe(true);

        registry.destroy();
        backend.destroy();
    });
});
