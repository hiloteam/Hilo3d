import { describe, expect, it, vi } from 'vitest';
import StorageGraphicsShader from '../../../src/render/compute/StorageGraphicsShader';
import type { RendererListHandle } from '../../../src/render/pipeline/RendererList';
import {
    SCENE_STORAGE_BIND_GROUP,
    SceneRenderPass
} from '../../../src/render/pipeline/passes/SceneRenderPass';
import type {
    RenderGraphBufferHandle,
    RenderGraphPassHandle,
    RenderGraphTextureHandle,
    RenderPipelineColorAttachment,
    RenderPipelineDepthStencilAttachment,
    ScriptableRenderPassBuilder
} from '../../../src/render/pipeline/ScriptableRenderGraph';

class RecordingBuilder implements ScriptableRenderPassBuilder {
    readonly bufferReads: (readonly [RenderGraphBufferHandle, string])[] = [];
    readonly rendererLists: RendererListHandle[] = [];
    readonly colors: RenderPipelineColorAttachment[] = [];

    readTexture(_texture: RenderGraphTextureHandle): void {
        return;
    }
    writeStorageTexture(_texture: RenderGraphTextureHandle): void {
        return;
    }
    copyTexture(_source: RenderGraphTextureHandle, _destination: RenderGraphTextureHandle): void {
        return;
    }
    readBuffer(buffer: RenderGraphBufferHandle, use: 'storage'): void {
        this.bufferReads.push([buffer, use]);
    }
    writeBuffer(_buffer: RenderGraphBufferHandle, _use: 'storage' | 'copy-destination'): void {
        return;
    }
    readWriteBuffer(_buffer: RenderGraphBufferHandle): void {
        return;
    }
    copyBuffer(_source: RenderGraphBufferHandle, _destination: RenderGraphBufferHandle): void {
        return;
    }
    clearBuffer(
        _buffer: RenderGraphBufferHandle,
        _byteOffset?: number,
        _byteLength?: number
    ): void {
        return;
    }
    useColorAttachment(options: Readonly<RenderPipelineColorAttachment>): void {
        this.colors.push(options);
    }
    useDepthStencilAttachment(_options: Readonly<RenderPipelineDepthStencilAttachment>): void {
        return;
    }
    useRendererList(list: RendererListHandle): void {
        this.rendererLists.push(list);
    }
    dependsOn(_pass: RenderGraphPassHandle): void {
        return;
    }
    markSideEffect(): void {
        return;
    }
}

function storageShader(): StorageGraphicsShader {
    return new StorageGraphicsShader({
        vertexSource:
            '#version 310 es\nlayout(location=0) in vec3 p; void main(){gl_Position=vec4(p,1.0);}',
        fragmentSource:
            '#version 310 es\nprecision highp float; layout(std430) readonly buffer Lights { vec4 value[]; } lights; layout(location=0) out vec4 color; void main(){color=lights.value[0];}',
        bindings: [
            {
                name: 'lights',
                group: SCENE_STORAGE_BIND_GROUP,
                binding: 0,
                kind: 'read-only-storage-buffer'
            }
        ]
    });
}

describe('SceneRenderPass storage shader variant', () => {
    it('declares positional readonly storage hazards before the ordinary renderer list', () => {
        const pass = new SceneRenderPass('Forward+ scene');
        const builder = new RecordingBuilder();
        const buffer = 7 as RenderGraphBufferHandle;
        const list = 3 as RendererListHandle;
        const color = 9 as RenderGraphTextureHandle;

        pass.setup(builder, {
            rendererList: list,
            colorAttachments: [
                {
                    texture: color,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 }
                }
            ],
            storageShaderVariant: {
                shader: storageShader(),
                buffers: [{ buffer, byteOffset: 0, byteLength: 16 }]
            }
        });

        expect(builder.bufferReads).toEqual([[buffer, 'storage']]);
        expect(builder.rendererLists).toEqual([list]);
        expect(builder.colors).toHaveLength(1);
    });

    it('keeps execution on the renderer-list command facade', () => {
        const pass = new SceneRenderPass();
        const list = 4 as RendererListHandle;
        const drawRendererList = vi.fn();

        pass.execute(
            {
                commands: {
                    setViewport: vi.fn(),
                    setScissor: vi.fn(),
                    setStencilReference: vi.fn(),
                    drawRendererList,
                    copyTexture: vi.fn(),
                    copyBuffer: vi.fn(),
                    clearBuffer: vi.fn()
                }
            },
            { rendererList: list, colorAttachments: [] }
        );

        expect(drawRendererList).toHaveBeenCalledWith(list);
    });
});
