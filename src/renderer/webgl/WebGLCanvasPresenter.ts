import Program from './Program';
import VertexArrayObject from './VertexArrayObject';
import { bindWebGLSampler, getWebGLTexture, type default as WebGLState } from './WebGLState';
import type Texture from '../../texture/Texture';
import type WebGLRenderer from './WebGLRenderer';
import fragmentShader from '../../shader/present.frag';
import vertexShader from '../../shader/present.vert';

/** Renderer-owned fullscreen pipeline used when an offscreen attachment is presented to canvas. */
class WebGLCanvasPresenter {
    private readonly state: WebGLState;
    private readonly program: Program;
    private readonly vertexArray: VertexArrayObject;

    constructor(state: WebGLState) {
        this.state = state;
        this.program = new Program({ state, vertexShader, fragShader: fragmentShader });
        try {
            this.vertexArray = new VertexArrayObject(state.gl, 'WebGLCanvasPresenter', {
                mode: state.gl.TRIANGLES,
                vertexCount: 3
            });
        } catch (error) {
            this.program.destroy();
            throw error;
        }
    }

    present(texture: Texture<unknown>): void {
        const { gl } = this.state;
        const glTexture = getWebGLTexture(this.state, texture);
        this.state.bindSystemFramebuffer();
        this.state.disable(gl.BLEND);
        this.state.disable(gl.CULL_FACE);
        this.state.disable(gl.DEPTH_TEST);
        this.state.disable(gl.SCISSOR_TEST);
        this.state.disable(gl.STENCIL_TEST);
        this.state.disable(gl.RASTERIZER_DISCARD);
        this.state.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
        this.state.disable(gl.SAMPLE_COVERAGE);
        this.state.colorMask(true, true, true, true);
        this.state.depthMask(true);
        this.state.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        this.state.activeTexture(gl.TEXTURE0);
        this.state.bindTexture(gl.TEXTURE_2D, glTexture);
        bindWebGLSampler(this.state, texture, 0, false);
        this.program.useProgram();
        this.program.setUniform('u_sourceTexture', 0);
        this.vertexArray.draw();
    }

    destroy(): void {
        this.vertexArray.destroy();
        this.program.destroy();
    }
}

const presenters = new WeakMap<WebGLRenderer, WebGLCanvasPresenter>();
const stateInvalidators = new WeakMap<WebGLRenderer, () => void>();

/** @internal Register the renderer-owned state invalidation boundary for presentation draws. */
export function registerWebGLCanvasPresenter(
    renderer: WebGLRenderer,
    invalidateState: () => void
): void {
    stateInvalidators.set(renderer, invalidateState);
}

/** @internal Present one sampleable render-target texture through a WebGL2 fullscreen draw. */
export function presentWebGLTexture(renderer: WebGLRenderer, texture: Texture<unknown>): void {
    const invalidateState = stateInvalidators.get(renderer);
    if (!invalidateState) {
        throw new Error('WebGL canvas presenter is not registered with its renderer');
    }
    let presenter = presenters.get(renderer);
    if (!presenter) {
        presenter = new WebGLCanvasPresenter(renderer.state);
        presenters.set(renderer, presenter);
    }
    try {
        presenter.present(texture);
    } finally {
        invalidateState();
    }
}

/** @internal Release or abandon context-local presentation resources. */
export function releaseWebGLCanvasPresenter(renderer: WebGLRenderer, contextLost = false): void {
    const presenter = presenters.get(renderer);
    if (!presenter) return;
    presenters.delete(renderer);
    if (!contextLost || !renderer.gl.isContextLost()) presenter.destroy();
}

/** @internal Remove the presentation owner after the renderer has completed final teardown. */
export function unregisterWebGLCanvasPresenter(renderer: WebGLRenderer): void {
    releaseWebGLCanvasPresenter(renderer);
    stateInvalidators.delete(renderer);
}
