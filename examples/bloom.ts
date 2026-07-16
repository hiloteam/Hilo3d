import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './js/init';

const {
    camera,
    stage,
    renderer: sceneRenderer
} = createExampleContext({
    stage: { useFramebuffer: true }
});

interface RenderPassOptions {
    width?: number;
    height?: number;
    renderToScreen?: boolean;
    framebufferOption?: Hilo3d.FramebufferParameters;
}

interface ScreenShaderPassOptions extends RenderPassOptions {
    frag: string;
    vert?: string;
    uniforms?: Hilo3d.MaterialBindingMap;
}

function requireTextureIndex(programInfo: Hilo3d.ProgramBindingInfo): number {
    const { textureIndex } = programInfo;
    if (textureIndex === undefined) {
        throw new Error(`Uniform ${programInfo.name ?? '<unnamed>'} is not a texture sampler.`);
    }
    return textureIndex;
}

function requireFramebufferTexture(
    framebuffer: Hilo3d.Framebuffer | null,
    description: string
): Hilo3d.FramebufferTexture {
    const texture = framebuffer?.texture;
    if (!texture) throw new Error(`${description} framebuffer has no texture attachment.`);
    return texture;
}

abstract class RenderPass extends Hilo3d.EventDispatcher {
    readonly renderer: Hilo3d.WebGLRenderer;
    readonly width: number;
    readonly height: number;
    readonly renderToScreen: boolean;
    readonly framebuffer: Hilo3d.Framebuffer | null;
    protected lastPass: RenderPass | null = null;

    constructor(renderer: Hilo3d.WebGLRenderer, options: RenderPassOptions = {}) {
        super();
        this.renderer = renderer;
        this.width = options.width ?? renderer.width;
        this.height = options.height ?? renderer.height;
        this.renderToScreen = options.renderToScreen ?? false;
        this.framebuffer = this.renderToScreen
            ? null
            : new Hilo3d.Framebuffer(renderer, {
                  width: this.width,
                  height: this.height,
                  ...options.framebufferOption
              });
        renderer.onInit(() => {
            this.framebuffer?.init();
        });
    }

    execute(renderer: Hilo3d.WebGLRenderer, lastPass: RenderPass | null): void {
        this.lastPass = lastPass;
        renderer.state.viewport(0, 0, this.width, this.height);
        if (this.renderToScreen) renderer.state.bindSystemFramebuffer();
        else if (this.framebuffer) this.framebuffer.bind();
        else throw new Error('Off-screen render pass has no framebuffer.');

        const useFramebuffer = renderer.useFramebuffer;
        renderer.useFramebuffer = false;
        try {
            this.render(renderer);
            this.fire('afterRender');
        } finally {
            renderer.viewport();
            renderer.useFramebuffer = useFramebuffer;
        }
    }

    protected abstract render(renderer: Hilo3d.WebGLRenderer): void;

    addTo(postProcessRenderer: PostProcessRenderer): this {
        postProcessRenderer.addPass(this);
        return this;
    }

    destroy(): void {
        this.framebuffer?.destroy();
        this.off();
    }
}

class ScreenShaderPass extends RenderPass {
    private readonly scene = new Hilo3d.Node();
    private readonly camera = new Hilo3d.Camera();
    private readonly geometry = new Hilo3d.Geometry({
        mode: Hilo3d.constants.TRIANGLE_STRIP,
        vertices: new Hilo3d.GeometryData(new Float32Array([-1, 1, 1, 1, -1, -1, 1, -1]), 2),
        uvs: new Hilo3d.GeometryData(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2)
    });

    constructor(renderer: Hilo3d.WebGLRenderer, options: ScreenShaderPassOptions) {
        super(renderer, options);
        const vertexShader = options.vert ?? Hilo3d.Shader.shaders['screen.vert'];
        if (!vertexShader) throw new Error('Built-in screen vertex shader is unavailable.');
        new Hilo3d.Mesh({
            geometry: this.geometry,
            frustumTest: false,
            material: new Hilo3d.ShaderMaterial({
                vs: vertexShader,
                fs: options.frag,
                depthTest: false,
                side: Hilo3d.constants.FRONT_AND_BACK,
                uniforms: {
                    u_lastTexture: {
                        get: (_mesh, _material, programInfo) => {
                            const texture = requireFramebufferTexture(
                                this.lastPass?.framebuffer ?? null,
                                'Previous render pass'
                            );
                            return Hilo3d.semantic.handlerTexture(
                                texture,
                                requireTextureIndex(programInfo)
                            );
                        }
                    },
                    ...options.uniforms
                }
            })
        }).addTo(this.scene);
    }

