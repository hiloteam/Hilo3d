import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage } = await createExampleContext({
    camera: { far: 20_000, near: 0.1, z: 1000 },
    stage: { alpha: true, clearColor: new Hilo3d.Color(0, 0, 0), useInstanced: true },
    controls: { enablePan: false }
});

function createSnowflakeTexture(size = 32): Hilo3d.Texture<Uint8Array> {
    const pixels = new Uint8Array(size * size * 4);
    const center = (size - 1) / 2;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const distance = Math.hypot(x - center, y - center) / center;
            const alpha = Math.max(0, Math.min(255, Math.round((1 - distance) * 255)));
            const offset = (y * size + x) * 4;
            pixels[offset] = 255;
            pixels[offset + 1] = 255;
            pixels[offset + 2] = 255;
            pixels[offset + 3] = alpha;
        }
    }
    return new Hilo3d.Texture({
        image: pixels,
        width: size,
        height: size,
        internalFormat: Hilo3d.constants.RGBA8,
        format: Hilo3d.constants.RGBA,
        type: Hilo3d.constants.UNSIGNED_BYTE,
        wrapS: Hilo3d.constants.CLAMP_TO_EDGE,
        wrapT: Hilo3d.constants.CLAMP_TO_EDGE
    });
}

const geometry = new Hilo3d.Geometry({
    mode: Hilo3d.constants.TRIANGLES,
    vertices: new Hilo3d.GeometryData(
        new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]),
        2
    ),
    uvs: new Hilo3d.GeometryData(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2),
    indices: new Hilo3d.GeometryData(new Uint16Array([0, 1, 2, 0, 2, 3]), 1)
});
const snowflakeTexture = createSnowflakeTexture();
const fragmentShader = `#version 300 es
    precision highp float;
    in vec2 v_uv;
    uniform sampler2D u_diffuse;
    layout(location = 0) out vec4 fragmentColor;
    void main(void) {
        vec4 color = texture(u_diffuse, v_uv);
        if (color.a < 0.01) discard;
        fragmentColor = color;
    }
`;
const vertexShader = `#version 300 es
    precision highp float;
    in vec2 a_corner;
    in vec2 a_uv;
    in vec4 u_particleData;
    in vec3 u_particleMotion;
    out vec2 v_uv;

    layout(std140) uniform FrameBlock {
        vec2 u_rendererSize;
        float u_time;
        float u_frameIndex;
    };

    layout(std140) uniform CameraBlock {
        mat4 u_viewMatrix;
        mat4 u_projectionMatrix;
        mat4 u_viewProjectionMatrix;
    };

    void main(void) {
        float angle = u_particleMotion.y + u_time * u_particleMotion.x;
        float sine = sin(angle);
        float cosine = cos(angle);
        vec2 rotatedXZ = mat2(cosine, sine, -sine, cosine) * u_particleData.xz;
        float wrappedY = mod(
            u_particleData.y + 1000.0 - u_time * u_particleMotion.z,
            2000.0
        ) - 1000.0;
        vec3 center = vec3(rotatedXZ.x, wrappedY, rotatedXZ.y);
        vec4 clipPosition = u_viewProjectionMatrix * vec4(center, 1.0);

        float depth = max(abs(clipPosition.z), 1.0);
        float pixelSize = clamp(u_particleData.w * 400.0 / depth, 1.0, 128.0);
        clipPosition.xy += a_corner * pixelSize * (2.0 * clipPosition.w / u_rendererSize);

        v_uv = a_uv;
        gl_Position = clipPosition;
    }
`;

class SnowParticle {
    readonly data: Float32Array;
    readonly motion: Float32Array;

    constructor(
        x: number,
        y: number,
        z: number,
        size: number,
        angularVelocity: number,
        phase: number,
        fallSpeed: number
    ) {
        this.data = new Float32Array([x, y, z, size]);
        this.motion = new Float32Array([angularVelocity, phase, fallSpeed]);
    }
}

function particleOf(mesh: Hilo3d.Mesh): SnowParticle {
    if (!(mesh.userData instanceof SnowParticle)) {
        throw new TypeError(`Snow particle ${mesh.id} has invalid instance data`);
    }
    return mesh.userData;
}

const material = new Hilo3d.ShaderMaterial({
    uniforms: {
        u_diffuse: {
            get: () => snowflakeTexture
        },
        u_particleData: {
            isDependMesh: true,
            get: mesh => particleOf(mesh).data
        },
        u_particleMotion: {
            isDependMesh: true,
            get: mesh => particleOf(mesh).motion
        }
    },
    attributes: {
        a_corner: Hilo3d.MaterialAttributeSemantic.POSITION,
        a_uv: Hilo3d.MaterialAttributeSemantic.TEXCOORD_0
    },
    compositing: { mode: 'alpha-blend', premultiplied: false },
    cullMode: 'none',
    fs: fragmentShader,
    vs: vertexShader
});

const layers = [
    { size: 40, angularVelocity: 0.12, fallSpeed: 24 },
    { size: 35, angularVelocity: 0.18, fallSpeed: 30 },
    { size: 20, angularVelocity: 0.24, fallSpeed: 36 },
    { size: 10, angularVelocity: 0.3, fallSpeed: 42 },
    { size: 50, angularVelocity: -0.36, fallSpeed: 48 }
] as const;
const particleCount = 10_000;
for (let index = 0; index < particleCount; index++) {
    const layer = layers[index % layers.length];
    if (!layer) throw new Error('Snow particle layer configuration is empty');
    new Hilo3d.Mesh({
        name: `snow-${String(index)}`,
        geometry,
        material,
        useInstanced: true,
        frustumTest: false,
        pointerEnabled: false,
        autoUpdateWorldMatrix: false,
        castShadows: false,
        receiveShadows: false,
        userData: new SnowParticle(
            Math.random() * 2000 - 1000,
            Math.random() * 2000 - 1000,
            Math.random() * 2000 - 1000,
            layer.size,
            layer.angularVelocity,
            Math.random() * Math.PI * 2,
            layer.fallSpeed + Math.random() * 12
        )
    }).addTo(stage);
}
