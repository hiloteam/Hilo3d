import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './js/init';

const { stage, ticker } = createExampleContext({
    camera: { far: 20_000, near: 0.1, z: 1000 },
    stage: { alpha: true, clearColor: new Hilo3d.Color(0, 0, 0) },
    controls: { isLockMove: true }
});

function createSnowflakeTexture(size = 32): Hilo3d.DataTexture {
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
    return new Hilo3d.DataTexture({
        data: pixels,
        width: size,
        height: size,
        wrapS: Hilo3d.constants.CLAMP_TO_EDGE,
        wrapT: Hilo3d.constants.CLAMP_TO_EDGE
    });
}

const particleCount = 10_000;
const positions = new Float32Array(particleCount * 3);
for (let index = 0; index < particleCount; index++) {
    const offset = index * 3;
    positions[offset] = Math.random() * 2000 - 1000;
    positions[offset + 1] = Math.random() * 2000 - 1000;
    positions[offset + 2] = Math.random() * 2000 - 1000;
}
const geometry = new Hilo3d.Geometry({
    mode: Hilo3d.constants.POINTS,
    vertices: new Hilo3d.GeometryData(positions, 3)
});
const snowflakeTexture = createSnowflakeTexture();
const fragmentShader = `
    precision HILO_MAX_FRAGMENT_PRECISION float;
    uniform sampler2D u_diffuse;
    void main(void) {
        vec4 color = texture2D(u_diffuse, gl_PointCoord);
        if (color.a < 0.01) discard;
        gl_FragColor = color;
    }
`;
const vertexShader = `
    precision HILO_MAX_VERTEX_PRECISION float;
    attribute vec3 a_position;
    uniform mat4 u_modelViewProjectionMatrix;
    uniform float u_pointSize;
    void main(void) {
        gl_Position = u_modelViewProjectionMatrix * vec4(a_position, 1.0);
        gl_PointSize = u_pointSize * (400.0 / abs(gl_Position.z));
    }
`;

function createParticleMaterial(pointSize: number): Hilo3d.ShaderMaterial {
    return new Hilo3d.ShaderMaterial({
        uniforms: {
            u_modelViewProjectionMatrix: 'MODELVIEWPROJECTION',
            u_pointSize: { get: () => pointSize },
            u_diffuse: {
                get: (_mesh, _material, programInfo) => {
                    if (programInfo.textureIndex === undefined) {
                        throw new Error('u_diffuse is not a sampler uniform.');
                    }
                    return Hilo3d.semantic.handlerTexture(
                        snowflakeTexture,
                        programInfo.textureIndex
                    );
                }
            }
        },
        attributes: { a_position: 'POSITION' },
        blend: true,
        transparent: true,
        depthMask: false,
        fs: fragmentShader,
        vs: vertexShader
    });
}

const particleMeshes = [40, 35, 20, 10, 50].map(pointSize => {
    const mesh = new Hilo3d.Mesh({ geometry, material: createParticleMaterial(pointSize) });
    mesh.rotationX = Math.random() * 600;
    mesh.rotationY = Math.random() * 600;
    mesh.rotationZ = Math.random() * 600;
    return mesh.addTo(stage);
});

ticker.addTick({
    tick(): void {
        const time = performance.now() * 0.00005;
        particleMeshes.forEach((mesh, index) => {
            const direction = index < 4 ? index + 1 : -(index + 1);
            mesh.rotationY = time * direction * 10;
        });
    }
});
