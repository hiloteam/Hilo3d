import * as Hilo3d from '../../src/Hilo3d';

Hilo3d.registerUniformBlockBinding('PostProcessKernelBlock');

export interface PostProcessUniformGetter {
    get(
        mesh: Hilo3d.Mesh | null,
        material: Hilo3d.Material | null,
        programInfo: Hilo3d.ProgramUniform
    ): unknown;
}

export type PostProcessUniform = number | Int32Array | PostProcessUniformGetter;

export interface PostProcessPass {
    id?: string;
    vert?: string;
    frag?: string;
    uniforms?: Record<string, PostProcessUniform>;
    uniformBlocks?: Record<string, Hilo3d.UniformBuffer>;
    prepare?: () => void;
    clearColor?: Hilo3d.Color;
    kernel?: readonly number[];
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

function requireTextureIndex(programInfo: Hilo3d.ProgramUniform): number {
    const { textureIndex } = programInfo;
    if (textureIndex === undefined) {
        throw new Error(`Uniform ${programInfo.name} is not a texture sampler.`);
    }
    return textureIndex;
}

function requireTexture(
    texture: Hilo3d.TextureBinding | null,
    description: string
): Hilo3d.TextureBinding {
    if (!texture) throw new Error(`${description} has no texture attachment.`);
    return texture;
}

export class PostProcess {
    readonly passes: PostProcessPass[] = [];
    readonly kernels = kernels;

    private currentRenderer: Hilo3d.WebGLRenderer | null = null;
    private currentFrontBuffer: Hilo3d.Framebuffer | null = null;
    private currentBackBuffer: Hilo3d.Framebuffer | null = null;

    get renderer(): Hilo3d.WebGLRenderer {
        if (!this.currentRenderer) throw new Error('PostProcess has not been initialized.');
        return this.currentRenderer;
    }

    get frontBuffer(): Hilo3d.Framebuffer {
        if (!this.currentFrontBuffer) throw new Error('PostProcess front buffer is not ready.');
        return this.currentFrontBuffer;
    }

    get backBuffer(): Hilo3d.Framebuffer {
        if (!this.currentBackBuffer) throw new Error('PostProcess back buffer is not ready.');
        return this.currentBackBuffer;
    }

    init(
        renderer: Hilo3d.WebGLRenderer,
        framebufferOptions: Hilo3d.FramebufferParameters = {}
    ): void {
        this.destroyBuffers();
        this.currentRenderer = renderer;
        renderer.onInit(() => {
            if (this.currentRenderer === renderer) this.createBuffers(framebufferOptions);
        });
    }

    private createBuffers(framebufferOptions: Hilo3d.FramebufferParameters): void {
        this.destroyBuffers();
        const renderer = this.renderer;
        const options: Hilo3d.FramebufferParameters = {
            width: renderer.width,
            height: renderer.height,
            ...framebufferOptions
        };
        this.currentFrontBuffer = new Hilo3d.Framebuffer(renderer, options);
        this.currentBackBuffer = new Hilo3d.Framebuffer(renderer, options);
    }

    private destroyBuffers(): void {
        this.currentFrontBuffer?.destroy();
        this.currentBackBuffer?.destroy();
        this.currentFrontBuffer = null;
        this.currentBackBuffer = null;
    }

