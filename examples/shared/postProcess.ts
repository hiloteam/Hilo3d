import * as Hilo3d from '../../src/Hilo3d';
import {
    FullscreenPass,
    type FullscreenSamplerValue,
    type FullscreenSamplerProvider
} from './FullscreenPass';

Hilo3d.registerUniformBlockBinding('PostProcessKernelBlock');

export interface PostProcessUniformGetter {
    get(): PostProcessSamplerValue;
}

export type PostProcessSamplerValue = Hilo3d.Texture<unknown> | readonly Hilo3d.Texture<unknown>[];

export type PostProcessUniform = PostProcessSamplerValue | PostProcessUniformGetter;

export interface PostProcessPass {
    id?: string;
    vert?: string;
    frag?: string;
    uniforms?: Record<string, PostProcessUniform>;
    uniformBlocks?: Record<string, Hilo3d.UniformBuffer>;
    prepare?: () => void;
    kernel?: readonly number[];
}

interface CompiledPostProcessPass {
    readonly fullscreen: FullscreenPass;
    source: Hilo3d.Texture<unknown> | null;
}

const kernels: Readonly<Record<string, readonly number[]>> = Object.freeze({
    normal: [0, 0, 0, 0, 1, 0, 0, 0, 0],
    gaussianBlur: [0.045, 0.122, 0.045, 0.122, 0.332, 0.122, 0.045, 0.122, 0.045],
    gaussianBlur2: [1, 2, 1, 2, 4, 2, 1, 2, 1],
    gaussianBlur3: [0, 1, 0, 1, 1, 1, 0, 1, 0],
    unsharpen: [-1, -1, -1, -1, 9, -1, -1, -1, -1],
    sharpness: [0, -1, 0, -1, 5, -1, 0, -1, 0],
    sharpen: [-1, -1, -1, -1, 16, -1, -1, -1, -1],
    edgeDetect: [-0.125, -0.125, -0.125, -0.125, 1, -0.125, -0.125, -0.125, -0.125],
    edgeDetect2: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
    edgeDetect3: [-5, 0, 0, 0, 0, 0, 0, 0, 5],
    edgeDetect4: [-1, -1, -1, 0, 0, 0, 1, 1, 1],
    edgeDetect5: [-1, -1, -1, 2, 2, 2, -1, -1, -1],
    edgeDetect6: [-5, -5, -5, -5, 39, -5, -5, -5, -5],
    sobelHorizontal: [1, 2, 1, 0, 0, 0, -1, -2, -1],
    sobelVertical: [1, 0, -1, 2, 0, -2, 1, 0, -1],
    previtHorizontal: [1, 1, 1, 0, 0, 0, -1, -1, -1],
    previtVertical: [1, 0, -1, 1, 0, -1, 1, 0, -1],
    boxBlur: [0.111, 0.111, 0.111, 0.111, 0.111, 0.111, 0.111, 0.111, 0.111],
    triangleBlur: [0.0625, 0.125, 0.0625, 0.125, 0.25, 0.125, 0.0625, 0.125, 0.0625],
    emboss: [-2, -1, 0, -1, 1, 1, 0, 1, 2]
});

function requireTexture(value: unknown, description: string): Hilo3d.Texture<unknown> {
    if (!(value instanceof Hilo3d.Texture)) {
        throw new TypeError(`${description} must resolve to an engine Texture.`);
    }
    return value;
}

function resolveSampler(value: PostProcessUniform, description: string): FullscreenSamplerValue {
    const resolved = 'get' in value ? value.get() : value;
    if (resolved instanceof Hilo3d.Texture) return resolved;
    if (Array.isArray(resolved) && resolved.every(item => item instanceof Hilo3d.Texture)) {
        return resolved;
    }
    throw new TypeError(`${description} must resolve to a Texture or Texture array.`);
}

/** Backend-neutral post-processing graph built exclusively from public render targets and draws. */
export class PostProcess {
    readonly passes: PostProcessPass[] = [];
    readonly kernels = kernels;

    private currentRenderer: Hilo3d.Renderer | null = null;
    private currentFrontBuffer: Hilo3d.RenderTarget | null = null;
    private currentBackBuffer: Hilo3d.RenderTarget | null = null;
    private readonly compiledPasses = new Map<PostProcessPass, CompiledPostProcessPass>();