    protected override render(renderer: Hilo3d.WebGLRenderer): void {
        renderer.render(this.scene, this.camera);
    }

    override destroy(): void {
        this.scene.destroy();
        super.destroy();
    }
}

class PostProcessRenderer {
    private readonly passes: RenderPass[] = [];
    private isRendering = false;

    constructor(private readonly renderer: Hilo3d.WebGLRenderer) {}

    render(): void {
        if (this.isRendering) throw new Error('Post-process rendering cannot be re-entered.');
        this.isRendering = true;
        let lastPass: RenderPass | null = null;
        try {
            for (const pass of this.passes) {
                pass.execute(this.renderer, lastPass);
                lastPass = pass;
            }
        } finally {
            this.renderer.state.bindSystemFramebuffer();
            this.isRendering = false;
        }
    }

    addPass(pass: RenderPass): void {
        if (this.passes.includes(pass)) throw new Error('Render pass has already been added.');
        this.passes.push(pass);
    }

    clear(): void {
        this.passes.forEach(pass => {
            pass.destroy();
        });
        this.passes.length = 0;
    }
}

const postProcessRenderer = new PostProcessRenderer(sceneRenderer);
sceneRenderer.on('afterRender', () => {
    postProcessRenderer.render();
});

const lightPass = new ScreenShaderPass(sceneRenderer, {
    frag: `
        precision HILO_MAX_FRAGMENT_PRECISION float;
        varying vec2 v_texcoord0;
        uniform sampler2D u_screen;
        void main(void) {
            vec4 color = texture2D(u_screen, v_texcoord0);
            float brightness = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
            gl_FragColor = brightness > 0.4 ? vec4(color.rgb, 1.0) : vec4(0.0);
        }
    `,
    uniforms: {
        u_screen: {
            get: (_mesh, _material, programInfo) =>
                Hilo3d.semantic.handlerTexture(
                    requireFramebufferTexture(sceneRenderer.framebuffer, 'Scene'),
                    requireTextureIndex(programInfo)
                )
        }
    }
}).addTo(postProcessRenderer);

const blurPasses: ScreenShaderPass[] = [];
for (let index = 0; index < 5; index++) {
    const blurWidth = Math.ceil(sceneRenderer.width / Math.pow(2, index));
    const blurHeight = Math.ceil(sceneRenderer.height / Math.pow(2, index));
    const textureSize = new Float32Array([blurWidth, blurHeight]);
    new ScreenShaderPass(sceneRenderer, {
        width: blurWidth,
        height: blurHeight,
        frag: `
            precision HILO_MAX_FRAGMENT_PRECISION float;
            uniform sampler2D u_lightTexture;
            varying vec2 v_texcoord0;
            uniform vec2 u_textureSize;

            void main(void) {
                float weight[5];
                weight[0] = 0.227027;
                weight[1] = 0.1945946;
                weight[2] = 0.1216216;
                weight[3] = 0.054054;
                weight[4] = 0.016216;
                vec2 texel = 1.0 / u_textureSize;
                vec3 result = texture2D(u_lightTexture, v_texcoord0).rgb * weight[0];
                for (int sampleIndex = 1; sampleIndex < 5; ++sampleIndex) {
                    float offset = texel.x * float(sampleIndex);
                    result += texture2D(u_lightTexture, v_texcoord0 + vec2(offset, 0.0)).rgb * weight[sampleIndex];
                    result += texture2D(u_lightTexture, v_texcoord0 - vec2(offset, 0.0)).rgb * weight[sampleIndex];
                }
                gl_FragColor = vec4(result, 1.0);
            }
        `,
        uniforms: {
            u_textureSize: { get: () => textureSize },
            u_lightTexture: {
                get: (_mesh, _material, programInfo) =>
                    Hilo3d.semantic.handlerTexture(
                        requireFramebufferTexture(lightPass.framebuffer, 'Light extraction pass'),
                        requireTextureIndex(programInfo)
                    )
            }
        }
    }).addTo(postProcessRenderer);

    const blurYPass = new ScreenShaderPass(sceneRenderer, {
        width: blurWidth,
        height: blurHeight,
        framebufferOption: {
            minFilter: Hilo3d.constants.NEAREST,
            magFilter: Hilo3d.constants.LINEAR
        },
        frag: `
            precision HILO_MAX_FRAGMENT_PRECISION float;
            uniform sampler2D u_lastTexture;
            varying vec2 v_texcoord0;
            uniform vec2 u_textureSize;

            void main(void) {
                float weight[5];
                weight[0] = 0.227027;
                weight[1] = 0.1945946;
                weight[2] = 0.1216216;
                weight[3] = 0.054054;
                weight[4] = 0.016216;
                vec2 texel = 1.0 / u_textureSize;
                vec3 result = texture2D(u_lastTexture, v_texcoord0).rgb * weight[0];
                for (int sampleIndex = 1; sampleIndex < 5; ++sampleIndex) {
                    float offset = texel.y * float(sampleIndex);
                    result += texture2D(u_lastTexture, v_texcoord0 + vec2(0.0, offset)).rgb * weight[sampleIndex];
                    result += texture2D(u_lastTexture, v_texcoord0 - vec2(0.0, offset)).rgb * weight[sampleIndex];
                }
                gl_FragColor = vec4(result, 1.0);
            }
        `,
        uniforms: {
            u_textureSize: { get: () => textureSize }
        }
    }).addTo(postProcessRenderer);

    blurPasses.push(blurYPass);
}

