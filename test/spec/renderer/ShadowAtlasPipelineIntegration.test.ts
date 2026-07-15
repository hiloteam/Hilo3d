import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import Skeleton from '../../../src/core/Skeleton';
import SkinnedMesh from '../../../src/core/SkinnedMesh';
import Geometry from '../../../src/geometry/Geometry';
import GeometryData from '../../../src/geometry/GeometryData';
import MorphGeometry from '../../../src/geometry/MorphGeometry';
import DirectionalLight from '../../../src/light/DirectionalLight';
import LightManager from '../../../src/light/LightManager';
import PointLight from '../../../src/light/PointLight';
import SpotLight from '../../../src/light/SpotLight';
import BasicMaterial from '../../../src/material/BasicMaterial';
import Color from '../../../src/math/Color';
import Matrix4 from '../../../src/math/Matrix4';
import Vector3 from '../../../src/math/Vector3';
import type RendererCore from '../../../src/render/RendererCore';
import { RenderFrame } from '../../../src/render/frame/RenderFrame';
import { createRenderFrameContext } from '../../../src/render/frame/RenderFrameContext';
import { ForwardRenderer } from '../../../src/render/renderer/ForwardRenderer';
import { MeshDrawProcessor } from '../../../src/render/renderer/MeshDrawProcessor';
import type { PreparedDraw } from '../../../src/render/renderer/PreparedDraw';
import { ShadowAtlasMeshPreparer } from '../../../src/render/renderer/ShadowAtlasMeshPreparer';
import { ShadowAtlasRenderer } from '../../../src/render/renderer/ShadowAtlasRenderer';
import { ShadowAtlasResourceCache } from '../../../src/render/renderer/ShadowAtlasResourceCache';
import { ShadowAtlasSceneAdapter } from '../../../src/render/renderer/ShadowAtlasSceneAdapter';
import { ShadowAtlasTextureBinding } from '../../../src/render/renderer/ShadowAtlasTextureBinding';
import { MainPassTemplate, SharedDrawPassParameters } from '../../../src/render/renderer/passes';
import { RHITextureUsage, type RHIBindGroup } from '../../../src/render/rhi/core';
import Texture from '../../../src/texture/Texture';
import { describe, expect, it, vi } from 'vitest';
import {
    FakeWebGLRHIBackend,
    FakeWebGPURHIBackend,
    type FakeRHIBackend,
    type FakeRHIDevice
} from '../rhi/v2/FakeRHIBackend';

function rendererCore(): RendererCore {
    return {
        width: 32,
        height: 16,
        useInstanced: true,
        useLogDepth: false,
        forceMaterial: null,
        vertexPrecision: 'highp',
        fragmentPrecision: 'highp',
        getViewport: () => [0, 0, 32, 16]
    } as unknown as RendererCore;
}

function frameContext(
    renderer: RendererCore,
    device: FakeRHIDevice,
    camera: PerspectiveCamera,
    lights: LightManager,
    frameIndex: number
) {
    return createRenderFrameContext({
        renderer,
        rhi: device,
        frameIndex,
        camera,
        lightManager: lights,
        fog: null,
        viewport: { x: 0, y: 0, width: 32, height: 16, minDepth: 0, maxDepth: 1 }
    });
}

function triangleGeometry(): Geometry {
    return new Geometry({
        vertices: new GeometryData(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]), 3),
        normals: new GeometryData(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
        uvs: new GeometryData(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2)
    });
}

function alphaCutoutMesh(): { readonly mesh: Mesh; readonly texture: Texture<Uint8Array> } {
    const texture = new Texture({
        image: new Uint8Array([255, 255, 255, 0, 255, 255, 255, 255]),
        width: 2,
        height: 1
    });
    const material = new BasicMaterial({
        lightType: 'NONE',
        diffuse: texture,
        alphaCutoff: 0.5,
        cullFace: false
    });
    return { mesh: new Mesh({ geometry: triangleGeometry(), material }), texture };
}

function morphMesh(): Mesh {
    const base = triangleGeometry();
    const geometry = new MorphGeometry({
        vertices: base.vertices,
        normals: base.normals,
        uvs: base.uvs,
        weights: new Float32Array([0.25]),
        targets: {
            vertices: [new GeometryData(new Float32Array([0.1, 0, 0, 0.1, 0, 0, 0.1, 0, 0]), 3)]
        }
    });
    return new Mesh({
        geometry,
        material: new BasicMaterial({ lightType: 'NONE', cullFace: false })
    });
}