    get renderer(): Hilo3d.Renderer {
        if (!this.currentRenderer) throw new Error('PostProcess has not been initialized.');
        return this.currentRenderer;
    }

    get frontBuffer(): Hilo3d.RenderTarget {
        this.ensureBuffers();
        if (!this.currentFrontBuffer) throw new Error('PostProcess front buffer is not ready.');
        return this.currentFrontBuffer;
    }

    get backBuffer(): Hilo3d.RenderTarget {
        this.ensureBuffers();
        if (!this.currentBackBuffer) throw new Error('PostProcess back buffer is not ready.');
        return this.currentBackBuffer;
    }

    init(renderer: Hilo3d.Renderer): void {
        this.destroyBuffers();
        this.destroyCompiledPasses();
        this.currentRenderer = renderer;
    }

    private ensureBuffers(): void {
        if (this.currentFrontBuffer && this.currentBackBuffer) return;
        const renderer = this.renderer;
        const parameters: Hilo3d.RenderTargetParameters = {
            width: Math.max(1, renderer.width),
            height: Math.max(1, renderer.height),
            colorAttachments: [{ format: 'rgba8unorm' }],
            depthStencilAttachment: false,
            label: 'PostProcess ping-pong'
        };
        this.currentFrontBuffer = renderer.createRenderTarget({
            ...parameters,
            label: 'PostProcess front'
        });
        try {
            this.currentBackBuffer = renderer.createRenderTarget({
                ...parameters,
                label: 'PostProcess back'
            });
        } catch (error) {
            this.currentFrontBuffer.destroy();
            this.currentFrontBuffer = null;
            throw error;
        }
    }

    private destroyBuffers(): void {
        this.currentFrontBuffer?.destroy();
        this.currentBackBuffer?.destroy();
        this.currentFrontBuffer = null;
        this.currentBackBuffer = null;
    }

    private destroyCompiledPasses(): void {
        for (const compiled of this.compiledPasses.values()) compiled.fullscreen.destroy();
        this.compiledPasses.clear();
    }

    resize(): void {
        if (!this.currentFrontBuffer || !this.currentBackBuffer) return;
        const width = Math.max(1, this.renderer.width);
        const height = Math.max(1, this.renderer.height);
        this.currentFrontBuffer.resize(width, height);
        this.currentBackBuffer.resize(width, height);
    }

    addPass(params: PostProcessPass, id = Hilo3d.math.generateUUID('pass')): PostProcessPass {
        const pass: PostProcessPass = { ...params, id };
        this.passes.push(pass);
        return pass;
    }

    addKernelPass(kernel: readonly number[], id?: string): PostProcessPass {
        if (kernel.length !== 9) {
            throw new RangeError(
                `Post-process kernels require 9 values; received ${String(kernel.length)}.`
            );
        }

        const layout = Hilo3d.createStd140Layout({
            u_textureSize: 'vec2',
            u_kernel: { type: 'float', arrayLength: 9 },
            u_kernelWeight: 'float'
        });
        const materialBlock = Hilo3d.UniformBuffer.fromSchema(layout);
        const pass: PostProcessPass = {
            id: id ?? Hilo3d.math.generateUUID('pass'),
            kernel,
            frag: `#version 300 es
                precision highp float;
                in vec2 v_texcoord0;
                uniform sampler2D u_diffuse;
                layout(std140) uniform PostProcessKernelBlock {
                    vec2 u_textureSize;
                    float u_kernel[9];
                    float u_kernelWeight;
                };
                layout(location = 0) out vec4 fragmentColor;
                void main(void) {
                    vec2 onePixel = vec2(1.0) / u_textureSize;
                    vec4 colorSum =
                        texture(u_diffuse, v_texcoord0 + onePixel * vec2(-1, -1)) * u_kernel[0] +
                        texture(u_diffuse, v_texcoord0 + onePixel * vec2( 0, -1)) * u_kernel[1] +
                        texture(u_diffuse, v_texcoord0 + onePixel * vec2( 1, -1)) * u_kernel[2] +
                        texture(u_diffuse, v_texcoord0 + onePixel * vec2(-1,  0)) * u_kernel[3] +
                        texture(u_diffuse, v_texcoord0 + onePixel * vec2( 0,  0)) * u_kernel[4] +
                        texture(u_diffuse, v_texcoord0 + onePixel * vec2( 1,  0)) * u_kernel[5] +
                        texture(u_diffuse, v_texcoord0 + onePixel * vec2(-1,  1)) * u_kernel[6] +
                        texture(u_diffuse, v_texcoord0 + onePixel * vec2( 0,  1)) * u_kernel[7] +
                        texture(u_diffuse, v_texcoord0 + onePixel * vec2( 1,  1)) * u_kernel[8];
                    fragmentColor = colorSum / u_kernelWeight;
                }
            `,
            uniformBlocks: { PostProcessKernelBlock: materialBlock }
        };
        pass.prepare = () => {
            const currentKernel = pass.kernel;
            if (currentKernel?.length !== 9) {
                throw new RangeError('Post-process kernel must contain exactly 9 values.');
            }
            const compiled = this.compiledPasses.get(pass);
            const source = compiled?.source;
            materialBlock.set('u_textureSize', [
                source?.width ?? this.renderer.width,
                source?.height ?? this.renderer.height
            ]);
            materialBlock.set('u_kernel', currentKernel);
            materialBlock.set(
                'u_kernelWeight',
                Math.max(
                    1,
                    currentKernel.reduce((sum, value) => sum + value, 0)
                )
            );
        };
        this.passes.push(pass);
        return pass;
    }

