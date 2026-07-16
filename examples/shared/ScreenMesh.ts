import * as Hilo3d from '../../src/Hilo3d';

export interface ScreenRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface ScreenMeshParameters {
    readonly fragmentShader: string;
    readonly samplers?: Readonly<
        Record<string, () => Hilo3d.Texture<unknown> | readonly Hilo3d.Texture<unknown>[]>
    >;
    readonly uniformBlocks?: Readonly<Record<string, Hilo3d.UniformBuffer>>;
    readonly rect?: ScreenRect;
    readonly label?: string;
    readonly blend?: boolean;
    readonly renderOrder?: number;
}

function clipRect(rect: ScreenRect): readonly [number, number, number, number] {
    const values = [rect.x, rect.y, rect.width, rect.height];
    if (!values.every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
        throw new RangeError(
            'Screen-space rectangles require finite coordinates and positive size.'
        );
    }
    const left = rect.x * 2 - 1;
    const right = (rect.x + rect.width) * 2 - 1;
    const bottom = rect.y * 2 - 1;
    const top = (rect.y + rect.height) * 2 - 1;
    return [left, right, bottom, top];
}

/** Create a camera-independent screen-space mesh that participates in a normal scene render. */
export function createScreenMesh(parameters: ScreenMeshParameters): Hilo3d.Mesh {
    const [left, right, bottom, top] = clipRect(
        parameters.rect ?? { x: 0, y: 0, width: 1, height: 1 }
    );
    const vertexShader = Hilo3d.Shader.shaders['screen.vert'];
    if (!vertexShader) throw new Error('Built-in fullscreen vertex shader is unavailable.');
    const label = parameters.label ?? Hilo3d.math.generateUUID('ScreenMesh');
    const uniforms: Hilo3d.MaterialBindingMap = Object.fromEntries(
        Object.entries(parameters.samplers ?? {}).map(([name, provider]) => [
            name,
            { get: () => provider() }
        ])
    );
    const material = new Hilo3d.ShaderMaterial({
        shaderName: label,
        shaderCacheId: label,
        needBasicAttributes: false,
        needBasicUniforms: false,
        depthTest: false,
        depthMask: false,
        cullFace: false,
        blend: parameters.blend ?? false,
        side: Hilo3d.constants.FRONT_AND_BACK,
        renderOrder: parameters.renderOrder ?? 10_000,
        attributes: {
            a_position: 'POSITION',
            a_texcoord0: 'TEXCOORD_0'
        },
        uniforms,
        uniformBlocks: { ...(parameters.uniformBlocks ?? {}) },
        vs: vertexShader,
        fs: parameters.fragmentShader
    });
    return new Hilo3d.Mesh({
        geometry: new Hilo3d.Geometry({
            mode: Hilo3d.constants.TRIANGLE_STRIP,
            vertices: new Hilo3d.GeometryData(
                new Float32Array([left, top, right, top, left, bottom, right, bottom]),
                2
            ),
            uvs: new Hilo3d.GeometryData(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2)
        }),
        material,
        frustumTest: false
    });
}

export function createTexturePreview(
    texture: () => Hilo3d.Texture<unknown>,
    rect?: ScreenRect,
    label?: string
): Hilo3d.Mesh {
    return createScreenMesh({
        ...(rect ? { rect } : {}),
        ...(label ? { label } : {}),
        samplers: { u_texture: texture },
        fragmentShader: `#version 300 es
            precision highp float;
            in vec2 v_texcoord0;
            uniform sampler2D u_texture;
            layout(location = 0) out vec4 fragmentColor;
            void main(void) {
                fragmentColor = texture(u_texture, v_texcoord0);
            }
        `
    });
}