function skinnedMesh(): SkinnedMesh {
    const geometry = triangleGeometry();
    geometry.skinIndices = new GeometryData(new Uint8Array(12), 4);
    geometry.skinWeights = new GeometryData(
        new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0]),
        4,
        { normalized: true }
    );
    const joint = new Node();
    joint.updateMatrixWorld(true);
    const mesh = new SkinnedMesh({
        geometry,
        material: new BasicMaterial({ lightType: 'NONE', cullFace: false }),
        skeleton: new Skeleton({
            jointNodeList: [joint],
            jointNames: ['root'],
            inverseBindMatrices: [new Matrix4()]
        })
    });
    mesh.updateMatrixWorld(true);
    return mesh;
}

function receiverMesh(): Mesh {
    return new Mesh({
        geometry: triangleGeometry(),
        material: new BasicMaterial({
            lightType: 'LAMBERT',
            diffuse: new Color(0.5, 0.75, 1, 1),
            receiveShadows: true,
            depthTest: false,
            depthMask: false,
            cullFace: false
        })
    });
}

function instancedMeshes(): readonly [Mesh, Mesh, Mesh] {
    const geometry = triangleGeometry();
    const material = new BasicMaterial({
        lightType: 'NONE',
        castShadows: true,
        cullFace: false
    });
    const first = new Mesh({ geometry, material, useInstanced: true });
    const second = new Mesh({ geometry, material, useInstanced: true });
    const third = new Mesh({ geometry, material, useInstanced: true });
    first.setPosition(-2, 0, 0).updateMatrixWorld(true);
    second.setPosition(0, 1, 0).updateMatrixWorld(true);
    third.setPosition(2, 0, 0).updateMatrixWorld(true);
    return [first, second, third];
}

function configuredSurface(device: FakeRHIDevice) {
    const surface = device.createSurface({ width: 0, height: 0 } as HTMLCanvasElement);
    surface.configure({
        width: 32,
        height: 16,
        format: 'rgba8unorm',
        usage: RHITextureUsage.RENDER_ATTACHMENT
    });
    return surface;
}

function uniformBufferOf(draw: PreparedDraw, name: string): object {
    const binding = draw.pipeline.descriptor.vertex.shader.artifact.reflection.bindings.find(
        candidate => candidate.kind === 'uniform-buffer' && candidate.name === name
    );
    if (binding === undefined) throw new Error(`Prepared draw is missing ${name}`);
    const groups = Reflect.get(draw, 'bindGroups') as readonly (RHIBindGroup | null)[];
    const group = groups[binding.group];
    const resource = group?.entries.find(entry => entry.binding === binding.binding)?.resource;
    if (resource === undefined || !('buffer' in resource)) {
        throw new Error(`Prepared draw did not bind ${name}`);
    }
    return resource.buffer;
}

function preparedInstanceCount(draw: PreparedDraw): number {
    return (
        Reflect.get(draw, 'drawArguments') as {
            readonly instanceCount: number;
        }
    ).instanceCount;
}

async function complete(backend: FakeRHIBackend, submission: { readonly done: Promise<void> }) {
    if (backend.executionMode === 'deferred') backend.completeNextSubmission();
    await submission.done;
}

function preparedGroups(processor: MeshDrawProcessor, owner: object): readonly RHIBindGroup[] {
    const groups: RHIBindGroup[] = [];
    for (
        let index = 0;
        index < processor.registry.deviceCapabilities.limits.maxBindGroups;
        index++
    ) {
        try {
            const group = processor.bindGroups.resolveGroup(owner, index);
            if (group !== null) groups.push(group);
        } catch (error) {
            if (error instanceof RangeError) break;
            throw error;
        }
    }
    return groups;
}

