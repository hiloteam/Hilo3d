import { afterEach, describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import DirectionalLight from '../../../src/light/DirectionalLight';
import BasicMaterial from '../../../src/material/BasicMaterial';
import Vector3 from '../../../src/math/Vector3';
import Renderer from '../../../src/render/Renderer';
import ComputeKernel from '../../../src/render/compute/ComputeKernel';
import ComputeShader from '../../../src/render/compute/ComputeShader';
import StorageGraphicsShader from '../../../src/render/compute/StorageGraphicsShader';
import type { RenderTarget } from '../../../src/render/RenderTarget';
import type { StorageBuffer } from '../../../src/render/StorageBuffer';
import {
    ForwardRenderPipelineFactory,
    type ForwardRenderFeatureContext,
    type ForwardRenderPipelineFeature,
    type ForwardRenderPipelineFeatureRuntime
} from '../../../src/render/pipeline/ForwardRenderPipeline';
import type {
    RenderPipeline,
    RenderPipelineContext,
    RenderPipelineCreateContext,
    RenderPipelineFactory
} from '../../../src/render/pipeline/RenderPipeline';
import type {
    RenderGraphBufferHandle,
    RenderGraphTextureAccessHandle,
    RenderGraphTextureHandle,
    RenderPipelineColorAttachment,
    RenderPipelineTargetResources,
    ScriptableRenderCommands,
    ScriptableRenderPass,
    ScriptableRenderPassBuilder,
    ScriptableRenderPassContext,
    ScriptableRenderPrepareContext
} from '../../../src/render/pipeline/ScriptableRenderGraph';
import {
    SCENE_STORAGE_BIND_GROUP,
    SceneRenderPass
} from '../../../src/render/pipeline/passes/SceneRenderPass';
import { ComputeRenderPass } from '../../../src/render/pipeline/passes/ComputeRenderPass';
import { TextureCopyPass } from '../../../src/render/pipeline/passes/TextureCopyPass';
import { PresentRenderPass } from '../../../src/render/pipeline/passes/FullscreenRenderPass';
import type { RenderTargetResourceCache } from '../../../src/render/renderer/RenderTargetResourceCache';
import { MeshDrawProcessor } from '../../../src/render/renderer/MeshDrawProcessor';
import type { RHIQueue, RHIRenderPassDescriptor } from '../../../src/render/rhi/core';

declare const __HILO3D_GITHUB_ACTIONS_COVERAGE__: boolean;

class TestPipeline implements RenderPipeline {
    readonly name = 'test-pipeline';
    readonly pass = new SceneRenderPass('Test scene pass');
    destroyCount = 0;

    record(context: RenderPipelineContext): void {
        const culling = context.cull();
        const rendererList = context.createRendererList({
            cullingResults: culling,
            queue: 'all',
            sorting: 'material-front-to-back'
        });
        const output = context.graph.importOutput();
        context.graph.addPass(this.pass, {
            rendererList,
            colorAttachments: [
                {
                    texture: output.color(0),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 }
                }
            ],
            ...(output.depthStencil === null
                ? {}
                : {
                      depthStencilAttachment: {
                          texture: output.depthStencil,
                          depthLoadOp: 'clear' as const,
                          depthStoreOp: 'discard' as const,
                          depthClearValue: 1
                      }
                  })
        });
    }

    destroy(): void {
        this.destroyCount++;
    }
}

class InstancedStorageScenePipeline implements RenderPipeline {
    readonly name = 'instanced-storage-scene';
    readonly pass = new SceneRenderPass('Instanced storage scene');
    readonly shader = new StorageGraphicsShader({
        label: 'Instanced renderer-list storage fallback',
        vertexSource: `#version 310 es
precision highp float;
layout(std140) uniform ModelBlock {
    mat4 u_modelMatrix;
};
in vec3 a_position;
void main() {
    gl_Position = u_modelMatrix * vec4(a_position, 1.0);
}`,
        fragmentSource: `#version 310 es
precision highp float;
layout(std430) readonly buffer SceneValues {
    vec4 values[];
} sceneValues;
layout(location = 0) out vec4 color;
void main() {
    color = sceneValues.values[0];
}`,
        bindings: [
            {
                name: 'ModelBlock',
                group: 2,
                binding: 0,
                kind: 'uniform-buffer'
            },
            {
                name: 'sceneValues',
                group: SCENE_STORAGE_BIND_GROUP,
                binding: 0,
                kind: 'read-only-storage-buffer',
                minBindingSize: 16
            }
        ]
    });
    buffer: StorageBuffer | null = null;

    record(context: RenderPipelineContext): void {
        const buffer = this.buffer;
        if (buffer === null) throw new Error('Instanced storage scene buffer is unavailable');
        const culling = context.cull();
        const rendererList = context.createRendererList({
            cullingResults: culling,
            queue: 'all',
            sorting: 'material-front-to-back'
        });
        const storage = context.graph.importStorageBuffer(buffer);
        const output = context.graph.importOutput();
        context.graph.addPass(this.pass, {
            rendererList,
            colorAttachments: [
                {
                    texture: output.color(0),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 }
                }
            ],
            storageShaderVariant: {
                shader: this.shader,
                buffers: [{ buffer: storage }]
            }
        });
    }

    destroy(): void {
        this.buffer = null;
    }
}

class CopyPipeline implements RenderPipeline {
    readonly name = 'copy-pipeline';
    readonly clearPass = new SceneRenderPass('Copy source clear');
    readonly copyPass = new TextureCopyPass();

    record(context: RenderPipelineContext): void {
        const source = context.graph.createTexture('copy source', {
            format: 'rgba8unorm',
            extent: { relativeTo: 'output', scale: 1 }
        });
        const culling = context.cull();
        const emptyList = context.createRendererList({
            cullingResults: culling,
            queue: 'all',
            sorting: 'none'
        });
        context.graph.addPass(this.clearPass, {
            rendererList: emptyList,
            colorAttachments: [
                {
                    texture: source,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0.25, g: 0.5, b: 0.75, a: 1 }
                }
            ]
        });
        const output = context.graph.importOutput();
        context.graph.addPass(this.copyPass, {
            source,
            destination: output.color(0)
        });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

class CopyPipelineFactory implements RenderPipelineFactory {
    readonly name = 'copy-pipeline';

    create(_context: RenderPipelineCreateContext): RenderPipeline {
        return new CopyPipeline();
    }
}

interface TextureReadParameters {
    readonly texture: RenderGraphTextureAccessHandle;
}

class TextureReadSideEffectPass implements ScriptableRenderPass<TextureReadParameters> {
    readonly name = 'Texture read side effect';

    setup(builder: ScriptableRenderPassBuilder, parameters: TextureReadParameters): void {
        builder.readTexture(parameters.texture);
        builder.markSideEffect();
    }

    execute(): void {
        // Dependency-only test pass.
    }
}

interface TextureCopySideEffectParameters {
    readonly source: RenderGraphTextureHandle;
    readonly destination: RenderGraphTextureHandle;
}

class TextureCopySideEffectPass implements ScriptableRenderPass<TextureCopySideEffectParameters> {
    readonly name = 'Texture copy side effect';

    setup(builder: ScriptableRenderPassBuilder, parameters: TextureCopySideEffectParameters): void {
        builder.copyTexture(parameters.source, parameters.destination);
        builder.markSideEffect();
    }

    execute(
        context: ScriptableRenderPassContext,
        parameters: TextureCopySideEffectParameters
    ): void {
        context.commands.copyTexture(parameters.source, parameters.destination);
    }
}

interface BufferWriteParameters {
    readonly buffer: RenderGraphBufferHandle;
}

class BufferWritePass implements ScriptableRenderPass<BufferWriteParameters> {
    readonly name = 'Buffer complete write';

    setup(builder: ScriptableRenderPassBuilder, parameters: BufferWriteParameters): void {
        builder.writeBuffer(parameters.buffer, 'copy-destination');
    }

    execute(): void {
        // Dependency fixture: the declaration is the complete-write contract under test.
    }
}

interface BufferCopyParameters {
    readonly source: RenderGraphBufferHandle;
    readonly destination: RenderGraphBufferHandle;
}

class BufferCopySideEffectPass implements ScriptableRenderPass<BufferCopyParameters> {
    readonly name = 'Buffer copy side effect';

    setup(builder: ScriptableRenderPassBuilder, parameters: BufferCopyParameters): void {
        builder.copyBuffer(parameters.source, parameters.destination);
        builder.markSideEffect();
    }

    execute(context: ScriptableRenderPassContext, parameters: BufferCopyParameters): void {
        context.commands.copyBuffer(parameters.source, parameters.destination);
    }
}

class BufferCopyPipeline implements RenderPipeline {
    readonly name = 'buffer-copy';
    readonly writePass = new BufferWritePass();
    readonly copyPass = new BufferCopySideEffectPass();

    record(context: RenderPipelineContext): void {
        const source = context.graph.createBuffer('copy source buffer', { byteLength: 16 });
        const destination = context.graph.createBuffer('copy destination buffer', {
            byteLength: 16
        });
        context.graph.addPass(this.writePass, { buffer: source });
        context.graph.addPass(this.copyPass, { source, destination });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

class BufferClearPipeline implements RenderPipeline {
    readonly name = 'buffer-clear';
    readonly pass: ScriptableRenderPass<BufferWriteParameters> = {
        name: 'WebGPU buffer clear',
        setup(builder, parameters): void {
            builder.clearBuffer(parameters.buffer);
            builder.markSideEffect();
        },
        execute(context, parameters): void {
            context.commands.clearBuffer(parameters.buffer);
        }
    };

    record(context: RenderPipelineContext): void {
        const buffer = context.graph.createBuffer('clear destination buffer', { byteLength: 16 });
        context.graph.addPass(this.pass, { buffer });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

class WebGLComputePipeline implements RenderPipeline {
    readonly name = 'webgl-compute-rejection';
    readonly pass = new ComputeRenderPass(
        new ComputeKernel({
            shader: new ComputeShader({
                source: '@compute @workgroup_size(1) fn main() {}',
                workgroupSize: [1],
                bindings: []
            })
        })
    );

    record(context: RenderPipelineContext): void {
        context.graph.addPass(this.pass, {
            buffers: [],
            textures: [],
            dispatch: { x: 1 }
        });
    }