    resize(): void {
        const { width, height } = this.renderer;
        this.frontBuffer.resize(width, height);
        this.backBuffer.resize(width, height);
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

        const renderer = this.renderer;
        const layout = Hilo3d.createStd140Layout({
            u_textureSize: 'vec2',
            u_kernel: { type: 'float', arrayLength: 9 },
            u_kernelWeight: 'float'
        });
        const materialBlock = Hilo3d.UniformBuffer.fromSchema(layout);
        const pass: PostProcessPass = { kernel };

        pass.id = id ?? Hilo3d.math.generateUUID('pass');
        pass.frag = `#version 300 es
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
                `;
        pass.uniformBlocks = { PostProcessKernelBlock: materialBlock };
        pass.prepare = () => {
            const currentKernel = pass.kernel;
            if (currentKernel?.length !== 9) {
                throw new RangeError('Post-process kernel must contain exactly 9 values.');
            }
            materialBlock.set('u_textureSize', [renderer.width, renderer.height]);
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

    render(): void {
        if (this.passes.length === 0) return;

        const rendererTexture = requireTexture(
            this.renderer.framebuffer?.texture ?? null,
            'Renderer framebuffer'
        );
        let sourceTexture = rendererTexture;
        let frontBuffer = this.frontBuffer;
        let backBuffer = this.backBuffer;

        this.passes.forEach((pass, index) => {
            const isLastPass = index === this.passes.length - 1;
            if (isLastPass) this.renderer.state.bindSystemFramebuffer();
            else frontBuffer.bind();

            this.draw(sourceTexture, pass);
            if (!isLastPass) {
                sourceTexture = requireTexture(frontBuffer.texture, 'Post-process framebuffer');
                [frontBuffer, backBuffer] = [backBuffer, frontBuffer];
            }
        });
    }

    draw(texture: Hilo3d.TextureBinding | null, pass: PostProcessPass): void {
        const renderer = this.renderer;
        const { gl, state } = renderer;
        const vertexShader = pass.vert ?? Hilo3d.Shader.shaders['screen.vert'];
        const fragmentShader = pass.frag ?? Hilo3d.Shader.shaders['screen.frag'];
        if (!vertexShader || !fragmentShader) {
            throw new Error(
                'PostProcess requires the built-in screen vertex and fragment shaders.'
            );
        }

        const depthEnabled = gl.isEnabled(gl.DEPTH_TEST);
        const cullEnabled = gl.isEnabled(gl.CULL_FACE);
        const blendEnabled = gl.isEnabled(gl.BLEND);
        const uniforms = { ...(pass.uniforms ?? {}) };
        if (texture && uniforms['u_diffuse'] === undefined) {
            uniforms['u_diffuse'] = this.uniformTextureGetter(texture);
        }

        try {
            state.disable(gl.DEPTH_TEST);
            state.disable(gl.CULL_FACE);
            state.disable(gl.BLEND);
            if (pass.clearColor) {
                const { r, g, b, a } = pass.clearColor;
                gl.clearColor(r, g, b, a);
                gl.clear(gl.COLOR_BUFFER_BIT);
            }

            const passId = pass.id ?? Hilo3d.math.generateUUID('pass');
            pass.id = passId;
            const shader = Hilo3d.Shader.getCustomShader(vertexShader, fragmentShader, '', passId);
            const program = Hilo3d.Program.getProgram(shader, state);
            program.useProgram();
            pass.prepare?.();
            for (const name of Object.keys(program.uniformBlocks)) {
                const uniformBuffer = pass.uniformBlocks?.[name];
                if (!uniformBuffer) {
                    throw new Error(`Post-process pass ${passId} does not bind ${name}.`);
                }
                program.setUniformBlock(name, uniformBuffer);
            }

            const vao = Hilo3d.VertexArrayObject.getVao(gl, program.id, {
                mode: gl.TRIANGLE_STRIP
            });
            if (vao.isDirty) {
                vao.isDirty = false;
                const position = program.attributes['a_position'];
                const texcoord = program.attributes['a_texcoord0'];
                if (!position || !texcoord) {
                    throw new Error('Post-process shader is missing screen-space attributes.');
                }
                vao.addAttribute(
                    new Hilo3d.GeometryData(new Float32Array([-1, 1, 1, 1, -1, -1, 1, -1]), 2),
                    position,
                    gl.STATIC_DRAW
                );
                vao.addAttribute(
                    new Hilo3d.GeometryData(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2),
                    texcoord,
                    gl.STATIC_DRAW
                );
            }

            for (const [name, uniform] of Object.entries(uniforms)) {
                const programInfo = program.uniforms[name];
                if (!programInfo) continue;
                const value =
                    typeof uniform === 'object' && 'get' in uniform
                        ? uniform.get(null, null, programInfo)
                        : uniform;
                if (value !== undefined && value !== null) program.setUniform(name, value);
            }
            vao.draw();
        } finally {
            if (depthEnabled) state.enable(gl.DEPTH_TEST);
            else state.disable(gl.DEPTH_TEST);
            if (cullEnabled) state.enable(gl.CULL_FACE);
            else state.disable(gl.CULL_FACE);
            if (blendEnabled) state.enable(gl.BLEND);
            else state.disable(gl.BLEND);
        }
    }

    uniformTextureGetter(texture: Hilo3d.TextureBinding | null): PostProcessUniformGetter {
        return {
            get: (_mesh, _material, programInfo) =>
                Hilo3d.semantic.handlerTexture(texture, requireTextureIndex(programInfo))
        };
    }

    destroy(): void {
        this.destroyBuffers();
        this.passes.length = 0;
        this.currentRenderer = null;
    }
}

const postProcess = new PostProcess();

export default postProcess;