    private compile(pass: PostProcessPass): CompiledPostProcessPass {
        const cached = this.compiledPasses.get(pass);
        if (cached) return cached;
        const fragmentShader = pass.frag ?? Hilo3d.Shader.shaders['screen.frag'];
        if (!fragmentShader) throw new Error('PostProcess requires a fragment shader.');
        let source: Hilo3d.Texture<unknown> | null = null;
        const samplerNames = new Set(['u_diffuse', ...Object.keys(pass.uniforms ?? {})]);
        const samplers: Record<string, FullscreenSamplerProvider> = {};
        for (const name of samplerNames) {
            samplers[name] = () => {
                const explicit = pass.uniforms?.[name];
                if (explicit !== undefined) {
                    return resolveSampler(explicit, `Post-process sampler ${name}`);
                }
                if (name === 'u_diffuse' && source) return source;
                throw new Error(`Post-process sampler ${name} has no texture source.`);
            };
        }
        const fullscreen = new FullscreenPass({
            renderer: this.renderer,
            fragmentShader,
            samplers,
            ...(pass.vert === undefined ? {} : { vertexShader: pass.vert }),
            ...(pass.uniformBlocks === undefined ? {} : { uniformBlocks: pass.uniformBlocks }),
            ...(pass.prepare === undefined ? {} : { prepare: pass.prepare }),
            label: pass.id ?? Hilo3d.math.generateUUID('PostProcessPass')
        });
        const compiled: CompiledPostProcessPass = {
            fullscreen,
            get source() {
                return source;
            },
            set source(value: Hilo3d.Texture<unknown> | null) {
                source = value;
            }
        };
        this.compiledPasses.set(pass, compiled);
        return compiled;
    }

    render(sourceTexture: unknown, outputTarget: Hilo3d.RenderTarget | null = null): void {
        if (this.passes.length === 0) return;
        let source = requireTexture(sourceTexture, 'Post-process source');
        let front = this.frontBuffer;
        let back = this.backBuffer;

        this.passes.forEach((pass, index) => {
            const isLastPass = index === this.passes.length - 1;
            this.draw(source, pass, isLastPass ? outputTarget : front);
            if (!isLastPass) {
                source = front.getColorTexture();
                [front, back] = [back, front];
            }
        });
    }

    draw(texture: unknown, pass: PostProcessPass, target: Hilo3d.RenderTarget | null = null): void {
        const compiled = this.compile(pass);
        compiled.source = texture === null ? null : requireTexture(texture, 'Post-process source');
        const previousForceMaterial = this.renderer.forceMaterial;
        this.renderer.forceMaterial = null;
        try {
            compiled.fullscreen.render(target);
        } finally {
            this.renderer.forceMaterial = previousForceMaterial;
        }
    }

    uniformTextureGetter(texture: unknown): PostProcessUniformGetter {
        return {
            get: () => requireTexture(texture, 'Post-process uniform')
        };
    }

    destroy(): void {
        this.destroyBuffers();
        this.destroyCompiledPasses();
        this.passes.length = 0;
        this.currentRenderer = null;
    }
}

const postProcess = new PostProcess();

export default postProcess;