    destroy(): void {
        // ComputeKernel contains no renderer-local resources.
    }
}

class LiveComputePipeline implements RenderPipeline {
    readonly name = 'live-compute';
    readonly pass = new ComputeRenderPass(
        new ComputeKernel({
            shader: new ComputeShader({
                source: `
@group(0) @binding(0) var<storage, read_write> output: array<u32>;
@compute @workgroup_size(4)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    output[id.x] = id.x + 7u;
}`,
                workgroupSize: [4],
                bindings: [
                    {
                        name: 'output',
                        group: 0,
                        binding: 0,
                        kind: 'storage-buffer',
                        access: 'write-discard',
                        minBindingSize: 16
                    }
                ]
            })
        })
    );
    buffer: StorageBuffer | null = null;

    record(context: RenderPipelineContext): void {
        const buffer = this.buffer;
        if (buffer === null) throw new Error('Live compute buffer is unavailable');
        const output = context.graph.importStorageBuffer(buffer);
        context.graph.addPass(this.pass, {
            buffers: [{ buffer: output }],
            textures: [],
            dispatch: { x: 1 }
        });
    }

    destroy(): void {
        this.buffer = null;
    }
}

class InvalidStorageTextureMipPipeline implements RenderPipeline {
    readonly name = 'invalid-storage-texture-mips';
    readonly pass = new ComputeRenderPass(
        new ComputeKernel({
            shader: new ComputeShader({
                source: `
@group(0) @binding(0) var output: texture_storage_2d<rgba8unorm, write>;
@compute @workgroup_size(1)
fn main() { textureStore(output, vec2<i32>(0), vec4<f32>(1.0)); }`,
                workgroupSize: [1],
                bindings: [
                    {
                        name: 'output',
                        group: 0,
                        binding: 0,
                        kind: 'storage-texture',
                        access: 'write-only',
                        format: 'rgba8unorm'
                    }
                ]
            })
        })
    );

    record(context: RenderPipelineContext): void {
        const texture = context.graph.createTexture('invalid storage mip chain', {
            format: 'rgba8unorm',
            extent: { width: 4, height: 4 },
            mipLevelCount: 2
        });
        context.graph.addPass(this.pass, {
            buffers: [],
            textures: [{ texture }],
            dispatch: { x: 1 }
        });
    }

    destroy(): void {
        // ComputeKernel contains no renderer-local resources.
    }
}

class StorageTextureMipViewPipeline implements RenderPipeline {
    readonly name = 'storage-texture-mip-view';
    readonly pass = new ComputeRenderPass(
        new ComputeKernel({
            shader: new ComputeShader({
                source: `
@group(0) @binding(0) var output: texture_storage_2d<rgba8unorm, write>;
@compute @workgroup_size(1)
fn main() { textureStore(output, vec2<i32>(0), vec4<f32>(1.0, 0.0, 0.0, 1.0)); }`,
                workgroupSize: [1],
                bindings: [
                    {
                        name: 'output',
                        group: 0,
                        binding: 0,
                        kind: 'storage-texture',
                        access: 'write-only',
                        format: 'rgba8unorm'
                    }
                ]
            })
        })
    );
    readonly readPass = new TextureReadSideEffectPass();

    record(context: RenderPipelineContext): void {
        const texture = context.graph.createTexture('storage mip chain', {
            format: 'rgba8unorm',
            extent: { width: 4, height: 4 },
            mipLevelCount: 2
        });
        const mip1 = context.graph.createTextureView('storage mip 1', texture, {
            baseMipLevel: 1,
            mipLevelCount: 1
        });
        context.graph.addPass(this.pass, {
            buffers: [],
            textures: [{ texture: mip1 }],
            dispatch: { x: 1 }
        });
        context.graph.addPass(this.readPass, { texture: mip1 });
    }

    destroy(): void {
        // ComputeKernel contains no renderer-local resources.
    }
}

type MsaaOutputFollowupMode = 'sampled' | 'copy-source';

class MsaaOutputFollowupPipeline implements RenderPipeline {
    readonly name = 'msaa-output-followup';
    readonly clearPass = new SceneRenderPass('MSAA output clear');
    readonly readPass = new TextureReadSideEffectPass();
    readonly copyPass = new TextureCopySideEffectPass();

    constructor(readonly mode: MsaaOutputFollowupMode) {}

    record(context: RenderPipelineContext): void {
        const output = context.graph.importOutput();
        const outputColor = output.color(0);
        const culling = context.cull();
        const emptyList = context.createRendererList({
            cullingResults: culling,
            queue: 'all',
            sorting: 'none'
        });
        context.graph.addPass(this.clearPass, {
            rendererList: emptyList,
            colorAttachments: [
                {
                    texture: outputColor,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: context.clearColor
                }
            ]
        });
        if (this.mode === 'sampled') {
            context.graph.addPass(this.readPass, { texture: outputColor });
            return;
        }
        const destination = context.graph.createTexture('MSAA output copy destination', {
            format: context.output.colorFormat(0),
            extent: { relativeTo: 'output', scale: 1 }
        });
        context.graph.addPass(this.copyPass, {
            source: outputColor,
            destination
        });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

class SampledDepthPipeline implements RenderPipeline {
    readonly name = 'sampled-depth';
    readonly pass = new TextureReadSideEffectPass();
    target: RenderTarget | null = null;

    record(context: RenderPipelineContext): void {
        const target = this.target;
        if (target === null) throw new Error('Sampled depth target is unavailable');
        const resources = context.graph.importRenderTarget(target);
        const depth = resources.depthStencil;
        if (depth === null) throw new Error('Sampled depth target has no depth attachment');
        context.graph.addPass(this.pass, { texture: depth });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

type InvalidCopyMode = 'extent' | 'format' | 'sample-count';

class InvalidCopyPipeline implements RenderPipeline {
    readonly name = 'invalid-copy';
    readonly clearPass = new SceneRenderPass('Invalid copy source clear');
    readonly copyPass = new TextureCopyPass();

    constructor(readonly mode: InvalidCopyMode) {}

    record(context: RenderPipelineContext): void {
        const source = context.graph.createTexture('invalid copy source', {
            format: this.mode === 'format' ? 'rgba16float' : 'rgba8unorm',
            extent:
                this.mode === 'extent'
                    ? {
                          width: Math.max(1, context.output.width - 1),
                          height: context.output.height
                      }
                    : { relativeTo: 'output', scale: 1 },
            sampleCount: this.mode === 'sample-count' ? 4 : 1
        });
        const culling = context.cull();
        const emptyList = context.createRendererList({
            cullingResults: culling,
            queue: 'all',
            sorting: 'none'
        });
        context.graph.addPass(this.clearPass, {
            rendererList: emptyList,
            colorAttachments: [
                {
                    texture: source,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 }
                }
            ]
        });
        const output = context.graph.importOutput();
        context.graph.addPass(this.copyPass, {
            source,
            destination: output.color(0)
        });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

class ExplicitResolvePipeline implements RenderPipeline {
    readonly name = 'explicit-resolve';
    readonly pass = new SceneRenderPass('Explicit resolve clear');

    record(context: RenderPipelineContext): void {
        const multisampled = context.graph.createTexture('explicit resolve source', {
            format: context.output.colorFormat(0),
            extent: { relativeTo: 'output', scale: 1 },
            sampleCount: 4
        });
        const culling = context.cull();
        const emptyList = context.createRendererList({
            cullingResults: culling,
            queue: 'all',
            sorting: 'none'
        });
        const output = context.graph.importOutput();
        context.graph.addPass(this.pass, {
            rendererList: emptyList,
            colorAttachments: [
                {
                    texture: multisampled,
                    resolveTarget: output.color(0),
                    loadOp: 'clear',
                    storeOp: 'discard',
                    clearValue: { r: 0.2, g: 0.4, b: 0.6, a: 1 }
                }
            ]
        });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

interface ReadOnlyDepthParameters {
    readonly texture: RenderGraphTextureHandle;
}

class ReadOnlyDepthPass implements ScriptableRenderPass<ReadOnlyDepthParameters> {
    readonly name = 'Read-only depth';

    setup(builder: ScriptableRenderPassBuilder, parameters: ReadOnlyDepthParameters): void {
        builder.useDepthStencilAttachment({
            texture: parameters.texture,
            depthReadOnly: true
        });
    }

    execute(): void {
        // Attachment-only validation pass.
    }
}

class ReadOnlyDepthPipeline implements RenderPipeline {
    readonly name = 'read-only-depth';
    readonly pass = new ReadOnlyDepthPass();

    record(context: RenderPipelineContext): void {
        const output = context.graph.importOutput();
        const depth = output.depthStencil;
        if (depth === null) throw new Error('Read-only depth output is unavailable');
        context.graph.addPass(this.pass, { texture: depth });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

class ConditionalShadowPipeline implements RenderPipeline {
    readonly name = 'conditional-shadow';
    readonly pass = new SceneRenderPass('Conditional shadow scene');
    recordSharedShadows = true;

    record(context: RenderPipelineContext): void {
        const culling = context.cull();
        if (this.recordSharedShadows) context.recordShadows(culling);
        const rendererList = context.createRendererList({
            cullingResults: culling,
            queue: 'all',
            sorting: 'material-front-to-back'
        });
        const output = context.graph.importOutput();
        context.graph.addPass(this.pass, {
            rendererList,
            colorAttachments: [
                {
                    texture: output.color(0),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: context.clearColor
                }
            ],
            ...(output.depthStencil === null
                ? {}
                : {
                      depthStencilAttachment: {
                          texture: output.depthStencil,
                          depthLoadOp: 'clear' as const,
                          depthStoreOp: 'discard' as const,
                          depthClearValue: 1
                      }
                  })
        });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

class SurfaceClearPipeline implements RenderPipeline {
    readonly name = 'surface-clear';
    readonly pass = new SceneRenderPass('Surface clear');
    destroyCount = 0;

    record(context: RenderPipelineContext): void {
        const culling = context.cull();
        const emptyList = context.createRendererList({
            cullingResults: culling,
            queue: 'all',
            sorting: 'none'
        });
        const output = context.graph.importOutput();
        context.graph.addPass(this.pass, {
            rendererList: emptyList,
            colorAttachments: [
                {
                    texture: output.color(0),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 }
                }
            ]
        });
    }

    destroy(): void {
        this.destroyCount++;
    }
}

class FixedRuntimeFactory implements RenderPipelineFactory {
    readonly name = 'fixed-runtime';

    constructor(readonly runtime: RenderPipeline) {}

    create(_context: RenderPipelineCreateContext): RenderPipeline {
        return this.runtime;
    }
}

class LifecycleSurfaceClearPipeline extends SurfaceClearPipeline {
    readonly submittedFrames: number[] = [];
    readonly discardedFrames: number[] = [];
    failRecording = false;
    failSubmissionCallback = false;