describe.each([
    ['WebGL immediate', () => new FakeWebGLRHIBackend()],
    ['WebGPU deferred', () => new FakeWebGPURHIBackend()]
] as const)('shared shadow-atlas production pipeline on %s', (_name, createBackend) => {
    it('keeps every instanced mesh in directional, spot, and point shadows while batching the main pass', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const renderer = rendererCore();
        const processor = new MeshDrawProcessor(renderer, device);
        await processor.initialize();
        const camera = new PerspectiveCamera({ near: 0.1, far: 100, aspect: 2 });
        camera.setPosition(0, 2, 8).lookAt(new Vector3(0, 0, 0));
        camera.updateViewProjectionMatrix();
        const lights = new LightManager();
        const directional = new DirectionalLight({ shadow: { width: 8, height: 8 } });
        const spot = new SpotLight({ shadow: { width: 8, height: 8 } });
        const point = new PointLight({ shadow: { width: 8, height: 8 } });
        directional.setPosition(3, 5, 4).lookAt(new Vector3(0, 0, 0));
        spot.setPosition(-4, 5, 3).lookAt(new Vector3(0, 0, 0));
        point.setPosition(0, 4, -2);
        directional.updateMatrixWorld(true);
        spot.updateMatrixWorld(true);
        point.updateMatrixWorld(true);
        lights.addLight(directional).addLight(spot).addLight(point);

        const adapter = new ShadowAtlasSceneAdapter();
        const scenePlan = adapter.prepare(lights, camera, device.capabilities, {
            width: 8,
            height: 8
        });
        expect(scenePlan.atlas.sliceCount).toBe(8);
        expect(scenePlan.slices.filter(slice => slice.kind === 'directional')).toHaveLength(1);
        expect(scenePlan.slices.filter(slice => slice.kind === 'spot')).toHaveLength(1);
        expect(scenePlan.slices.filter(slice => slice.kind === 'point')).toHaveLength(6);
        const resources = new ShadowAtlasResourceCache(processor.registry);
        const atlas = resources.prepare({}, scenePlan.atlas);
        const textureBinding = new ShadowAtlasTextureBinding();
        textureBinding.update(atlas);
        textureBinding.attach(lights, scenePlan);
        const meshes = instancedMeshes();
        const preparer = new ShadowAtlasMeshPreparer(processor);
        preparer.configure(scenePlan, meshes);
        const shadowRenderer = new ShadowAtlasRenderer(processor.registry, 8, meshes.length);
        const prepareShadow = vi.spyOn(processor, 'prepareShadow');
        const beginFrame = device.graphicsQueue.beginFrame.bind(device.graphicsQueue);
        const labels: string[] = [];
        vi.spyOn(device.graphicsQueue, 'beginFrame').mockImplementation(descriptor => {
            const commands = beginFrame(descriptor);
            const beginRenderPass = commands.beginRenderPass.bind(commands);
            vi.spyOn(commands, 'beginRenderPass').mockImplementation(pass => {
                labels.push(pass.label ?? '');
                return beginRenderPass(pass);
            });
            return commands;
        });

        const shadow = shadowRenderer.render(
            frameContext(renderer, device, camera, lights, 1),
            atlas,
            scenePlan.atlas,
            { preparer }
        );
        await complete(backend, shadow.submission);
        await shadowRenderer.waitForIdle();

        const expectedShadowDrawCount = scenePlan.atlas.sliceCount * meshes.length;
        expect(shadow.diagnostics.drawCount).toBe(expectedShadowDrawCount);
        expect(labels).toHaveLength(scenePlan.atlas.sliceCount);
        expect(labels.filter(label => label.includes(' directional '))).toHaveLength(1);
        expect(labels.filter(label => label.includes(' spot '))).toHaveLength(1);
        expect(labels.filter(label => label.includes(' point '))).toHaveLength(6);
        expect(prepareShadow).toHaveBeenCalledTimes(expectedShadowDrawCount);
        const shadowDraws: readonly PreparedDraw[] = prepareShadow.mock.results.map(
            result => result.value as PreparedDraw
        );
        expect(new Set(shadowDraws).size).toBe(expectedShadowDrawCount);
        for (const draw of shadowDraws) {
            expect(preparedInstanceCount(draw)).toBe(1);
            expect(draw.pipeline.descriptor.fragment?.targets).toEqual([]);
        }
        expect(
            backend.executionLog.filter(
                command => command.startsWith('draw:') || command.startsWith('draw-indexed:')
            )
        ).toHaveLength(expectedShadowDrawCount);
        for (let sliceIndex = 0; sliceIndex < scenePlan.atlas.sliceCount; sliceIndex += 1) {
            const offset = sliceIndex * meshes.length;
            const calls = prepareShadow.mock.calls.slice(offset, offset + meshes.length);
            expect(calls.map(call => call[1])).toEqual(meshes);
            expect(
                new Set(
                    shadowDraws
                        .slice(offset, offset + meshes.length)
                        .map(draw => uniformBufferOf(draw, 'ModelBlock'))
                ).size
            ).toBe(meshes.length);
        }

        backend.resetExecutionLog();
        labels.length = 0;
        const surface = configuredSurface(device);
        const forward = new ForwardRenderer(1);
        const prepareInstancedBatch = vi.spyOn(processor, 'prepareInstancedBatch');
        const main = forward.render(frameContext(renderer, device, camera, lights, 2), surface, {
            meshProcessor: processor,
            classifiedMeshes: meshes,
            depthStencilFormat: 'depth24plus'
        });
        await complete(backend, main.submission);
        await processor.submissions.waitForIdle();

        expect(prepareInstancedBatch).toHaveBeenCalledOnce();
        expect(prepareInstancedBatch.mock.calls[0]?.[1]).toEqual(meshes);
        const mainDraw = prepareInstancedBatch.mock.results[0]?.value as PreparedDraw | undefined;
        if (mainDraw === undefined) throw new Error('Main instanced draw was not prepared');
        expect(main.diagnostics.drawCount).toBe(1);
        expect(preparedInstanceCount(mainDraw)).toBe(meshes.length);
        const layouts = mainDraw.pipeline.descriptor.vertex.buffers ?? [];
        const bindings = mainDraw.pipeline.descriptor.vertex.shader.artifact.reflection.bindings;
        if (device.backend === 'webgl2') {
            expect(layouts.some(layout => layout?.stepMode === 'instance')).toBe(true);
            expect(bindings.some(binding => binding.name === 'InstanceBlock')).toBe(false);
        } else {
            expect(layouts.some(layout => layout?.stepMode === 'instance')).toBe(false);
            expect(bindings.some(binding => binding.name === 'InstanceBlock')).toBe(true);
        }
        expect(
            backend.executionLog.filter(command =>
                command.startsWith('render-pass:Forward main pass')
            )
        ).toHaveLength(1);
        expect(
            backend.executionLog.filter(
                command => command.startsWith('draw:') || command.startsWith('draw-indexed:')
            )
        ).toHaveLength(1);

        const morph = morphMesh();
        morph.useInstanced = true;
        expect(() =>
            forward.render(frameContext(renderer, device, camera, lights, 3), surface, {
                meshProcessor: processor,
                classifiedMeshes: [morph],
                depthStencilFormat: 'depth24plus'
            })
        ).toThrow('Per-object skinning and morph deformation are not supported by instanced draws');
        const skinned = skinnedMesh();
        skinned.useInstanced = true;
        expect(() =>
            forward.render(frameContext(renderer, device, camera, lights, 4), surface, {
                meshProcessor: processor,
                classifiedMeshes: [skinned],
                depthStencilFormat: 'depth24plus'
            })
        ).toThrow('Per-object skinning and morph deformation are not supported by instanced draws');
        expect(processor.active).toBe(false);

        forward.destroy();
        surface.destroy();
        preparer.destroy();
        textureBinding.destroy();
        shadowRenderer.destroy();
        resources.destroy();
        adapter.destroy();
        processor.destroy();
        backend.destroy();
    });

    it('prepares alpha/deformation draws, binds one comparison atlas, and survives recovery', async () => {
        const backend = createBackend();
        let device = backend.createDevice();
        const renderer = rendererCore();
        const processor = new MeshDrawProcessor(renderer, device);
        await processor.initialize();
        const camera = new PerspectiveCamera({ near: 0.1, far: 100, aspect: 2 });
        camera.setPosition(0, 1, 6).lookAt(new Vector3(0, 0, 0));
        camera.updateViewProjectionMatrix();
        const lights = new LightManager();
        const firstLight = new DirectionalLight({ shadow: {} });
        const secondLight = new DirectionalLight({ shadow: {} });
        firstLight.setPosition(2, 4, 3).lookAt(new Vector3(0, 0, 0));
        secondLight.setPosition(-3, 5, 2).lookAt(new Vector3(0, 0, 0));
        firstLight.updateMatrixWorld(true);
        secondLight.updateMatrixWorld(true);
        lights.addLight(firstLight).addLight(secondLight);

        const adapter = new ShadowAtlasSceneAdapter();
        const scenePlan = adapter.prepare(lights, camera, device.capabilities, {
            width: 8,
            height: 8
        });
        const resources = new ShadowAtlasResourceCache(processor.registry);
        const atlasOwner = {};
        const atlas = resources.prepare(atlasOwner, scenePlan.atlas);
        const textureBinding = new ShadowAtlasTextureBinding();
        textureBinding.update(atlas);
        textureBinding.attach(lights, scenePlan);
        const stableBinding = textureBinding.resolve('comparison-sampler');
        expect(stableBinding).not.toBeNull();
        expect(textureBinding.resolve('comparison-sampler')).toBe(stableBinding);
        expect(textureBinding.resolve('sampler')).toBeNull();

        const alpha = alphaCutoutMesh();
        const meshes = [alpha.mesh, morphMesh(), skinnedMesh()];
        const preparer = new ShadowAtlasMeshPreparer(processor);
        preparer.configure(scenePlan, meshes);
        const shadowRenderer = new ShadowAtlasRenderer(processor.registry, 2, meshes.length);
        const beginFrame = device.graphicsQueue.beginFrame.bind(device.graphicsQueue);
        const labels: string[] = [];
        vi.spyOn(device.graphicsQueue, 'beginFrame').mockImplementation(descriptor => {
            const commands = beginFrame(descriptor);
            const beginRenderPass = commands.beginRenderPass.bind(commands);
            vi.spyOn(commands, 'beginRenderPass').mockImplementation(pass => {
                labels.push(pass.label ?? '');
                return beginRenderPass(pass);
            });
            return commands;
        });

        const firstShadow = shadowRenderer.render(
            frameContext(renderer, device, camera, lights, 1),
            atlas,
            scenePlan.atlas,
            { preparer }
        );
        await complete(backend, firstShadow.submission);
        await shadowRenderer.waitForIdle();
        expect(labels).toEqual(['Shadow atlas directional 0', 'Shadow atlas directional 1']);
        expect(backend.executionLog.filter(command => command.startsWith('draw:'))).toHaveLength(
            scenePlan.atlas.sliceCount * meshes.length
        );
        expect(
            backend.executionLog.filter(command => command.startsWith('bind-group:')).length
        ).toBeGreaterThan(scenePlan.atlas.sliceCount);

        const receiver = receiverMesh();
        const receiverFrame = new RenderFrame();
        let receiverDraw: ReturnType<MeshDrawProcessor['prepare']> | undefined;
        const receiverResult = receiverFrame.execute(
            frameContext(renderer, device, camera, lights, 2),
            scope => {
                processor.beginFrame(scope.context, scope.uploads);
                receiverDraw = processor.prepare(receiver, {
                    colorFormats: ['rgba8unorm'],
                    sampleCount: 1
                });
                const color = scope.graph.createTexture('shadow receiver color', {
                    size: { width: 32, height: 16 },
                    format: 'rgba8unorm',
                    usage: RHITextureUsage.RENDER_ATTACHMENT
                });
                const pass = new SharedDrawPassParameters({ colorAttachments: 1, draws: 1 });
                pass.label = 'shadow receiver';
                pass.sideEffect = true;
                pass.addColorAttachment({
                    texture: color,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 }
                });
                pass.addDraw(receiverDraw);
                scope.graph.addPass(MainPassTemplate, pass);
            }
        );
        await complete(backend, receiverResult.submission);
        expect(receiverDraw).toBeDefined();
        const atlasView = processor.registry.resolve(atlas.view);
        const atlasSampler = processor.registry.resolve(atlas.comparisonSampler);
        const receiverEntries = preparedGroups(processor, receiver).flatMap(group => group.entries);
        expect(receiverEntries.some(entry => entry.resource === atlasView)).toBe(true);
        expect(receiverEntries.some(entry => entry.resource === atlasSampler)).toBe(true);
        expect(
            receiverDraw?.pipeline.descriptor.fragment?.shader.artifact.reflection.bindings
        ).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'u_shadowAtlas', kind: 'sampled-texture' }),
                expect.objectContaining({ name: 'u_shadowAtlas', kind: 'comparison-sampler' })
            ])
        );
        receiverFrame.destroy();

        const oldView = processor.registry.resolve(atlas.view);
        device = backend.createDevice();
        processor.recover(device);
        expect(processor.registry.resolve(atlas.view)).not.toBe(oldView);
        expect(textureBinding.resolve('comparison-sampler')).toBe(stableBinding);
        expect(stableBinding?.textureView).toBe(atlas.view);
        expect(stableBinding?.sampler).toBe(atlas.comparisonSampler);

        backend.resetExecutionLog();
        preparer.configure(scenePlan, meshes);
        const recoveredShadow = shadowRenderer.render(
            frameContext(renderer, device, camera, lights, 3),
            atlas,
            scenePlan.atlas,
            { preparer }
        );
        await complete(backend, recoveredShadow.submission);
        await shadowRenderer.waitForIdle();
        expect(backend.executionLog.filter(command => command.startsWith('draw:'))).toHaveLength(
            scenePlan.atlas.sliceCount * meshes.length
        );

        processor.detachMesh(receiver);
        preparer.destroy();
        textureBinding.destroy();
        shadowRenderer.destroy();
        resources.destroy();
        adapter.destroy();
        processor.destroy();
        alpha.texture.destroy();
        backend.destroy();
    });
});
