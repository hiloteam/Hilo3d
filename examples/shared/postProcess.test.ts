import { describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../src/Hilo3d';
import { PostProcess } from './postProcess';

const fragmentShader = `#version 300 es
precision highp float;
in vec2 v_texcoord0;
uniform sampler2D u_diffuse;
layout(location = 0) out vec4 fragmentColor;
void main(void) {
    fragmentColor = texture(u_diffuse, v_texcoord0);
}`;

interface RenderTargetHarness {
    readonly target: Hilo3d.RenderTarget;
    readonly resize: ReturnType<typeof vi.fn>;
    readonly destroy: ReturnType<typeof vi.fn>;
}

interface RendererHarness {
    readonly renderer: Hilo3d.Renderer;
    readonly state: { width: number; height: number };
    readonly targets: RenderTargetHarness[];
    readonly createRenderTarget: ReturnType<typeof vi.fn>;
    readonly render: ReturnType<typeof vi.fn>;
    readonly renderToTarget: ReturnType<typeof vi.fn>;
    readonly destroyMesh: ReturnType<typeof vi.fn>;
}

function createTarget(
    parameters: Hilo3d.RenderTargetParameters,
    backend: Hilo3d.RendererBackend
): RenderTargetHarness {
    const texture = new Hilo3d.Texture({ width: parameters.width, height: parameters.height });
    const state = { width: parameters.width, height: parameters.height, destroyed: false };
    const resize = vi.fn((width: number, height: number): void => {
        state.width = width;
        state.height = height;
    });
    const destroy = vi.fn((): void => {
        state.destroyed = true;
    });
    const target = {
        backend,
        label: parameters.label ?? 'PostProcess test target',
        sampleCount: 1,
        colorAttachmentCount: 1,
        colorFormats: ['rgba8unorm'],
        depthStencilFormat: null,
        get isDestroyed() {
            return state.destroyed;
        },
        get width() {
            return state.width;
        },
        get height() {
            return state.height;
        },
        getColorTexture: () => texture,
        getDepthTexture: () => null,
        readColorAttachment: () =>
            Promise.resolve({
                data: new Uint8Array(state.width * state.height * 4),
                format: 'rgba8unorm' as const,
                width: state.width,
                height: state.height,
                bytesPerPixel: 4,
                bytesPerRow: state.width * 4
            }),
        resize,
        destroy
    } satisfies Hilo3d.RenderTarget;
    return { target, resize, destroy };
}

function createRendererHarness(): RendererHarness {
    const state = { width: 64, height: 32 };
    const targets: RenderTargetHarness[] = [];
    const createRenderTarget = vi.fn((parameters: Hilo3d.RenderTargetParameters) => {
        const target = createTarget(parameters, 'webgl2');
        targets.push(target);
        return target.target;
    });
    const render = vi.fn();
    const renderToTarget = vi.fn();
    const destroyMesh = vi.fn();
    const rendererState = {
        backend: 'webgl2' as const,
        get width() {
            return state.width;
        },
        set width(value: number) {
            state.width = value;
        },
        get height() {
            return state.height;
        },
        set height(value: number) {
            state.height = value;
        },
        forceMaterial: null,
        renderTarget: null,
        resourceManager: { destroyMesh },
        createRenderTarget,
        render,
        renderToTarget
    };
    return {
        renderer: rendererState as unknown as Hilo3d.Renderer,
        state,
        targets,
        createRenderTarget,
        render,
        renderToTarget,
        destroyMesh
    };
}

describe('PostProcess preparation', () => {
    it('creates persistent targets and fullscreen pass owners before rendering', () => {
        const harness = createRendererHarness();
        const postProcess = new PostProcess();
        postProcess.init(harness.renderer);
        postProcess.addPass({ frag: fragmentShader }, 'first');
        postProcess.addPass({ frag: fragmentShader }, 'second');

        postProcess.prepare();

        expect(harness.createRenderTarget).toHaveBeenCalledTimes(2);
        expect(harness.targets.map(({ target }) => target.label)).toEqual([
            'PostProcess front',
            'PostProcess back'
        ]);

        const source = new Hilo3d.Texture({ width: 4, height: 4 });
        postProcess.render(source);

        expect(harness.createRenderTarget).toHaveBeenCalledTimes(2);
        expect(harness.renderToTarget).toHaveBeenCalledTimes(1);
        expect(harness.render).toHaveBeenCalledTimes(1);

        postProcess.destroy();
        expect(harness.targets.every(({ destroy }) => destroy.mock.calls.length === 1)).toBe(true);
        expect(harness.destroyMesh).toHaveBeenCalledTimes(2);
    });

    it('rejects a newly added pass before issuing any partial-frame draw', () => {
        const harness = createRendererHarness();
        const postProcess = new PostProcess();
        postProcess.init(harness.renderer);
        postProcess.addPass({ frag: fragmentShader }, 'prepared');
        postProcess.prepare();
        postProcess.addPass({ frag: fragmentShader }, 'new-pass');

        const source = new Hilo3d.Texture({ width: 4, height: 4 });
        expect(() => {
            postProcess.render(source);
        }).toThrow(/new-pass is not prepared/u);
        expect(harness.renderToTarget).not.toHaveBeenCalled();
        expect(harness.render).not.toHaveBeenCalled();
        expect(harness.createRenderTarget).toHaveBeenCalledTimes(2);

        postProcess.prepare();
        postProcess.render(source);
        expect(harness.renderToTarget).toHaveBeenCalledTimes(1);
        expect(harness.render).toHaveBeenCalledTimes(1);
        postProcess.destroy();
    });

    it('resizes prepared buffers and releases every owned resource on destroy', () => {
        const harness = createRendererHarness();
        const postProcess = new PostProcess();
        postProcess.init(harness.renderer);
        postProcess.addPass({ frag: fragmentShader }, 'resize');
        postProcess.prepare();

        harness.state.width = 128;
        harness.state.height = 48;
        postProcess.resize();

        for (const target of harness.targets) {
            expect(target.resize).toHaveBeenCalledWith(128, 48);
        }

        postProcess.destroy();
        expect(() => {
            void postProcess.frontBuffer;
        }).toThrow(/not prepared/u);
        expect(harness.targets.every(({ destroy }) => destroy.mock.calls.length === 1)).toBe(true);
        expect(harness.destroyMesh).toHaveBeenCalledTimes(1);
    });
});