    override record(context: RenderPipelineContext): void {
        if (this.failRecording) throw new Error('lifecycle recording failed');
        super.record(context);
    }

    frameSubmitted(frameIndex: number): void {
        this.submittedFrames.push(frameIndex);
        if (this.failSubmissionCallback) {
            throw new Error('lifecycle submission callback failed');
        }
    }

    frameDiscarded(frameIndex: number): void {
        this.discardedFrames.push(frameIndex);
    }
}

class PipelineOwnedStoragePipeline implements RenderPipeline {
    readonly name = 'pipeline-owned-storage';
    readonly clear = new SurfaceClearPipeline();
    readonly submittedFrames: number[] = [];
    readonly discardedFrames: number[] = [];
    importBeforeWrite = false;

    constructor(readonly buffer: StorageBuffer) {}

    record(context: RenderPipelineContext): void {
        if (this.importBeforeWrite) {
            context.graph.importStorageBuffer(this.buffer);
            context.writeStorageBuffer(this.buffer, 0, new Uint32Array([99]));
            return;
        }
        context.writeStorageBuffer(
            this.buffer,
            0,
            new Uint32Array([context.frameIndex + 11, 12, 13, 14])
        );
        context.graph.importStorageBuffer(this.buffer);
        this.clear.record(context);
    }

    frameSubmitted(frameIndex: number): void {
        this.submittedFrames.push(frameIndex);
    }

    frameDiscarded(frameIndex: number): void {
        this.discardedFrames.push(frameIndex);
    }

    destroy(): void {
        this.buffer.destroy();
        this.clear.destroy();
    }
}

class PipelineOwnedStorageFactory implements RenderPipelineFactory {
    readonly name = 'pipeline-owned-storage';
    readonly requirements = Object.freeze({
        requiredCapabilities: ['storage-buffer', 'compute-pass'] as const
    });
    runtime: PipelineOwnedStoragePipeline | null = null;

    create(context: RenderPipelineCreateContext): RenderPipeline {
        const runtime = new PipelineOwnedStoragePipeline(
            context.createStorageBuffer({
                label: 'pipeline-owned values',
                byteLength: 16,
                usage: ['storage', 'copy-source', 'copy-destination'],
                recovery: 'cpu-shadow'
            })
        );
        this.runtime = runtime;
        return runtime;
    }
}

class FullscreenPresentPipeline implements RenderPipeline {
    readonly name = 'fullscreen-present';
    readonly clearPass = new SceneRenderPass('Fullscreen source clear');
    readonly presentPass = new PresentRenderPass();

    record(context: RenderPipelineContext): void {
        const source = context.graph.createTexture('fullscreen source', {
            format: 'rgba8unorm',
            extent: { relativeTo: 'output', scale: 1 }
        });
        const culling = context.cull();
        const emptyList = context.createRendererList({
            cullingResults: culling,
            queue: 'all',
            sorting: 'none'
        });
        context.graph.addPass(this.clearPass, {
            rendererList: emptyList,
            colorAttachments: [
                {
                    texture: source,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 1, g: 0, b: 0, a: 1 }
                }
            ]
        });
        const output = context.graph.importOutput();
        context.graph.addPass(this.presentPass, {
            inputTextures: [source],
            colorAttachments: [
                {
                    texture: output.color(0),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 }
                }
            ]
        });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

class PersistentTargetPipeline implements RenderPipeline {
    readonly name = 'persistent-target-pipeline';
    readonly pass = new SceneRenderPass('Persistent target clear');
    readonly key = Object.freeze({});
    width = 4;
    failAfterRecord = false;

    record(context: RenderPipelineContext): void {
        const target = context.graph.acquirePersistentTarget(this.key, {
            extent: { width: this.width, height: 4 },
            colorFormats: ['rgba8unorm']
        });
        const culling = context.cull();
        const emptyList = context.createRendererList({
            cullingResults: culling,
            queue: 'all',
            sorting: 'none'
        });
        context.graph.addPass(this.pass, {
            rendererList: emptyList,
            colorAttachments: [
                {
                    texture: target.color(0),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: context.clearColor
                }
            ]
        });
        if (this.failAfterRecord) throw new Error('persistent frame failed');
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

interface SubresourcePassParameters {
    readonly input?: RenderGraphTextureAccessHandle;
    readonly output: RenderGraphTextureAccessHandle;
    readonly sideEffect?: boolean;
}

class SubresourcePass implements ScriptableRenderPass<SubresourcePassParameters> {
    readonly name = 'Subresource view pass';

    setup(builder: ScriptableRenderPassBuilder, parameters: SubresourcePassParameters): void {
        if (parameters.input !== undefined) builder.readTexture(parameters.input);
        builder.useColorAttachment({
            texture: parameters.output,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 }
        });
        if (parameters.sideEffect) builder.markSideEffect();
    }

    execute(): void {
        // Graph subresource scheduling is under test; no native draw is required.
    }
}

class SubresourceViewPipeline implements RenderPipeline {
    readonly name = 'subresource-view-pipeline';
    readonly pass = new SubresourcePass();
    overlap = false;

    record(context: RenderPipelineContext): void {
        const texture = context.graph.createTexture('public mip chain', {
            format: 'r32float',
            extent: { width: 8, height: 8 },
            mipLevelCount: 2
        });
        const mip0 = context.graph.createTextureView('public mip 0', texture, {
            baseMipLevel: 0,
            mipLevelCount: 1
        });
        const output = context.graph.createTextureView(
            this.overlap ? 'overlapping public mip 0' : 'public mip 1',
            texture,
            {
                baseMipLevel: this.overlap ? 0 : 1,
                mipLevelCount: 1
            }
        );
        context.graph.addPass(this.pass, { output: mip0 });
        context.graph.addPass(this.pass, { input: mip0, output, sideEffect: true });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

class HistoryTexturePipeline implements RenderPipeline {
    readonly name = 'history-texture-pipeline';
    readonly key = Object.freeze({});
    readonly pass = new SubresourcePass();
    readonly valid: boolean[] = [];
    readonly generations: number[] = [];
    width = 4;
    mipLevelCount = 1;
    failAfterRecord = false;

    record(context: RenderPipelineContext): void {
        const history = context.graph.acquireHistoryTexture(this.key, {
            label: 'temporal color history',
            format: 'rgba8unorm',
            extent: { width: this.width, height: 4 },
            mipLevelCount: this.mipLevelCount,
            usage: ['sampled', 'attachment'],
            bufferCount: 3
        });
        this.valid.push(history.valid);
        this.generations.push(history.generation);
        context.graph.addPass(this.pass, {
            ...(history.valid ? { input: history.history() } : {}),
            output: history.current
        });
        if (this.failAfterRecord) throw new Error('history frame failed');
    }

    destroy(): void {
        // The renderer owns and releases the history recipes.
    }
}

type PromisePassPhase = 'setup' | 'prepare' | 'execute';

interface PromisePassParameters {
    readonly attachment: Readonly<RenderPipelineColorAttachment>;
}

class PromisePass implements ScriptableRenderPass<PromisePassParameters> {
    readonly name: string;

    constructor(readonly phase: PromisePassPhase) {
        this.name = `Promise ${phase} pass`;
    }

    setup(builder: ScriptableRenderPassBuilder, parameters: PromisePassParameters): unknown {
        builder.useColorAttachment(parameters.attachment);
        return this.phase === 'setup' ? Promise.resolve() : undefined;
    }

    prepare(_context: ScriptableRenderPrepareContext, _parameters: PromisePassParameters): unknown {
        return this.phase === 'prepare' ? Promise.resolve() : undefined;
    }

    execute(_context: ScriptableRenderPassContext, _parameters: PromisePassParameters): unknown {
        return this.phase === 'execute' ? Promise.resolve() : undefined;
    }
}

class PromisePassPipeline implements RenderPipeline {
    readonly name = 'promise-pass-pipeline';
    readonly pass: PromisePass;

    constructor(phase: PromisePassPhase) {
        this.pass = new PromisePass(phase);
    }

    record(context: RenderPipelineContext): void {
        const output = context.graph.importOutput();
        context.graph.addPass(this.pass, {
            attachment: {
                texture: output.color(0),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: context.clearColor
            }
        });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

interface FacadeLeaseParameters {
    readonly attachment: Readonly<RenderPipelineColorAttachment>;
}

class FacadeLeasePass implements ScriptableRenderPass<FacadeLeaseParameters> {
    readonly name = 'Facade lease pass';
    retainedBuilder: ScriptableRenderPassBuilder | null = null;
    retainedPrepareContext: ScriptableRenderPrepareContext | null = null;
    retainedPassContext: ScriptableRenderPassContext | null = null;
    retainedCommands: ScriptableRenderCommands | null = null;
    setupLeaseChecks = 0;
    prepareLeaseChecks = 0;
    executeLeaseChecks = 0;

    setup(builder: ScriptableRenderPassBuilder, parameters: FacadeLeaseParameters): void {
        const retained = this.retainedBuilder;
        if (retained !== null) {
            expect(builder).not.toBe(retained);
            expect(() => {
                retained.markSideEffect();
            }).toThrow(/setup\(\) callback/u);
            this.setupLeaseChecks++;
        }
        this.retainedBuilder = builder;
        builder.useColorAttachment(parameters.attachment);
    }

    prepare(context: ScriptableRenderPrepareContext): void {
        const retained = this.retainedPrepareContext;
        if (retained !== null) {
            expect(context).not.toBe(retained);
            expect(() => retained.capabilities).toThrow(/prepare\(\) callback/u);
            this.prepareLeaseChecks++;
        }
        this.retainedPrepareContext = context;
    }

    execute(context: ScriptableRenderPassContext): void {
        const commands = context.commands;
        const retainedContext = this.retainedPassContext;
        const retainedCommands = this.retainedCommands;
        if (retainedContext !== null && retainedCommands !== null) {
            expect(context).not.toBe(retainedContext);
            expect(commands).not.toBe(retainedCommands);
            expect(() => retainedContext.commands).toThrow(/execute\(\) callback/u);
            expect(() => {
                retainedCommands.setStencilReference(0);
            }).toThrow(/execute\(\) callback/u);
            this.executeLeaseChecks++;
        }
        this.retainedPassContext = context;
        this.retainedCommands = commands;
    }
}

class FacadeLeasePipeline implements RenderPipeline {
    readonly name = 'facade-lease';
    readonly pass = new FacadeLeasePass();

    record(context: RenderPipelineContext): void {
        const output = context.graph.importOutput();
        context.graph.addPass(this.pass, {
            attachment: {
                texture: output.color(0),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: context.clearColor
            }
        });
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

class TestPipelineFactory implements RenderPipelineFactory {
    readonly name = 'test-pipeline';
    runtime: TestPipeline | null = null;