let bloomStrength = 1;
new ScreenShaderPass(sceneRenderer, {
    frag: `
        precision HILO_MAX_FRAGMENT_PRECISION float;
        uniform sampler2D u_blurTexture0;
        uniform sampler2D u_blurTexture1;
        uniform sampler2D u_blurTexture2;
        uniform sampler2D u_blurTexture3;
        uniform sampler2D u_blurTexture4;
        uniform sampler2D u_scene;
        uniform float u_bloomStrength;
        varying vec2 v_texcoord0;

        void main(void) {
            vec3 color = texture2D(u_scene, v_texcoord0).rgb;
            color += texture2D(u_blurTexture0, v_texcoord0).rgb * u_bloomStrength;
            color += texture2D(u_blurTexture1, v_texcoord0).rgb * u_bloomStrength;
            color += texture2D(u_blurTexture2, v_texcoord0).rgb * u_bloomStrength;
            color += texture2D(u_blurTexture3, v_texcoord0).rgb * u_bloomStrength;
            color += texture2D(u_blurTexture4, v_texcoord0).rgb * u_bloomStrength;
            vec3 result = vec3(1.0) - exp(-color * 0.8);
            gl_FragColor = vec4(result, 1.0);
        }
    `,
    uniforms: {
        u_scene: {
            get: (_mesh, _material, programInfo) =>
                Hilo3d.semantic.handlerTexture(
                    requireFramebufferTexture(sceneRenderer.framebuffer, 'Scene'),
                    requireTextureIndex(programInfo)
                )
        },
        ...Object.fromEntries(
            blurPasses.map((pass, index) => [
                `u_blurTexture${String(index)}`,
                {
                    get: (
                        _mesh: Hilo3d.Mesh,
                        _material: Hilo3d.Material,
                        programInfo: Hilo3d.ProgramBindingInfo
                    ) =>
                        Hilo3d.semantic.handlerTexture(
                            requireFramebufferTexture(
                                pass.framebuffer,
                                `Blur pass ${String(index)}`
                            ),
                            requireTextureIndex(programInfo)
                        )
                }
            ])
        ),
        u_bloomStrength: { get: () => bloomStrength }
    },
    renderToScreen: true
}).addTo(postProcessRenderer);

function random(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

function initScene(): void {
    camera.far = 5;
    stage.rotationX = 25;

    const boxGeometry = new Hilo3d.BoxGeometry();
    boxGeometry.setAllRectUV([
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0]
    ]);
    const sphereGeometry = new Hilo3d.SphereGeometry({ radius: 0.7 });

    for (let index = 0; index < 50; index++) {
        const speed = random(0.5, 1);
        const colorBox = new Hilo3d.Mesh({
            geometry: random(0, 1) > 0.5 ? boxGeometry : sphereGeometry,
            material: new Hilo3d.BasicMaterial({
                lightType: 'NONE',
                diffuse: new Hilo3d.Color(random(0.5, 1), random(0.5, 1), random(0.5, 1))
            }),
            x: random(-1.5, 1.5),
            y: random(-1.5, 1.5),
            z: random(-1.5, 1.5)
        });
        colorBox.onUpdate = () => {
            colorBox.rotationX += speed;
            colorBox.rotationY += speed;
        };
        colorBox.setScale(random(0.05, 0.08));
        stage.addChild(colorBox);
    }

    stage.onUpdate = function () {
        this.rotationX += 0.5;
        this.rotationY += 0.5;
    };
}

initScene();

const bloomAnimation = { num: 0 };
Hilo3d.Tween.to(
    bloomAnimation,
    { num: 0.8 },
    {
        ease: Hilo3d.Tween.Ease.Quad.EaseOut,
        duration: 1000,
        loop: true,
        reverse: true,
        onUpdate: () => {
            bloomStrength = bloomAnimation.num;
        }
    }
);
