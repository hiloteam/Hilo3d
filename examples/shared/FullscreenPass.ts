import * as Hilo3d from '../../src/Hilo3d';

export type FullscreenSamplerValue = Hilo3d.Texture<unknown> | readonly Hilo3d.Texture<unknown>[];

export type FullscreenSamplerProvider = () => FullscreenSamplerValue;

export interface FullscreenPassParameters {
    readonly renderer: Hilo3d.Renderer;
    readonly fragmentShader: string;
    readonly vertexShader?: string;
    readonly samplers?: Readonly<Record<string, FullscreenSamplerProvider>>;
    readonly uniformBlocks?: Readonly<Record<string, Hilo3d.UniformBuffer>>;
    readonly prepare?: () => void;
    readonly label?: string;
    readonly blend?: boolean;
    readonly premultiplyAlpha?: boolean;
}

function createScreenGeometry(): Hilo3d.Geometry {
    return new Hilo3d.Geometry({
        mode: Hilo3d.constants.TRIANGLE_STRIP,
        vertices: new Hilo3d.GeometryData(new Float32Array([-1, 1, 1, 1, -1, -1, 1, -1]), 2),
        uvs: new Hilo3d.GeometryData(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2)
    });
}

function createSamplerBindings(
    samplers: Readonly<Record<string, FullscreenSamplerProvider>>
): Hilo3d.MaterialBindingMap {
    return Object.fromEntries(
        Object.entries(samplers).map(([name, provider]) => [
            name,
            {
                get: () => provider()
            }
        ])
    );
}

/** Backend-neutral fullscreen draw implemented through the public scene renderer contract. */
export class FullscreenPass {
    readonly renderer: Hilo3d.Renderer;
    readonly scene = new Hilo3d.Node();
    readonly camera = new Hilo3d.Camera();
    readonly geometry = createScreenGeometry();
    readonly material: Hilo3d.ShaderMaterial;
    readonly mesh: Hilo3d.Mesh;

    private readonly prepare: (() => void) | undefined;

    constructor(parameters: FullscreenPassParameters) {
        const vertexShader = parameters.vertexShader ?? Hilo3d.Shader.shaders['screen.vert'];
        if (!vertexShader) throw new Error('Built-in fullscreen vertex shader is unavailable.');
        const label = parameters.label ?? Hilo3d.math.generateUUID('FullscreenPass');
        this.renderer = parameters.renderer;
        this.prepare = parameters.prepare;
        this.material = new Hilo3d.ShaderMaterial({
            sourceRevision: label,
            state: { depthTest: false, depthWrite: false, cullMode: 'none' },
            compositing:
                parameters.blend === true
                    ? {
                          mode: 'alpha-blend',
                          premultiplied: parameters.premultiplyAlpha ?? false
                      }
                    : { mode: 'opaque' },
            cullMode: 'none',
            attributes: {
                a_position: Hilo3d.MaterialAttributeSemantic.POSITION,
                a_texcoord0: Hilo3d.MaterialAttributeSemantic.TEXCOORD_0
            },
            uniforms: createSamplerBindings(parameters.samplers ?? {}),
            uniformBlocks: { ...(parameters.uniformBlocks ?? {}) },
            vs: vertexShader,
            fs: parameters.fragmentShader
        });
        this.mesh = new Hilo3d.Mesh({
            geometry: this.geometry,
            material: this.material,
            frustumTest: false
        });
        this.scene.addChild(this.mesh);
    }

    render(target: Hilo3d.RenderTarget | null = null): void {
        this.prepare?.();
        if (target) {
            this.renderer.renderToTarget(target, this.scene, this.camera, false);
            return;
        }
        if (this.renderer.renderTarget !== null) {
            throw new Error(
                'FullscreenPass cannot render to the canvas while a persistent render target is selected.'
            );
        }
        this.renderer.render(this.scene, this.camera, false);
    }

    destroy(): void {
        this.scene.destroy(this.renderer);
    }
}