    create(_context: RenderPipelineCreateContext): RenderPipeline {
        this.runtime = new TestPipeline();
        return this.runtime;
    }
}

class CountingForwardFeatureRuntime implements ForwardRenderPipelineFeatureRuntime {
    recordCount = 0;
    destroyCount = 0;

    record(_context: ForwardRenderFeatureContext): void {
        this.recordCount++;
    }

    destroy(): void {
        this.destroyCount++;
    }
}

class CountingForwardFeature implements ForwardRenderPipelineFeature {
    readonly name = 'counting-feature';
    readonly injectionPoint = 'after-transparent' as const;
    readonly requirements = Object.freeze({
        sampledSceneColor: false,
        sampledDepth: false
    });
    readonly runtimes: CountingForwardFeatureRuntime[] = [];

    create(_context: RenderPipelineCreateContext): ForwardRenderPipelineFeatureRuntime {
        const runtime = new CountingForwardFeatureRuntime();
        this.runtimes.push(runtime);
        return runtime;
    }
}

class SampledColorFeatureRuntime implements ForwardRenderPipelineFeatureRuntime {
    readonly pass = new PresentRenderPass('Sampled forward feature');
    recordCount = 0;
    destroyCount = 0;

    record(context: ForwardRenderFeatureContext): void {
        const source = context.resources.color;
        if (source === null) throw new Error('Expected forward scene color');
        const filtered = context.pipeline.graph.createTexture('sampled feature color', {
            format: context.pipeline.output.colorFormat(0),
            extent: { relativeTo: 'output', scale: 1 }
        });
        context.pipeline.graph.addPass(this.pass, {
            inputTextures: [source],
            colorAttachments: [
                {
                    texture: filtered,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 }
                }
            ]
        });
        context.resources.replaceColor(filtered);
        this.recordCount++;
    }

    destroy(): void {
        this.destroyCount++;
    }
}

class SampledColorFeature implements ForwardRenderPipelineFeature {
    readonly name = 'sampled-color-feature';
    readonly injectionPoint = 'after-transparent' as const;
    readonly requirements = Object.freeze({
        sampledSceneColor: true,
        sampledDepth: false
    });
    runtime: SampledColorFeatureRuntime | null = null;

    create(_context: RenderPipelineCreateContext): ForwardRenderPipelineFeatureRuntime {
        this.runtime = new SampledColorFeatureRuntime();
        return this.runtime;
    }
}

class SharedCullingForwardFeatureRuntime implements ForwardRenderPipelineFeatureRuntime {
    readonly pass = new SceneRenderPass('Forward shared culling feature');
    retainedContext: ForwardRenderFeatureContext | null = null;
    recordCount = 0;
    destroyCount = 0;

    record(context: ForwardRenderFeatureContext): void {
        const color = context.resources.color;
        if (color === null) throw new Error('Expected forward scene color');
        const rendererList = context.pipeline.createRendererList({
            cullingResults: context.cullingResults,
            queue: 'all',
            sorting: 'material-front-to-back'
        });
        context.pipeline.graph.addPass(this.pass, {
            rendererList,
            colorAttachments: [
                {
                    texture: color,
                    loadOp: 'load',
                    storeOp: 'store'
                }
            ]
        });
        this.retainedContext = context;
        this.recordCount++;
    }

    destroy(): void {
        this.destroyCount++;
    }
}

class SharedCullingForwardFeature implements ForwardRenderPipelineFeature {
    readonly name = 'shared-culling-feature';
    readonly injectionPoint = 'after-transparent' as const;
    readonly requirements = Object.freeze({
        sampledSceneColor: false,
        sampledDepth: false
    });
    runtime: SharedCullingForwardFeatureRuntime | null = null;

    create(_context: RenderPipelineCreateContext): ForwardRenderPipelineFeatureRuntime {
        this.runtime = new SharedCullingForwardFeatureRuntime();
        return this.runtime;
    }
}

function captureRenderPassDescriptors(
    renderer: Renderer,
    descriptors: RHIRenderPassDescriptor[]
): void {
    const extension = renderer.getExtension('rhi') as {
        readonly device?: { readonly graphicsQueue: RHIQueue };
    } | null;
    if (extension?.device === undefined) throw new Error('Expected an RHI extension');
    const queue = extension.device.graphicsQueue;
    const beginFrame = queue.beginFrame.bind(queue);
    vi.spyOn(queue, 'beginFrame').mockImplementation(frameDescriptor => {
        const commands = beginFrame(frameDescriptor);
        const beginRenderPass = commands.beginRenderPass.bind(commands);
        vi.spyOn(commands, 'beginRenderPass').mockImplementation(descriptor => {
            descriptors.push({
                ...descriptor,
                colorAttachments: descriptor.colorAttachments.map(attachment => {
                    if (attachment === null) return null;
                    return attachment.clearValue === undefined
                        ? { ...attachment }
                        : { ...attachment, clearValue: { ...attachment.clearValue } };
                }),
                ...(descriptor.depthStencilAttachment === undefined
                    ? {}
                    : {
                          depthStencilAttachment: {
                              ...descriptor.depthStencilAttachment
                          }
                      })
            });
            return beginRenderPass(descriptor);
        });
        return commands;
    });
}

const activeRenderers: Renderer[] = [];

afterEach(() => {
    for (const renderer of activeRenderers.splice(0)) renderer.destroy();
});

describe('Scriptable render pipeline', () => {
    it('records culling, a renderer list and a scene pass through the shared graph/RHI path', async () => {
        const factory = new TestPipelineFactory();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 16,
            height: 8,
            antialias: false,
            renderPipeline: factory
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        scene.addChild(
            new Mesh({
                geometry: new BoxGeometry(),
                material: new BasicMaterial({ lightType: 'NONE', state: { depthTest: false } }),
                frustumTest: false
            })
        );
        const camera = new PerspectiveCamera();

        renderer.render(scene, camera);
        renderer.render(scene, camera);

        expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);
        expect(renderer.renderInfo.faceCount).toBeGreaterThan(0);
        expect(factory.runtime?.destroyCount).toBe(0);
        renderer.destroy();
        activeRenderers.pop();
        expect(factory.runtime?.destroyCount).toBe(1);
    });

    it('commits submitted pipeline state and discards only pre-submission failures', async () => {
        const runtime = new LifecycleSurfaceClearPipeline();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        const camera = new PerspectiveCamera();

        renderer.render(scene, camera);
        let completedSubmissionCallbackFrame = false;
        const completeSubmittedFrame = (): void => {
            completedSubmissionCallbackFrame = true;
        };
        renderer.on('afterRender', completeSubmittedFrame);
        runtime.failSubmissionCallback = true;
        expect(() => {
            renderer.render(scene, camera, true);
        }).toThrow(/lifecycle submission callback failed/u);
        runtime.failSubmissionCallback = false;
        renderer.off('afterRender', completeSubmittedFrame);
        expect(completedSubmissionCallbackFrame).toBe(true);

        const failAfterRender = (): void => {
            throw new Error('lifecycle after-render failed');
        };
        renderer.on('afterRender', failAfterRender);
        expect(() => {
            renderer.render(scene, camera, true);
        }).toThrow(/lifecycle after-render failed/u);
        renderer.off('afterRender', failAfterRender);

        runtime.failRecording = true;
        expect(() => {
            renderer.render(scene, camera);
        }).toThrow(/lifecycle recording failed/u);

        expect(runtime.submittedFrames).toEqual([0, 1, 2]);
        expect(runtime.discardedFrames).toEqual([3]);
    });

    it.skipIf(__HILO3D_GITHUB_ACTIONS_COVERAGE__)(
        'creates, writes and recovers pipeline-owned storage through the public SRP lifecycle',
        async () => {
            const factory = new PipelineOwnedStorageFactory();
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: document.createElement('canvas'),
                width: 4,
                height: 4,
                antialias: false,
                renderPipeline: factory
            });
            activeRenderers.push(renderer);
            const runtime = factory.runtime;
            if (runtime === null) throw new Error('Expected pipeline-owned storage runtime');

            renderer.render(new Node(), new PerspectiveCamera());
            await renderer.waitForIdle();
            const readback = await runtime.buffer.read();

            expect([...new Uint32Array(readback.data.buffer)]).toEqual([11, 12, 13, 14]);
            expect(runtime.submittedFrames).toEqual([0]);
            expect(runtime.discardedFrames).toEqual([]);

            runtime.importBeforeWrite = true;
            expect(() => {
                renderer.render(new Node(), new PerspectiveCamera());
            }).toThrow(/writes must occur before the buffer is imported/u);
            expect(runtime.submittedFrames).toEqual([0]);
            expect(runtime.discardedFrames).toHaveLength(1);
            expect(runtime.discardedFrames[0]).toBeGreaterThan(runtime.submittedFrames[0] ?? -1);

            renderer.destroy();
            activeRenderers.pop();
            expect(runtime.buffer.isDestroyed).toBe(true);
            expect(runtime.clear.destroyCount).toBe(1);
        }
    );

    it.skipIf(__HILO3D_GITHUB_ACTIONS_COVERAGE__)(
        'expands planner-owned instanced batches into ordered direct storage scene draws',
        async () => {
            const runtime = new InstancedStorageScenePipeline();
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: document.createElement('canvas'),
                width: 16,
                height: 8,
                antialias: false,
                renderPipeline: new FixedRuntimeFactory(runtime)
            });
            activeRenderers.push(renderer);
            runtime.buffer = renderer.createStorageBuffer({
                label: 'instanced storage scene values',
                byteLength: 16,
                usage: ['storage'],
                initialData: new Float32Array([1, 0.25, 0, 1])
            });
            const geometry = new BoxGeometry();
            const material = new BasicMaterial({
                lightType: 'NONE',
                state: { depthTest: false, depthWrite: false, cullMode: 'none' }
            });
            const first = new Mesh({ geometry, material, useInstanced: true, frustumTest: false });
            const second = new Mesh({ geometry, material, useInstanced: true, frustumTest: false });
            first.setPosition(-0.25, 0, 0);
            second.setPosition(0.25, 0, 0);
            const transparentGeometry = new BoxGeometry();
            const transparentMaterial = new BasicMaterial({
                lightType: 'NONE',
                compositing: { mode: 'alpha-blend', premultiplied: true },
                state: { depthTest: false, depthWrite: false, cullMode: 'none' }
            });
            const transparentFirst = new Mesh({
                geometry: transparentGeometry,
                material: transparentMaterial,
                useInstanced: true,
                frustumTest: false
            });
            const transparentSecond = new Mesh({
                geometry: transparentGeometry,
                material: transparentMaterial,
                useInstanced: true,
                frustumTest: false
            });
            const scene = new Node();
            scene.addChild(first);
            scene.addChild(second);
            scene.addChild(transparentFirst);
            scene.addChild(transparentSecond);
            const prepareStorageScene = vi.spyOn(
                MeshDrawProcessor.prototype,
                'prepareStorageScene'
            );

