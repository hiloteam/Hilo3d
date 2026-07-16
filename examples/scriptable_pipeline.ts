import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const FULLSCREEN_VERTEX_SOURCE = `#version 300 es
out vec2 v_uv;
void main() {
    v_uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(v_uv * 2.0 - 1.0, 0.0, 1.0);
}`;

const GRAYSCALE_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_sceneColor;
layout(location = 0) out vec4 color;
void main() {
    vec4 source = texture(u_sceneColor, v_uv);
    float luminance = dot(source.rgb, vec3(0.2126, 0.7152, 0.0722));
    color = vec4(vec3(luminance), source.a);
}`;

interface MutableColorAttachment extends Hilo3d.RenderPipelineColorAttachment {
    texture: Hilo3d.RenderGraphTextureHandle;
}

class GrayscaleParameters implements Hilo3d.FullscreenRenderPassParameters {
    readonly inputTextures: Hilo3d.RenderGraphTextureHandle[] = [];
    readonly colorAttachments: MutableColorAttachment[] = [];
    #attachment: MutableColorAttachment | null = null;

    configure(
        source: Hilo3d.RenderGraphTextureHandle,
        destination: Hilo3d.RenderGraphTextureHandle
    ): void {
        this.inputTextures[0] = source;
        this.inputTextures.length = 1;
        this.#attachment ??= {
            texture: destination,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 }
        };
        this.#attachment.texture = destination;
        this.colorAttachments[0] = this.#attachment;
        this.colorAttachments.length = 1;
    }

    reset(): void {
        this.inputTextures.length = 0;
        this.colorAttachments.length = 0;
    }
}

class GrayscaleFeatureRuntime implements Hilo3d.ForwardRenderPipelineFeatureRuntime {
    readonly #pass = new Hilo3d.FullscreenRenderPass({
        name: 'Grayscale scene color',
        shader: new Hilo3d.Shader({
            vs: FULLSCREEN_VERTEX_SOURCE,
            fs: GRAYSCALE_FRAGMENT_SOURCE
        }),
        material: new Hilo3d.Material({
            depthTest: false,
            depthMask: false,
            cullFace: false
        })
    });
    readonly #parameters = new Hilo3d.RenderPassParameterPool(
        () => new GrayscaleParameters(),
        parameters => {
            parameters.reset();
        }
    );
    readonly #descriptor: {
        format: Hilo3d.RenderTargetColorFormat;
        readonly extent: Readonly<{ relativeTo: 'output'; scale: 1 }>;
    } = {
        format: 'rgba8unorm',
        extent: Object.freeze({ relativeTo: 'output', scale: 1 })
    };

    record(context: Hilo3d.ForwardRenderFeatureContext): void {
        const source = context.resources.color;
        if (source === null) throw new Error('Grayscale feature requires scene color');
        this.#descriptor.format = context.pipeline.output.colorFormat(0);
        const destination = context.pipeline.graph.createTexture(
            'grayscale scene color',
            this.#descriptor
        );
        const parameters = context.pipeline.acquirePassParameters(this.#parameters);
        parameters.configure(source, destination);
        context.pipeline.graph.addPass(this.#pass, parameters);
        context.resources.replaceColor(destination);
    }

    destroy(): void {
        // This feature owns only engine resources whose lifecycle remains with the renderer.
    }
}

const grayscaleFeature: Hilo3d.ForwardRenderPipelineFeature = {
    name: 'grayscale',
    injectionPoint: 'after-transparent',
    requirements: Object.freeze({
        sampledSceneColor: true,
        sampledDepth: false
    }),
    create(): Hilo3d.ForwardRenderPipelineFeatureRuntime {
        return new GrayscaleFeatureRuntime();
    }
};

const context = await createExampleContext({
    stage: {
        renderPipeline: new Hilo3d.ForwardRenderPipelineFactory({
            features: [grayscaleFeature]
        })
    }
});
context.directionLight.shadow = { width: 128, height: 128 };

const cube = new Hilo3d.Mesh({
    geometry: new Hilo3d.BoxGeometry(),
    material: new Hilo3d.BasicMaterial({
        lightType: 'LAMBERT',
        diffuse: new Hilo3d.Color(0.1, 0.65, 1)
    }),
    onUpdate(): void {
        this.rotationX = (this.rotationX ?? 0) + 0.4;
        this.rotationY = (this.rotationY ?? 0) + 0.8;
    }
});
context.stage.addChild(cube);

async function publishResult(): Promise<void> {
    await new Promise<void>(resolve =>
        requestAnimationFrame(() => {
            resolve();
        })
    );
    await new Promise<void>(resolve =>
        requestAnimationFrame(() => {
            resolve();
        })
    );
    context.ticker.stop();
    try {
        await context.renderer.waitForIdle();
        window.__HILO3D_SCRIPTABLE_PIPELINE_RESULT__ = {
            backend: context.renderer.backend,
            drawCount: context.renderer.renderInfo.drawCount,
            faceCount: context.renderer.renderInfo.faceCount,
            hasShadowAtlas: context.renderer.lightManager.shadowAtlas !== null
        };
    } finally {
        context.ticker.start();
    }
}

void publishResult().catch((error: unknown) => {
    queueMicrotask(() => {
        throw error;
    });
});

window.addEventListener(
    'pagehide',
    () => {
        context.dispose();
    },
    { once: true }
);

declare global {
    interface Window {
        __HILO3D_SCRIPTABLE_PIPELINE_RESULT__?: {
            readonly backend: Hilo3d.RendererBackend;
            readonly drawCount: number;
            readonly faceCount: number;
            readonly hasShadowAtlas: boolean;
        };
    }
}