            renderer.render(scene, new PerspectiveCamera());
            renderer.render(scene, new PerspectiveCamera());
            await renderer.waitForIdle();

            expect(prepareStorageScene).toHaveBeenCalledTimes(8);
            expect(prepareStorageScene.mock.calls.slice(4).map(call => call[0])).toEqual([
                first,
                second,
                transparentFirst,
                transparentSecond
            ]);
            expect(prepareStorageScene.mock.calls.every(call => call[6] === true)).toBe(true);
            expect(renderer.renderInfo.drawCount).toBe(4);
            expect(renderer.renderInfo.faceCount).toBeGreaterThan(0);
            prepareStorageScene.mockRestore();
        }
    );

    it('resolves texture-copy handles during setup and emits only the declared copy in execute', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 4,
            antialias: false,
            renderPipeline: new CopyPipelineFactory()
        });
        activeRenderers.push(renderer);
        const target = renderer.createRenderTarget({
            width: 8,
            height: 4,
            depthStencilAttachment: false
        });

        renderer.setRenderTarget(target);
        renderer.render(new Node(), new PerspectiveCamera());
        renderer.setRenderTarget(null);

        expect(renderer.isReady).toBe(true);
        target.destroy();
    });

    it('infers transient buffer usages and resolves a declared copy before execution', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 4,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(new BufferCopyPipeline())
        });
        activeRenderers.push(renderer);

        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).not.toThrow();
        expect(renderer.renderInfo.drawCount).toBe(0);
    });

    it('rejects WebGPU-only buffer clear declarations before beginning a WebGL 2 frame', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 4,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(new BufferClearPipeline())
        });
        activeRenderers.push(renderer);
        const extension = renderer.getExtension('rhi') as {
            readonly device?: { readonly graphicsQueue: { beginFrame(): unknown } };
        } | null;
        if (extension?.device === undefined) throw new Error('Expected an RHI extension');
        const beginFrame = vi.spyOn(extension.device.graphicsQueue, 'beginFrame');

        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).toThrow(/Buffer clear is supported only by WebGPU/u);
        expect(beginFrame).not.toHaveBeenCalled();
    });

    it('rejects ComputeRenderPass on WebGL 2 before beginning an RHI frame', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 4,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(new WebGLComputePipeline())
        });
        activeRenderers.push(renderer);
        const extension = renderer.getExtension('rhi') as {
            readonly device?: { readonly graphicsQueue: { beginFrame(): unknown } };
        } | null;
        if (extension?.device === undefined) throw new Error('Expected an RHI extension');
        const beginFrame = vi.spyOn(extension.device.graphicsQueue, 'beginFrame');

        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).toThrow(/ComputeRenderPass.*only.*WebGPU/u);
        expect(beginFrame).not.toHaveBeenCalled();
    });

    it('dispatches ComputeRenderPass through the shared graph and reads exact WebGPU results', async () => {
        const runtime = new LiveComputePipeline();
        const renderer = await Renderer.create({
            backend: 'webgpu',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 4,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        runtime.buffer = renderer.createStorageBuffer({
            label: 'live compute output',
            byteLength: 16,
            usage: ['storage', 'copy-source']
        });

        renderer.render(new Node(), new PerspectiveCamera());
        await renderer.waitForIdle();
        const result = await runtime.buffer.read();

        expect([...new Uint32Array(result.data.buffer)]).toEqual([7, 8, 9, 10]);
        expect(renderer.renderInfo.drawCount).toBe(0);
    });

    it('rejects multi-mip storage texture views before beginning an RHI frame', async () => {
        const renderer = await Renderer.create({
            backend: 'webgpu',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 4,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(new InvalidStorageTextureMipPipeline())
        });
        activeRenderers.push(renderer);
        const extension = renderer.getExtension('rhi') as {
            readonly device?: { readonly graphicsQueue: { beginFrame(): unknown } };
        } | null;
        if (extension?.device === undefined) throw new Error('Expected an RHI extension');
        const beginFrame = vi.spyOn(extension.device.graphicsQueue, 'beginFrame');

        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).toThrow(/storage writes require one complete single-sample 2d mip subresource/u);
        expect(beginFrame).not.toHaveBeenCalled();
    });

    it('binds one explicit mip view as a real WebGPU storage texture', async () => {
        const renderer = await Renderer.create({
            backend: 'webgpu',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(new StorageTextureMipViewPipeline())
        });
        activeRenderers.push(renderer);

        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).not.toThrow();
        await renderer.waitForIdle();
    });

    it('keeps sampled depth reads independent from COPY_SRC usage', async () => {
        const runtime = new SampledDepthPipeline();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 4,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const target = renderer.createRenderTarget({
            width: 8,
            height: 4,
            colorAttachments: [],
            depthStencilAttachment: { format: 'depth24plus', sampled: true }
        });
        runtime.target = target;

        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).not.toThrow();

        target.destroy();
    });

    it.each(['extent', 'format', 'sample-count'] as const)(
        'rejects invalid texture-copy %s before beginning an RHI frame',
        async mode => {
            const renderer = await Renderer.create({
                backend: 'webgl2',
                domElement: document.createElement('canvas'),
                width: 8,
                height: 4,
                antialias: false,
                renderPipeline: new FixedRuntimeFactory(new InvalidCopyPipeline(mode))
            });
            activeRenderers.push(renderer);
            const extension = renderer.getExtension('rhi') as {
                readonly device?: { readonly graphicsQueue: { beginFrame(): unknown } };
            } | null;
            if (extension?.device === undefined) throw new Error('Expected an RHI extension');
            const beginFrame = vi.spyOn(extension.device.graphicsQueue, 'beginFrame');
            const target = renderer.createRenderTarget({
                width: 8,
                height: 4,
                depthStencilAttachment: false
            });
            renderer.setRenderTarget(target);

            expect(() => {
                renderer.render(new Node(), new PerspectiveCamera());
            }).toThrow(/Texture copy|texture sample count|sample counts/u);
            expect(beginFrame).not.toHaveBeenCalled();
            renderer.setRenderTarget(null);
            target.destroy();
        }
    );

    it('treats an explicit resolve target as the terminal output writer', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 4,
            antialias: true,
            renderPipeline: new FixedRuntimeFactory(new ExplicitResolvePipeline())
        });
        activeRenderers.push(renderer);

        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).not.toThrow();
        expect(renderer.renderInfo.drawCount).toBe(0);
    });

    it.each(['sampled', 'copy-source'] as const)(
        'keeps the MSAA surface resolve identity for a later %s access',
        async mode => {
            const renderer = await Renderer.create({
                backend: 'webgl2',
                domElement: document.createElement('canvas'),
                width: 8,
                height: 4,
                antialias: true,
                renderPipeline: new FixedRuntimeFactory(new MsaaOutputFollowupPipeline(mode))
            });
            activeRenderers.push(renderer);

            expect(() => {
                renderer.render(new Node(), new PerspectiveCamera());
            }).toThrow(/imported texture scriptable surface color lacks usage/u);
        }
    );

    it('does not count a read-only depth-only attachment as terminal work', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 4,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(new ReadOnlyDepthPipeline())
        });
        activeRenderers.push(renderer);
        const target = renderer.createRenderTarget({
            width: 8,
            height: 4,
            colorAttachments: [],
            depthStencilAttachment: { format: 'depth24plus-stencil8' }
        });
        const extension = renderer.getExtension('rhi') as {
            readonly device?: { readonly graphicsQueue: { beginFrame(): unknown } };
        } | null;
        if (extension?.device === undefined) throw new Error('Expected an RHI extension');
        const beginFrame = vi.spyOn(extension.device.graphicsQueue, 'beginFrame');
        renderer.setRenderTarget(target);

        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).toThrow(/must write an output\/persistent target/u);
        expect(beginFrame).not.toHaveBeenCalled();

        renderer.setRenderTarget(null);
        target.destroy();
    });

    it('rejects attaching one runtime to two renderers without destroying the first owner', async () => {
        const runtime = new SurfaceClearPipeline();
        const factory = new FixedRuntimeFactory(runtime);
        const first = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            renderPipeline: factory
        });
        activeRenderers.push(first);

        await expect(
            Renderer.create({
                backend: 'webgl2',
                domElement: document.createElement('canvas'),
                width: 4,
                height: 4,
                renderPipeline: factory
            })
        ).rejects.toThrow(/already attached/u);
        expect(runtime.destroyCount).toBe(0);
        first.render(new Node(), new PerspectiveCamera());
    });

    it('checks runtime ownership before validating or cleaning up an attached singleton', async () => {
        const runtime = new SurfaceClearPipeline();
        const factory = new FixedRuntimeFactory(runtime);
        const first = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            renderPipeline: factory
        });
        activeRenderers.push(first);
        Reflect.set(runtime, 'record', null);

        await expect(
            Renderer.create({
                backend: 'webgl2',
                domElement: document.createElement('canvas'),
                width: 4,
                height: 4,
                renderPipeline: factory
            })
        ).rejects.toThrow(/already attached/u);
        expect(runtime.destroyCount).toBe(0);

        Reflect.deleteProperty(runtime, 'record');
        first.render(new Node(), new PerspectiveCamera());
    });

    it('samples a transient graph texture in prepare and presents a fullscreen triangle', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 4,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(new FullscreenPresentPipeline())
        });
        activeRenderers.push(renderer);

        renderer.render(new Node(), new PerspectiveCamera());
        renderer.render(new Node(), new PerspectiveCamera());

        expect(renderer.renderInfo.drawCount).toBe(1);
    });

    it('schedules public mip views independently and rejects overlapping feedback', async () => {
        const runtime = new SubresourceViewPipeline();
        const renderer = await Renderer.create({
            backend: 'webgpu',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);

        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).not.toThrow();
        runtime.overlap = true;
        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).toThrow(/overlaps|feedback|duplicate|same-pass/u);
    });

    it('commits history rotation and descriptor generations only after successful frames', async () => {
        const runtime = new HistoryTexturePipeline();
        const renderer = await Renderer.create({
            backend: 'webgpu',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        const camera = new PerspectiveCamera();

        renderer.render(scene, camera);
        renderer.render(scene, camera);
        expect(runtime.valid).toEqual([false, true]);
        expect(runtime.generations[1]).toBe(runtime.generations[0]);

        runtime.width = 8;
        runtime.failAfterRecord = true;
        expect(() => {
            renderer.render(scene, camera);
        }).toThrow(/history frame failed/u);
        const failedGeneration = runtime.generations[2];

        runtime.width = 4;
        runtime.failAfterRecord = false;
        renderer.render(scene, camera);
        expect(runtime.valid[3]).toBe(true);
        expect(runtime.generations[3]).toBe(runtime.generations[1]);
        expect(failedGeneration).toBe((runtime.generations[1] ?? 0) + 1);

        runtime.mipLevelCount = 2;
        expect(() => {
            renderer.render(scene, camera);
        }).toThrow(/one single-sample 2D color mip and array layer/u);
    });

    it('commits persistent target descriptor changes only after successful submission', async () => {
        const runtime = new PersistentTargetPipeline();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const cache = (
            renderer as Renderer & { readonly renderTargetResources: RenderTargetResourceCache }
        ).renderTargetResources;

        renderer.render(new Node(), new PerspectiveCamera());
        expect(cache.metrics.size).toBe(1);

        runtime.width = 8;
        runtime.failAfterRecord = true;
        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).toThrow(/persistent frame failed/u);
        expect(cache.metrics.size).toBe(1);
        const missesAfterFailure = cache.metrics.misses;

        runtime.width = 4;
        runtime.failAfterRecord = false;
        renderer.render(new Node(), new PerspectiveCamera());

        expect(cache.metrics.misses).toBe(missesAfterFailure);
        expect(cache.metrics.size).toBe(1);
    });

    it('commits a submitted persistent target when an after-render listener fails', async () => {
        const runtime = new PersistentTargetPipeline();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const cache = (
            renderer as Renderer & { readonly renderTargetResources: RenderTargetResourceCache }
        ).renderTargetResources;
        const scene = new Node();
        const camera = new PerspectiveCamera();
        renderer.render(scene, camera);

        runtime.width = 8;
        const failAfterRender = (): void => {
            throw new Error('after-render listener failed');
        };
        renderer.on('afterRender', failAfterRender);
        expect(() => {
            renderer.render(scene, camera, true);
        }).toThrow(/after-render listener failed/u);
        renderer.off('afterRender', failAfterRender);
        const missesAfterSubmittedFailure = cache.metrics.misses;

        renderer.render(scene, camera);

        expect(cache.metrics.misses).toBe(missesAfterSubmittedFailure);
        expect(cache.metrics.size).toBe(1);
    });

    it('rebuilds persistent targets after explicit renderer resource release', async () => {
        const runtime = new PersistentTargetPipeline();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const rendererWithCache = renderer as Renderer & {
            readonly renderTargetResources: RenderTargetResourceCache;
        };
        const originalCache = rendererWithCache.renderTargetResources;
        renderer.render(new Node(), new PerspectiveCamera());

        renderer.releaseGPUResources();
        const replacementCache = rendererWithCache.renderTargetResources;
        renderer.render(new Node(), new PerspectiveCamera());

        expect(replacementCache).not.toBe(originalCache);
        expect(replacementCache.metrics.size).toBe(1);
    });

    it('rejects Promise-returning record callbacks before beginning an RHI frame', async () => {
        const runtime: RenderPipeline = {
            name: 'async-record',
            record(_context: RenderPipelineContext): Promise<void> {
                return Promise.resolve();
            },
            destroy(): void {
                // No renderer-local resources.
            }
        };
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const extension = renderer.getExtension('rhi') as {
            readonly device?: { readonly graphicsQueue: { beginFrame(): unknown } };
        } | null;
        if (extension?.device === undefined) throw new Error('Expected an RHI extension');
        const beginFrame = vi.spyOn(extension.device.graphicsQueue, 'beginFrame');

        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).toThrow(/record\(\) must be synchronous/u);
        expect(beginFrame).not.toHaveBeenCalled();
    });

    it.each([
        ['setup', false],
        ['prepare', false],
        ['execute', true]
    ] as const)(
        'rejects Promise-returning %s callbacks at the correct RHI boundary',
        async (phase, beginsRHIFrame) => {
            const renderer = await Renderer.create({
                backend: 'webgl2',
                domElement: document.createElement('canvas'),
                width: 4,
                height: 4,
                antialias: false,
                renderPipeline: new FixedRuntimeFactory(new PromisePassPipeline(phase))
            });
            activeRenderers.push(renderer);
            const extension = renderer.getExtension('rhi') as {
                readonly device?: { readonly graphicsQueue: { beginFrame(): unknown } };
            } | null;
            if (extension?.device === undefined) throw new Error('Expected an RHI extension');
            const beginFrame = vi.spyOn(extension.device.graphicsQueue, 'beginFrame');

            expect(() => {
                renderer.render(new Node(), new PerspectiveCamera());
            }).toThrow(new RegExp(`${phase}\\(\\) must be synchronous`, 'u'));
            expect(beginFrame).toHaveBeenCalledTimes(beginsRHIFrame ? 1 : 0);
        }
    );

    it('snapshots a factory create callback before asynchronous backend resolution', async () => {
        const originalCreate = vi.fn(
            (_context: RenderPipelineCreateContext): RenderPipeline => new SurfaceClearPipeline()
        );
        const replacementCreate = vi.fn(
            (_context: RenderPipelineCreateContext): RenderPipeline => new SurfaceClearPipeline()
        );
        const factory = { name: 'mutable-create', create: originalCreate };

        const pendingRenderer = Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            renderPipeline: factory
        });
        factory.create = replacementCreate;
        const renderer = await pendingRenderer;
        activeRenderers.push(renderer);

        expect(originalCreate).toHaveBeenCalledOnce();
        expect(replacementCreate).not.toHaveBeenCalled();
        renderer.render(new Node(), new PerspectiveCamera());
    });

    it('invalidates a retained context as soon as record returns', async () => {
        let retained: RenderPipelineContext | null = null;
        let retainedOutput: RenderPipelineContext['output'] | null = null;
        let retainedGraph: RenderPipelineContext['graph'] | null = null;
        let retainedClearColor: RenderPipelineContext['clearColor'] | null = null;
        let retainedViewport: RenderPipelineContext['viewport'] | null = null;
        let retainedTarget: RenderPipelineTargetResources | null = null;
        let retainedOutputColor: ReturnType<
            RenderPipelineContext['output']['colorAttachment']
        > | null = null;
        let retainedOutputClearColor: Readonly<
            ReturnType<RenderPipelineContext['output']['colorAttachment']>['clearValue']
        > | null = null;
        let retainedOutputDepth: NonNullable<
            RenderPipelineContext['output']['depthStencilAttachment']
        > | null = null;
        let checkedDuringNextInvocation = false;
        const runtime = new SurfaceClearPipeline();
        const record = runtime.record.bind(runtime);
        runtime.record = (context: RenderPipelineContext): void => {
            if (retained === null) {
                retained = context;
                retainedOutput = context.output;
                retainedGraph = context.graph;
                retainedClearColor = context.clearColor;
                retainedViewport = context.viewport;
                retainedTarget = context.graph.importOutput();
                retainedOutputColor = context.output.colorAttachment(0);
                retainedOutputClearColor = retainedOutputColor.clearValue;
                retainedOutputDepth = context.output.depthStencilAttachment;
            } else {
                checkedDuringNextInvocation = true;
                expect(context).not.toBe(retained);
                expect(context.output).not.toBe(retainedOutput);
                expect(context.graph).not.toBe(retainedGraph);
                expect(context.clearColor).not.toBe(retainedClearColor);
                expect(Object.is(context.viewport, retainedViewport)).toBe(false);
                expect(context.graph.importOutput()).not.toBe(retainedTarget);
                expect(() => retained?.cull()).toThrow(/valid only during synchronous record/u);
                expect(() => retainedOutput?.width).toThrow(
                    /valid only during synchronous record/u
                );
                expect(() =>
                    retainedGraph?.createTexture('stale texture', {
                        format: 'rgba8unorm',
                        extent: { width: 1, height: 1 }
                    })
                ).toThrow(/valid only during synchronous record/u);
                expect(() => retainedClearColor?.r).toThrow(
                    /valid only during synchronous record/u
                );
                expect(() => retainedViewport?.[0]).toThrow(
                    /valid only during synchronous record/u
                );
                expect(() => retainedTarget?.width).toThrow(
                    /valid only during synchronous record/u
                );
                expect(() => retainedOutputColor?.loadOp).toThrow(
                    /valid only during synchronous record/u
                );
                expect(() => retainedOutputClearColor?.r).toThrow(
                    /valid only during synchronous record/u
                );
                expect(() => retainedOutputDepth?.depthLoadOp).toThrow(
                    /valid only during synchronous record/u
                );
            }
            record(context);
        };
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);

        renderer.render(new Node(), new PerspectiveCamera());

        const escaped = retained as RenderPipelineContext | null;
        if (escaped === null) throw new Error('Expected a retained pipeline context');
        expect(() => escaped.cull()).toThrow(/valid only during synchronous record/u);
        expect(() => escaped.scene).toThrow(/valid only during synchronous record/u);
        expect(() => escaped.output.colorFormat(0)).toThrow(
            /valid only during synchronous record/u
        );
        const output = retainedOutput as RenderPipelineContext['output'] | null;
        const graph = retainedGraph as RenderPipelineContext['graph'] | null;
        const clearColor = retainedClearColor as RenderPipelineContext['clearColor'] | null;
        const viewport = retainedViewport as RenderPipelineContext['viewport'] | null;
        const target = retainedTarget as RenderPipelineTargetResources | null;
        const outputColor = retainedOutputColor as ReturnType<
            RenderPipelineContext['output']['colorAttachment']
        > | null;
        const outputClearColor = retainedOutputClearColor as Readonly<
            ReturnType<RenderPipelineContext['output']['colorAttachment']>['clearValue']
        > | null;
        const outputDepth = retainedOutputDepth as NonNullable<
            RenderPipelineContext['output']['depthStencilAttachment']
        > | null;
        if (
            output === null ||
            graph === null ||
            clearColor === null ||
            viewport === null ||
            target === null ||
            outputColor === null ||
            outputClearColor === null ||
            outputDepth === null
        ) {
            throw new Error('Expected retained nested pipeline facades');
        }
        expect(() => output.width).toThrow(/valid only during synchronous record/u);
        expect(() =>
            graph.createTexture('stale texture', {
                format: 'rgba8unorm',
                extent: { width: 1, height: 1 }
            })
        ).toThrow(/valid only during synchronous record/u);
        expect(() => output.colorAttachment(0)).toThrow(/valid only during synchronous record/u);
        expect(() => outputColor.loadOp).toThrow(/valid only during synchronous record/u);
        expect(() => outputColor.clearValue.r).toThrow(/valid only during synchronous record/u);
        expect(() => outputDepth.depthLoadOp).toThrow(/valid only during synchronous record/u);
        expect(() => clearColor.r).toThrow(/valid only during synchronous record/u);
        expect(() => viewport[0]).toThrow(/valid only during synchronous record/u);
        expect(() => target.width).toThrow(/valid only during synchronous record/u);
        expect(Object.isFrozen(output)).toBe(true);
        expect(Object.isFrozen(graph)).toBe(true);
        expect(Object.isFrozen(outputColor)).toBe(true);
        expect(Object.isFrozen(outputClearColor)).toBe(true);
        expect(Object.isFrozen(outputDepth)).toBe(true);
        expect(Object.isFrozen(clearColor)).toBe(true);
        expect(Object.isFrozen(viewport)).toBe(true);
        expect(Object.isFrozen(target)).toBe(true);
        expect(Reflect.set(output, 'width', 99)).toBe(false);

        renderer.render(new Node(), new PerspectiveCamera());
        expect(checkedDuringNextInvocation).toBe(true);
    });

    it('does not revive retained pass callback facades when a slot is reused', async () => {
        const runtime = new FacadeLeasePipeline();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        const camera = new PerspectiveCamera();

        renderer.render(scene, camera);

        const builder = runtime.pass.retainedBuilder;
        const prepareContext = runtime.pass.retainedPrepareContext;
        const passContext = runtime.pass.retainedPassContext;
        const commands = runtime.pass.retainedCommands;
        if (
            builder === null ||
            prepareContext === null ||
            passContext === null ||
            commands === null
        ) {
            throw new Error('Expected retained scriptable pass callback facades');
        }
        expect(() => {
            builder.markSideEffect();
        }).toThrow(/setup\(\) callback/u);
        expect(() => prepareContext.capabilities).toThrow(/prepare\(\) callback/u);
        expect(() => passContext.commands).toThrow(/execute\(\) callback/u);
        expect(() => {
            commands.setStencilReference(0);
        }).toThrow(/execute\(\) callback/u);
        expect(Object.isFrozen(builder)).toBe(true);
        expect(Object.isFrozen(prepareContext)).toBe(true);
        expect(Object.isFrozen(passContext)).toBe(true);
        expect(Object.isFrozen(commands)).toBe(true);

        renderer.render(scene, camera);

        expect(runtime.pass.setupLeaseChecks).toBe(1);
        expect(runtime.pass.prepareLeaseChecks).toBe(1);
        expect(runtime.pass.executeLeaseChecks).toBe(1);
    });

    it('validates future compute requirements before invoking the factory', async () => {
        const create = vi.fn((_context: RenderPipelineCreateContext): RenderPipeline => {
            return new SurfaceClearPipeline();
        });
        const factory: RenderPipelineFactory = {
            name: 'compute-required',
            requirements: { requiredCapabilities: ['compute-pass'] },
            create
        };

        await expect(
            Renderer.create({
                backend: 'webgl2',
                domElement: document.createElement('canvas'),
                width: 4,
                height: 4,
                renderPipeline: factory
            })
        ).rejects.toThrow(/compute-pass requires WebGPU/u);
        expect(create).not.toHaveBeenCalled();
    });

    it('merges forward feature capabilities before creating feature runtimes', async () => {
        const create = vi.fn(
            (_context: RenderPipelineCreateContext): ForwardRenderPipelineFeatureRuntime =>
                new CountingForwardFeatureRuntime()
        );
        const feature: ForwardRenderPipelineFeature = {
            name: 'compute-forward-feature',
            injectionPoint: 'before-opaque',
            requirements: {
                sampledSceneColor: false,
                sampledDepth: false,
                requiredCapabilities: ['compute-pass']
            },
            create
        };
        const factory = new ForwardRenderPipelineFactory({ features: [feature] });

        expect(factory.requirements.requiredCapabilities).toEqual(['compute-pass']);
        await expect(
            Renderer.create({
                backend: 'webgl2',
                domElement: document.createElement('canvas'),
                width: 4,
                height: 4,
                renderPipeline: factory
            })
        ).rejects.toThrow(/compute-pass requires WebGPU/u);
        expect(create).not.toHaveBeenCalled();
    });

    it('finishes renderer cleanup when the user runtime destroy method throws', async () => {
        const runtime = new SurfaceClearPipeline();
        runtime.destroy = (): void => {
            runtime.destroyCount++;
            throw new Error('user destroy failed');
        };
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const extension = renderer.getExtension('rhi') as {
            readonly device?: { readonly destroyed: boolean };
        } | null;
        if (extension?.device === undefined) throw new Error('Expected an RHI extension');
        const device = extension.device;

        expect(() => {
            renderer.destroy();
        }).toThrow(/failed while destroying owned resources/u);
        activeRenderers.pop();
        expect(runtime.destroyCount).toBe(1);
        expect(device.destroyed).toBe(true);
    });

    it('records non-sampling forward features without replacing the direct output', async () => {
        const feature = new CountingForwardFeature();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false,
            renderPipeline: new ForwardRenderPipelineFactory({ features: [feature] })
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        scene.addChild(
            new Mesh({
                geometry: new BoxGeometry(),
                material: new BasicMaterial({ lightType: 'NONE', state: { depthTest: false } }),
                frustumTest: false
            })
        );

        renderer.render(scene, new PerspectiveCamera());
        renderer.render(scene, new PerspectiveCamera());

        expect(feature.runtimes).toHaveLength(1);
        expect(feature.runtimes[0]?.recordCount).toBe(2);
        expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);
    });

    it('preserves selected RenderTarget color, depth and stencil attachment operations', async () => {
        const feature = new CountingForwardFeature();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false,
            renderPipeline: new ForwardRenderPipelineFactory({ features: [feature] })
        });
        activeRenderers.push(renderer);
        const target = renderer.createRenderTarget({
            width: 8,
            height: 8,
            colorAttachments: [
                {
                    clearValue: { r: 0.125, g: 0.25, b: 0.5, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store'
                },
                {
                    clearValue: { r: 0.75, g: 0.5, b: 0.25, a: 1 },
                    loadOp: 'load',
                    storeOp: 'discard'
                }
            ],
            depthStencilAttachment: {
                format: 'depth24plus-stencil8',
                depthClearValue: 0.375,
                depthLoadOp: 'clear',
                depthStoreOp: 'discard',
                stencilClearValue: 9,
                stencilLoadOp: 'load',
                stencilStoreOp: 'store'
            }
        });
        const descriptors: RHIRenderPassDescriptor[] = [];
        captureRenderPassDescriptors(renderer, descriptors);
        renderer.setRenderTarget(target);

        renderer.render(new Node(), new PerspectiveCamera());

        const descriptor = descriptors.find(candidate => candidate.label === 'Forward scene');
        expect(descriptor?.colorAttachments[0]).toMatchObject({
            clearValue: { r: 0.125, g: 0.25, b: 0.5, a: 1 },
            loadOp: 'clear',
            storeOp: 'store'
        });
        expect(descriptor?.colorAttachments[1]).toMatchObject({
            loadOp: 'load',
            storeOp: 'discard'
        });
        expect(descriptor?.colorAttachments[1]?.clearValue).toBeUndefined();
        expect(descriptor?.depthStencilAttachment).toMatchObject({
            depthClearValue: 0.375,
            depthLoadOp: 'clear',
            depthStoreOp: 'discard',
            stencilClearValue: 9,
            stencilLoadOp: 'load',
            stencilStoreOp: 'store'
        });

        renderer.setRenderTarget(null);
        target.destroy();
    });

    it('loads selected RenderTarget color into an intermediate sampled scene color', async () => {
        const feature = new SampledColorFeature();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false,
            renderPipeline: new ForwardRenderPipelineFactory({ features: [feature] })
        });
        activeRenderers.push(renderer);
        const target = renderer.createRenderTarget({
            width: 8,
            height: 8,
            colorAttachments: [{ loadOp: 'load', storeOp: 'store' }],
            depthStencilAttachment: false
        });
        const descriptors: RHIRenderPassDescriptor[] = [];
        captureRenderPassDescriptors(renderer, descriptors);
        renderer.setRenderTarget(target);

        renderer.render(new Node(), new PerspectiveCamera());

        const loadIndex = descriptors.findIndex(
            descriptor => descriptor.label === 'Forward output load'
        );
        const sceneIndex = descriptors.findIndex(
            descriptor => descriptor.label === 'Forward scene'
        );
        const outputIndex = descriptors.findIndex(
            descriptor => descriptor.label === 'Forward output'
        );
        expect(loadIndex).toBeGreaterThanOrEqual(0);
        expect(sceneIndex).toBeGreaterThan(loadIndex);
        expect(outputIndex).toBeGreaterThan(sceneIndex);
        expect(descriptors[sceneIndex]?.colorAttachments[0]).toMatchObject({
            loadOp: 'load',
            storeOp: 'store'
        });
        expect(descriptors[outputIndex]?.colorAttachments[0]).toMatchObject({
            loadOp: 'load',
            storeOp: 'store'
        });

        renderer.setRenderTarget(null);
        target.destroy();
    });

    it('reuses the shared shadow atlas and restores its LightBlock before scene draws', async () => {
        const feature = new CountingForwardFeature();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 16,
            height: 8,
            antialias: false,
            renderPipeline: new ForwardRenderPipelineFactory({ features: [feature] })
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        scene.addChild(
            new Mesh({
                geometry: new BoxGeometry(),
                material: new BasicMaterial(),
                frustumTest: false
            })
        );
        const target = new Vector3(0, 0, 0);
        const light = new DirectionalLight({ shadow: { width: 8, height: 8 } });
        light.setPosition(2, 4, 3).lookAt(target);
        scene.addChild(light);
        const camera = new PerspectiveCamera({ near: 0.1, far: 100, aspect: 2 });
        camera.setPosition(0, 1, 5).lookAt(target);

        renderer.render(scene, camera);
        renderer.render(scene, camera);

        expect(renderer.lightManager.shadowAtlas).not.toBeNull();
        expect(renderer.renderInfo.drawCount).toBeGreaterThanOrEqual(2);
    });

    it('lets a feature create scene passes from the exact built-in shadow culling results', async () => {
        const feature = new SharedCullingForwardFeature();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 16,
            height: 8,
            antialias: false,
            renderPipeline: new ForwardRenderPipelineFactory({ features: [feature] })
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        scene.addChild(
            new Mesh({
                geometry: new BoxGeometry(),
                material: new BasicMaterial({ state: { depthTest: false, depthWrite: false } }),
                frustumTest: false
            })
        );
        const target = new Vector3(0, 0, 0);
        const light = new DirectionalLight({ shadow: { width: 8, height: 8 } });
        light.setPosition(2, 4, 3).lookAt(target);
        scene.addChild(light);
        const camera = new PerspectiveCamera({ near: 0.1, far: 100, aspect: 2 });
        camera.setPosition(0, 1, 5).lookAt(target);
        const descriptors: RHIRenderPassDescriptor[] = [];
        captureRenderPassDescriptors(renderer, descriptors);

        expect(() => {
            renderer.render(scene, camera);
        }).not.toThrow();
        expect(feature.runtime?.recordCount).toBe(1);
        expect(
            descriptors.some(descriptor => descriptor.label === 'Forward shared culling feature')
        ).toBe(true);
        const retained = feature.runtime?.retainedContext;
        if (retained === null || retained === undefined) {
            throw new Error('Expected retained forward feature context');
        }
        expect(() => retained.cullingResults).toThrow(/valid only during synchronous record/u);
    });

    it('does not revive a retained forward feature facade in a later callback', async () => {
        let retainedContext: ForwardRenderFeatureContext | null = null;
        let retainedResources: ForwardRenderFeatureContext['resources'] | null = null;
        let checkCount = 0;
        const requirements = Object.freeze({
            sampledSceneColor: false,
            sampledDepth: false
        });
        const retainingFeature: ForwardRenderPipelineFeature = {
            name: 'retaining-forward-facade',
            injectionPoint: 'after-transparent',
            requirements,
            create(): ForwardRenderPipelineFeatureRuntime {
                return {
                    record(context: ForwardRenderFeatureContext): void {
                        retainedContext ??= context;
                        retainedResources ??= context.resources;
                    },
                    destroy(): void {
                        // No renderer-local resources.
                    }
                };
            }
        };
        const checkingFeature: ForwardRenderPipelineFeature = {
            name: 'checking-forward-facade',
            injectionPoint: 'after-transparent',
            requirements,
            create(): ForwardRenderPipelineFeatureRuntime {
                return {
                    record(context: ForwardRenderFeatureContext): void {
                        const retained = retainedContext;
                        const resources = retainedResources;
                        if (retained === null || resources === null) {
                            throw new Error('Expected a retained forward feature facade');
                        }
                        expect(context).not.toBe(retained);
                        expect(context.resources).not.toBe(resources);
                        expect(() => retained.pipeline).toThrow(
                            /valid only during synchronous record/u
                        );
                        expect(() => retained.cullingResults).toThrow(
                            /valid only during synchronous record/u
                        );
                        expect(() => retained.resources).toThrow(
                            /valid only during synchronous record/u
                        );
                        expect(() => resources.color).toThrow(
                            /valid only during synchronous record/u
                        );
                        checkCount++;
                    },
                    destroy(): void {
                        // No renderer-local resources.
                    }
                };
            }
        };
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 4,
            antialias: false,
            renderPipeline: new ForwardRenderPipelineFactory({
                features: [retainingFeature, checkingFeature]
            })
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        const camera = new PerspectiveCamera();

        renderer.render(scene, camera);
        renderer.render(scene, camera);

        expect(checkCount).toBe(2);
        expect(Object.isFrozen(retainedContext)).toBe(true);
        expect(Object.isFrozen(retainedResources)).toBe(true);
    });

    it('detaches the previous shared shadow atlas when a later invocation omits shadows', async () => {
        const runtime = new ConditionalShadowPipeline();
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 16,
            height: 8,
            antialias: false,
            renderPipeline: new FixedRuntimeFactory(runtime)
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        scene.addChild(
            new Mesh({
                geometry: new BoxGeometry(),
                material: new BasicMaterial(),
                receiveShadows: false,
                frustumTest: false
            })
        );
        const target = new Vector3(0, 0, 0);
        const light = new DirectionalLight({ shadow: { width: 8, height: 8 } });
        light.setPosition(2, 4, 3).lookAt(target);
        scene.addChild(light);
        const camera = new PerspectiveCamera({ near: 0.1, far: 100, aspect: 2 });
        camera.setPosition(0, 1, 5).lookAt(target);

        renderer.render(scene, camera);
        expect(renderer.lightManager.shadowAtlas).not.toBeNull();

        runtime.recordSharedShadows = false;
        renderer.render(scene, camera);

        expect(renderer.lightManager.shadowAtlas).toBeNull();
    });

    it.each([false, true])(
        'samples forward scene color and presents the replacement with antialias=%s',
        async antialias => {
            const feature = new SampledColorFeature();
            const renderer = await Renderer.create({
                backend: 'webgl2',
                domElement: document.createElement('canvas'),
                width: 8,
                height: 8,
                antialias,
                renderPipeline: new ForwardRenderPipelineFactory({ features: [feature] })
            });
            activeRenderers.push(renderer);
            const scene = new Node();
            scene.addChild(
                new Mesh({
                    geometry: new BoxGeometry(),
                    material: new BasicMaterial({ lightType: 'NONE', state: { depthTest: false } }),
                    frustumTest: false
                })
            );

            renderer.render(scene, new PerspectiveCamera());
            renderer.render(scene, new PerspectiveCamera());

            expect(feature.runtime?.recordCount).toBe(2);
            expect(renderer.renderInfo.drawCount).toBeGreaterThanOrEqual(3);
        }
    );

    it('rejects sampled depth requirements until the public binding path supports them', () => {
        const runtime = new CountingForwardFeatureRuntime();
        const feature: ForwardRenderPipelineFeature = {
            name: 'sampled-depth-feature',
            injectionPoint: 'after-transparent',
            requirements: {
                sampledSceneColor: false,
                sampledDepth: true
            },
            create(): ForwardRenderPipelineFeatureRuntime {
                return runtime;
            }
        };
        expect(() => {
            new ForwardRenderPipelineFactory({ features: [feature] });
        }).toThrow(/sampledDepth is not implemented end to end/u);
    });

    it('rejects scene-color sampling before opaque rendering initializes it', () => {
        const feature: ForwardRenderPipelineFeature = {
            name: 'early-scene-color-feature',
            injectionPoint: 'before-opaque',
            requirements: {
                sampledSceneColor: true,
                sampledDepth: false
            },
            create(): ForwardRenderPipelineFeatureRuntime {
                return new CountingForwardFeatureRuntime();
            }
        };

        expect(() => {
            new ForwardRenderPipelineFactory({ features: [feature] });
        }).toThrow(/cannot sample scene color before opaque rendering/u);
    });

    it('creates and destroys independent forward feature runtimes per Renderer', async () => {
        const feature = new CountingForwardFeature();
        const factory = new ForwardRenderPipelineFactory({ features: [feature] });
        const first = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            renderPipeline: factory
        });
        const second = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            renderPipeline: factory
        });
        activeRenderers.push(first, second);

        expect(feature.runtimes).toHaveLength(2);
        first.destroy();
        activeRenderers.splice(activeRenderers.indexOf(first), 1);
        expect(feature.runtimes[0]?.destroyCount).toBe(1);
        expect(feature.runtimes[1]?.destroyCount).toBe(0);
        second.destroy();
        activeRenderers.splice(activeRenderers.indexOf(second), 1);
        expect(feature.runtimes[1]?.destroyCount).toBe(1);
    });

    it('rejects sharing one forward feature runtime between Renderers without destroying its owner', async () => {
        const runtime = new CountingForwardFeatureRuntime();
        const feature: ForwardRenderPipelineFeature = {
            name: 'singleton-feature-runtime',
            injectionPoint: 'after-transparent',
            requirements: {
                sampledSceneColor: false,
                sampledDepth: false
            },
            create(): ForwardRenderPipelineFeatureRuntime {
                return runtime;
            }
        };
        const factory = new ForwardRenderPipelineFactory({ features: [feature] });
        const first = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            renderPipeline: factory
        });
        activeRenderers.push(first);

        await expect(
            Renderer.create({
                backend: 'webgl2',
                domElement: document.createElement('canvas'),
                width: 4,
                height: 4,
                renderPipeline: factory
            })
        ).rejects.toThrow(/runtime is already attached to another Renderer/u);
        expect(runtime.destroyCount).toBe(0);
        first.render(new Node(), new PerspectiveCamera());
        expect(runtime.recordCount).toBe(1);
    });

    it('snapshots feature create callbacks when the forward factory is constructed', async () => {
        const originalCreate = vi.fn(
            (_context: RenderPipelineCreateContext): ForwardRenderPipelineFeatureRuntime =>
                new CountingForwardFeatureRuntime()
        );
        const replacementCreate = vi.fn(
            (_context: RenderPipelineCreateContext): ForwardRenderPipelineFeatureRuntime =>
                new CountingForwardFeatureRuntime()
        );
        const feature = {
            name: 'mutable-feature-create',
            injectionPoint: 'after-transparent' as const,
            requirements: { sampledSceneColor: false, sampledDepth: false },
            create: originalCreate
        };
        const factory = new ForwardRenderPipelineFactory({ features: [feature] });
        feature.create = replacementCreate;

        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            renderPipeline: factory
        });
        activeRenderers.push(renderer);

        expect(originalCreate).toHaveBeenCalledOnce();
        expect(replacementCreate).not.toHaveBeenCalled();
    });

    it('cleans up an invalid forward feature runtime during Renderer initialization', async () => {
        const destroy = vi.fn();
        const feature: ForwardRenderPipelineFeature = {
            name: 'invalid-runtime-feature',
            injectionPoint: 'before-output',
            requirements: {
                sampledSceneColor: false,
                sampledDepth: false
            },
            create(): ForwardRenderPipelineFeatureRuntime {
                return { destroy } as unknown as ForwardRenderPipelineFeatureRuntime;
            }
        };

        await expect(
            Renderer.create({
                backend: 'webgl2',
                domElement: document.createElement('canvas'),
                width: 4,
                height: 4,
                renderPipeline: new ForwardRenderPipelineFactory({ features: [feature] })
            })
        ).rejects.toThrow(/must implement record\(\) and destroy\(\)/u);
        expect(destroy).toHaveBeenCalledOnce();
    });
});
