import * as Hilo3d from '../src/Hilo3d';
import { BloomParticleField } from './shared/bloomParticles';
import { applyEnvironmentMaps } from './shared/environment';
import { createExampleContext, loadEnvironmentMaps } from './shared/init';

const TAU = Math.PI * 2;
const ARTWORK_CENTER_X = 0.48;
const ARTWORK_CENTER_Y = 0.28;
const query = new URL(location.href).searchParams;
const bloomEnabled = query.get('bloom') !== 'off';
let motionEnabled = query.get('motion') !== 'off';

function requireElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Bloom showcase is missing ${selector}`);
    return element;
}

function requireButton(selector: string): HTMLButtonElement {
    const button = document.querySelector<HTMLButtonElement>(selector);
    if (!button) throw new Error(`Bloom showcase is missing ${selector}`);
    return button;
}

function createTorusGeometry(
    majorRadius: number,
    minorRadius: number,
    majorSegments = 112,
    minorSegments = 14
): Hilo3d.Geometry {
    const rowSize = minorSegments + 1;
    const vertexCount = (majorSegments + 1) * rowSize;
    const vertices = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = new Uint16Array(majorSegments * minorSegments * 6);
    let vertexOffset = 0;
    let uvOffset = 0;

    for (let major = 0; major <= majorSegments; major += 1) {
        const u = major / majorSegments;
        const majorAngle = u * TAU;
        const majorCos = Math.cos(majorAngle);
        const majorSin = Math.sin(majorAngle);
        for (let minor = 0; minor <= minorSegments; minor += 1) {
            const v = minor / minorSegments;
            const minorAngle = v * TAU;
            const minorCos = Math.cos(minorAngle);
            const minorSin = Math.sin(minorAngle);
            const radius = majorRadius + minorRadius * minorCos;
            vertices[vertexOffset] = radius * majorCos;
            vertices[vertexOffset + 1] = radius * majorSin;
            vertices[vertexOffset + 2] = minorRadius * minorSin;
            normals[vertexOffset] = minorCos * majorCos;
            normals[vertexOffset + 1] = minorCos * majorSin;
            normals[vertexOffset + 2] = minorSin;
            vertexOffset += 3;
            uvs[uvOffset] = u;
            uvs[uvOffset + 1] = v;
            uvOffset += 2;
        }
    }

    let indexOffset = 0;
    for (let major = 0; major < majorSegments; major += 1) {
        for (let minor = 0; minor < minorSegments; minor += 1) {
            const current = major * rowSize + minor;
            const next = (major + 1) * rowSize + minor;
            indices[indexOffset] = current;
            indices[indexOffset + 1] = next;
            indices[indexOffset + 2] = current + 1;
            indices[indexOffset + 3] = next;
            indices[indexOffset + 4] = next + 1;
            indices[indexOffset + 5] = current + 1;
            indexOffset += 6;
        }
    }

    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(vertices, 3),
        normals: new Hilo3d.GeometryData(normals, 3),
        uvs: new Hilo3d.GeometryData(uvs, 2),
        indices: new Hilo3d.GeometryData(indices, 1)
    });
}

function createGlowPlaneGeometry(
    centerX: number,
    centerY: number,
    z: number,
    width: number,
    height: number
): Hilo3d.Geometry {
    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(
            new Float32Array([
                centerX - halfWidth,
                centerY + halfHeight,
                z,
                centerX + halfWidth,
                centerY + halfHeight,
                z,
                centerX - halfWidth,
                centerY - halfHeight,
                z,
                centerX + halfWidth,
                centerY - halfHeight,
                z
            ]),
            3
        ),
        uvs: new Hilo3d.GeometryData(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2),
        indices: new Hilo3d.GeometryData(new Uint16Array([0, 2, 1, 1, 2, 3]), 1)
    });
}

function createSkyMaterial(): Hilo3d.ShaderMaterial {
    return new Hilo3d.ShaderMaterial({
        name: 'Nocturne procedural sky',
        shaderCacheId: 'BloomNocturneSky',
        attributes: { a_position: 'POSITION' },
        depthTest: false,
        depthMask: false,
        cullFace: true,
        side: Hilo3d.constants.BACK,
        castShadows: false,
        receiveShadows: false,
        renderOrder: -1000,
        vs: `#version 300 es
precision highp float;
in vec3 a_position;
out vec3 v_direction;
layout(std140) uniform CameraBlock {
    mat4 u_viewMatrix;
    mat4 u_projectionMatrix;
    mat4 u_viewProjectionMatrix;
};
void main() {
    v_direction = a_position;
    vec4 clip = u_projectionMatrix * vec4(mat3(u_viewMatrix) * a_position, 1.0);
    gl_Position = clip.xyww;
}`,
        fs: `#version 300 es
precision highp float;
in vec3 v_direction;
layout(location = 0) out vec4 color;

float hash31(vec3 point) {
    point = fract(point * 0.1031);
    point += dot(point, point.yzx + 33.33);
    return fract((point.x + point.y) * point.z);
}

float valueNoise(vec3 point) {
    vec3 cell = floor(point);
    vec3 local = fract(point);
    vec3 curve = local * local * (3.0 - 2.0 * local);
    float x00 = mix(hash31(cell), hash31(cell + vec3(1.0, 0.0, 0.0)), curve.x);
    float x10 = mix(
        hash31(cell + vec3(0.0, 1.0, 0.0)),
        hash31(cell + vec3(1.0, 1.0, 0.0)),
        curve.x
    );
    float x01 = mix(
        hash31(cell + vec3(0.0, 0.0, 1.0)),
        hash31(cell + vec3(1.0, 0.0, 1.0)),
        curve.x
    );
    float x11 = mix(
        hash31(cell + vec3(0.0, 1.0, 1.0)),
        hash31(cell + vec3(1.0, 1.0, 1.0)),
        curve.x
    );
    return mix(mix(x00, x10, curve.y), mix(x01, x11, curve.y), curve.z);
}

void main() {
    vec3 direction = normalize(v_direction);
    float vertical = direction.y * 0.5 + 0.5;
    vec3 base = mix(vec3(0.001, 0.0015, 0.006), vec3(0.008, 0.014, 0.035), vertical);

    float cloud = valueNoise(direction * 3.1 + vec3(2.4, 6.8, 1.7));
    cloud += valueNoise(direction * 6.3 + vec3(8.1, 2.2, 5.4)) * 0.46;
    float veil = smoothstep(0.82, 1.2, cloud)
        * smoothstep(-0.45, 0.38, direction.y + direction.x * 0.22);
    base += vec3(0.018, 0.034, 0.085) * veil;
    base += vec3(0.045, 0.014, 0.055)
        * smoothstep(0.98, 1.27, cloud)
        * smoothstep(-0.2, 0.7, direction.x);

    vec3 starCell = floor(direction * 610.0);
    float seed = hash31(starCell);
    float star = smoothstep(0.9976, 1.0, seed);
    float temperature = hash31(starCell + 19.7);
    vec3 starColor = mix(vec3(0.38, 0.72, 1.55), vec3(2.2, 1.15, 0.42), temperature);
    base += starColor * star * (0.7 + temperature * 2.8);

    float horizon = pow(max(0.0, 1.0 - abs(direction.y + 0.16)), 15.0);
    base += vec3(0.018, 0.04, 0.085) * horizon;
    color = vec4(base, 1.0);
}`
    });
}

function createAuraMaterial(): Hilo3d.ShaderMaterial {
    return new Hilo3d.ShaderMaterial({
        name: 'Premultiplied celestial aura',
        shaderCacheId: 'BloomNocturneAura',
        attributes: {
            a_position: 'POSITION',
            a_texcoord0: 'TEXCOORD_0'
        },
        transparent: true,
        premultiplyAlpha: true,
        depthMask: false,
        castShadows: false,
        receiveShadows: false,
        renderOrder: -120,
        vs: `#version 300 es
precision highp float;
in vec3 a_position;
in vec2 a_texcoord0;
out vec2 v_uv;
layout(std140) uniform CameraBlock {
    mat4 u_viewMatrix;
    mat4 u_projectionMatrix;
    mat4 u_viewProjectionMatrix;
};
void main() {
    v_uv = a_texcoord0;
    gl_Position = u_viewProjectionMatrix * vec4(a_position, 1.0);
}`,
        fs: `#version 300 es
precision highp float;
in vec2 v_uv;
layout(location = 0) out vec4 color;
void main() {
    vec2 centered = (v_uv - 0.5) * 2.0;
    float radius = length(centered);
    float mist = exp(-radius * radius * 3.8);
    float corona = exp(-pow(abs(radius - 0.38) * 8.0, 2.0));
    float alpha = (mist * 0.13 + corona * 0.055) * (1.0 - smoothstep(0.72, 1.0, radius));
    vec3 warm = vec3(2.4, 0.58, 0.12) * corona;
    vec3 cool = vec3(0.08, 0.38, 1.35) * mist;
    color = vec4((warm + cool) * alpha, alpha);
}`
    });
}

function createGlowMaterial(
    red: number,
    green: number,
    blue: number,
    opacity = 1
): Hilo3d.BasicMaterial {
    return new Hilo3d.BasicMaterial({
        lightType: 'NONE',
        diffuse: new Hilo3d.Color(red, green, blue),
        transparent: opacity < 1,
        transparency: opacity,
        depthMask: opacity >= 1,
        castShadows: false,
        receiveShadows: false
    });
}

function addTemple(
    root: Hilo3d.Node,
    darkMaterial: Hilo3d.PBRMaterial,
    goldGlow: Hilo3d.BasicMaterial,
    cyanGlow: Hilo3d.BasicMaterial
): void {
    const pillarGeometry = new Hilo3d.BoxGeometry({ width: 0.24, height: 4.4, depth: 0.3 });
    const beamGeometry = new Hilo3d.BoxGeometry({ width: 0.2, height: 3.7, depth: 0.28 });
    const inlayGeometry = new Hilo3d.BoxGeometry({ width: 0.025, height: 3.65, depth: 0.018 });
    for (const side of [-1, 1] as const) {
        new Hilo3d.Mesh({
            name: side < 0 ? 'Left obsidian portal' : 'Right obsidian portal',
            geometry: pillarGeometry,
            material: darkMaterial,
            x: side * 2.9,
            y: 0.28,
            z: -0.92,
            rotationZ: side * -2.5
        }).addTo(root);
        new Hilo3d.Mesh({
            geometry: inlayGeometry,
            material: side < 0 ? cyanGlow : goldGlow,
            x: side * 2.77,
            y: 0.24,
            z: -0.755,
            rotationZ: side * -2.5
        }).addTo(root);
        new Hilo3d.Mesh({
            geometry: beamGeometry,
            material: darkMaterial,
            x: side * 1.72,
            y: 2.55,
            z: -0.96,
            rotationZ: side * 39
        }).addTo(root);
        new Hilo3d.Mesh({
            geometry: new Hilo3d.BoxGeometry({ width: 0.025, height: 2.8, depth: 0.02 }),
            material: side < 0 ? goldGlow : cyanGlow,
            x: side * 1.65,
            y: 2.53,
            z: -0.79,
            rotationZ: side * 39
        }).addTo(root);
    }

    const pathGeometry = new Hilo3d.BoxGeometry({ width: 0.024, height: 0.015, depth: 8 });
    for (const [x, material] of [
        [-1.78, cyanGlow],
        [1.78, goldGlow]
    ] as const) {
        new Hilo3d.Mesh({
            geometry: pathGeometry,
            material,
            x,
            y: -1.505,
            z: 1.75
        }).addTo(root);
    }
}

function addLotusBase(
    root: Hilo3d.Node,
    petalMaterials: readonly [Hilo3d.PBRMaterial, Hilo3d.PBRMaterial],
    goldGlow: Hilo3d.BasicMaterial,
    cyanGlow: Hilo3d.BasicMaterial
): void {
    const petalGeometry = new Hilo3d.SphereGeometry({
        radius: 0.5,
        heightSegments: 18,
        widthSegments: 28
    });
    for (let index = 0; index < 14; index += 1) {
        const progress = index / 14;
        const angle = progress * TAU;
        const petal = new Hilo3d.Mesh({
            name: `Metal lotus petal ${String(index + 1)}`,
            geometry: petalGeometry,
            material: petalMaterials[index % petalMaterials.length] ?? petalMaterials[0],
            x: Math.cos(angle) * 0.78,
            y: -1.18 + Math.sin(angle * 2) * 0.025,
            z: Math.sin(angle) * 0.78 + 0.08,
            rotationY: -progress * 360,
            rotationX: 7
        }).addTo(root);
        petal.setScale(0.48, 0.12, 1.48);
    }

    const plinth = new Hilo3d.Mesh({
        geometry: new Hilo3d.SphereGeometry({
            radius: 1,
            heightSegments: 24,
            widthSegments: 42
        }),
        material: petalMaterials[0],
        y: -1.42,
        z: 0.08
    }).addTo(root);
    plinth.setScale(1.46, 0.16, 1.08);

    const horizontalRing = new Hilo3d.Mesh({
        geometry: createTorusGeometry(1.15, 0.026, 96, 10),
        material: goldGlow,
        y: -1.29,
        z: 0.08,
        rotationX: 90
    }).addTo(root);
    horizontalRing.setScale(1, 0.72, 1);

    const seedGeometry = new Hilo3d.SphereGeometry({
        radius: 0.035,
        heightSegments: 8,
        widthSegments: 12
    });
    for (let index = 0; index < 14; index += 1) {
        const angle = (index / 14) * TAU;
        new Hilo3d.Mesh({
            geometry: seedGeometry,
            material: index % 2 === 0 ? goldGlow : cyanGlow,
            x: Math.cos(angle) * 1.46,
            y: -1.22 + Math.sin(angle * 3) * 0.045,
            z: Math.sin(angle) * 1.02 + 0.08,
            pointerEnabled: false
        }).addTo(root);
    }
}

function addOrbitalRelics(root: Hilo3d.Node, material: Hilo3d.PBRMaterial): Hilo3d.Node {
    const relicRoot = new Hilo3d.Node({ name: 'Floating orbital relics' }).addTo(root);
    const geometry = new Hilo3d.BoxGeometry({ width: 0.045, height: 0.32, depth: 0.075 });
    for (let index = 0; index < 26; index += 1) {
        const angle = (index / 26) * TAU;
        const radius = 1.72 + (index % 3) * 0.12;
        const relic = new Hilo3d.Mesh({
            geometry,
            material,
            x: Math.cos(angle) * radius,
            y: Math.sin(angle * 3) * 0.34,
            z: Math.sin(angle) * radius * 0.54,
            rotationX: 14 + Math.sin(angle) * 42,
            rotationY: 90 - (index / 26) * 360,
            rotationZ: index % 2 === 0 ? 12 : -12,
            pointerEnabled: false
        }).addTo(relicRoot);
        relic.setScale(0.7 + (index % 5) * 0.09);
    }
    return relicRoot;
}

const particleField = new BloomParticleField();
const { camera, stage, renderer, directionLight, ambientLight, ticker } =
    await createExampleContext({
        backend: 'webgpu',
        camera: {
            fov: 36,
            near: 0.05,
            far: 90,
            x: 0.42,
            y: 0.9,
            z: 8.8
        },
        stage: {
            renderPipeline: new Hilo3d.PostProcessRenderPipelineFactory({
                bloom: bloomEnabled
                    ? {
                          threshold: 1.05,
                          knee: 0.62,
                          clamp: 32,
                          intensity: 0.74,
                          scatter: 0.78,
                          tint: new Hilo3d.Color(1, 0.94, 0.88),
                          maxLevels: 8,
                          minResolution: 12
                      }
                    : false,
                colorUber: {
                    exposure: -0.52,
                    contrast: 0.11,
                    saturation: 0.08,
                    temperature: 0.035,
                    tint: -0.025,
                    lift: new Hilo3d.Color(0.002, 0.004, 0.012),
                    gain: new Hilo3d.Color(1.02, 0.99, 0.96),
                    toneMapping: 'pbr-neutral',
                    vignetteIntensity: 0.72,
                    vignetteSmoothness: 0.6,
                    vignetteColor: new Hilo3d.Color(0.001, 0.002, 0.009, 0.68),
                    dithering: true
                },
                opaqueTexture: false,
                features: [particleField.feature]
            }),
            useInstanced: false
        },
        controls: {
            enablePan: false,
            minDistance: 6.5,
            maxDistance: 11.5,
            target: new Hilo3d.Vector3(ARTWORK_CENTER_X, 0.12, 0),
            minPolarAngle: Math.PI / 2 - 0.34,
            maxPolarAngle: Math.PI / 2 + 0.27
        },
        autoStart: false
    });

renderer.clearColor.set(0.001, 0.0015, 0.006, 1);
camera.lookAt(new Hilo3d.Vector3(ARTWORK_CENTER_X, 0.12, 0));
directionLight.amount = 1.15;
directionLight.color.set(0.64, 0.74, 1, 1);
directionLight.direction.set(-0.62, -0.88, -0.48);
ambientLight.amount = 0.045;
ambientLight.color.set(0.28, 0.38, 0.68, 1);

new Hilo3d.Mesh({
    name: 'Procedural midnight vault',
    geometry: new Hilo3d.SphereGeometry({
        radius: 38,
        heightSegments: 22,
        widthSegments: 42
    }),
    material: createSkyMaterial(),
    frustumTest: false,
    pointerEnabled: false
}).addTo(stage);

new Hilo3d.Mesh({
    name: 'Celestial atmospheric halo',
    geometry: createGlowPlaneGeometry(ARTWORK_CENTER_X, ARTWORK_CENTER_Y + 0.16, -1.42, 5.8, 5.8),
    material: createAuraMaterial(),
    frustumTest: false,
    pointerEnabled: false
}).addTo(stage);

const environment = await loadEnvironmentMaps();
const sceneRoot = new Hilo3d.Node({
    name: 'Garden of the Last Star'
}).addTo(stage);
sceneRoot.x = ARTWORK_CENTER_X;
sceneRoot.y = ARTWORK_CENTER_Y;

const obsidianMaterial = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.004, 0.008, 0.02),
    metallic: 0.94,
    roughness: 0.12,
    clearcoatFactor: 1,
    clearcoatRoughnessFactor: 0.055,
    iridescenceFactor: 0.72,
    iridescenceIor: 1.36,
    iridescenceThicknessMinimum: 210,
    iridescenceThicknessMaximum: 470,
    castShadows: true,
    receiveShadows: true
});
const goldMaterial = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.62, 0.24, 0.045),
    metallic: 1,
    roughness: 0.2,
    clearcoatFactor: 0.54,
    clearcoatRoughnessFactor: 0.12,
    castShadows: true,
    receiveShadows: true
});
const blueMetalMaterial = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.018, 0.12, 0.26),
    metallic: 0.9,
    roughness: 0.26,
    clearcoatFactor: 0.72,
    clearcoatRoughnessFactor: 0.1,
    castShadows: true,
    receiveShadows: true
});
const floorMaterial = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.006, 0.01, 0.022),
    metallic: 0.82,
    roughness: 0.28,
    castShadows: false,
    receiveShadows: true
});
applyEnvironmentMaps(
    [obsidianMaterial, goldMaterial, blueMetalMaterial, floorMaterial],
    environment
);
obsidianMaterial.diffuseEnvIntensity = 0.12;
obsidianMaterial.specularEnvIntensity = 1.35;
goldMaterial.diffuseEnvIntensity = 0.18;
goldMaterial.specularEnvIntensity = 1.05;
blueMetalMaterial.diffuseEnvIntensity = 0.2;
blueMetalMaterial.specularEnvIntensity = 0.88;
floorMaterial.diffuseEnvIntensity = 0.08;
floorMaterial.specularEnvIntensity = 0.68;

const goldGlow = createGlowMaterial(3.15, 0.72, 0.13);
const cyanGlow = createGlowMaterial(0.055, 1.05, 2.8);
const veilGold = createGlowMaterial(1.8, 0.42, 0.08, 0.42);
const veilCyan = createGlowMaterial(0.05, 0.68, 1.9, 0.34);

new Hilo3d.Mesh({
    geometry: new Hilo3d.PlaneGeometry({ width: 20, height: 18 }),
    material: floorMaterial,
    y: -1.55,
    z: 2.5,
    rotationX: -90
}).addTo(sceneRoot);

addTemple(sceneRoot, obsidianMaterial, veilGold, veilCyan);
addLotusBase(sceneRoot, [obsidianMaterial, blueMetalMaterial], goldGlow, cyanGlow);

const eclipseRoot = new Hilo3d.Node({
    name: 'Last Star eclipse sculpture',
    y: 0.3
}).addTo(sceneRoot);
const radiantDisc = new Hilo3d.Mesh({
    name: 'Warm stellar disc',
    geometry: new Hilo3d.SphereGeometry({
        radius: 0.82,
        heightSegments: 32,
        widthSegments: 48
    }),
    material: goldGlow,
    z: -0.18
}).addTo(eclipseRoot);
radiantDisc.setScale(1, 1, 0.34);

const eclipseCore = new Hilo3d.Mesh({
    name: 'Black iridescent moon',
    geometry: new Hilo3d.SphereGeometry({
        radius: 0.71,
        heightSegments: 48,
        widthSegments: 72
    }),
    material: obsidianMaterial,
    x: -0.075,
    y: 0.035,
    z: 0.02
}).addTo(eclipseRoot);

const wireShell = new Hilo3d.Mesh({
    name: 'Golden geodesic shell',
    geometry: new Hilo3d.SphereGeometry({
        radius: 0.755,
        heightSegments: 12,
        widthSegments: 22
    }),
    material: new Hilo3d.BasicMaterial({
        lightType: 'NONE',
        diffuse: new Hilo3d.Color(2.5, 0.7, 0.14),
        wireframe: true,
        transparent: true,
        transparency: 0.34,
        depthMask: false,
        castShadows: false,
        receiveShadows: false
    }),
    rotationX: 18,
    rotationY: 31
}).addTo(eclipseRoot);

const crownRing = new Hilo3d.Mesh({
    geometry: createTorusGeometry(0.98, 0.038, 128, 14),
    material: goldGlow,
    z: 0.025,
    rotationZ: -7
}).addTo(eclipseRoot);
const coolOrbit = new Hilo3d.Mesh({
    geometry: createTorusGeometry(1.28, 0.024, 128, 12),
    material: cyanGlow,
    rotationX: 67,
    rotationY: -16,
    rotationZ: 8
}).addTo(eclipseRoot);
const warmOrbit = new Hilo3d.Mesh({
    geometry: createTorusGeometry(1.56, 0.022, 144, 10),
    material: veilGold,
    rotationX: -28,
    rotationY: 47,
    rotationZ: 22
}).addTo(eclipseRoot);
const violetOrbit = new Hilo3d.Mesh({
    geometry: createTorusGeometry(1.82, 0.015, 144, 9),
    material: veilCyan,
    rotationX: 31,
    rotationY: 20,
    rotationZ: 72
}).addTo(eclipseRoot);

const centralSeed = new Hilo3d.Mesh({
    geometry: new Hilo3d.SphereGeometry({
        radius: 0.075,
        heightSegments: 16,
        widthSegments: 24
    }),
    material: cyanGlow,
    x: 0.19,
    y: -0.12,
    z: 0.74
}).addTo(eclipseRoot);
const relicRoot = addOrbitalRelics(eclipseRoot, goldMaterial);
particleField.attach(renderer, ARTWORK_CENTER_X, ARTWORK_CENTER_Y + 0.3);

const stairGeometry = new Hilo3d.BoxGeometry({ width: 3.8, height: 0.12, depth: 0.72 });
for (let index = 0; index < 5; index += 1) {
    new Hilo3d.Mesh({
        geometry: stairGeometry,
        material: index % 2 === 0 ? obsidianMaterial : blueMetalMaterial,
        y: -1.5 + index * 0.06,
        z: 1.25 + index * 0.58
    })
        .setScale(1 - index * 0.055, 1, 1)
        .addTo(sceneRoot);
}

new Hilo3d.PointLight({
    name: 'Warm eclipse light',
    color: new Hilo3d.Color(1, 0.38, 0.08),
    amount: 34,
    range: 10,
    x: ARTWORK_CENTER_X + 0.3,
    y: 1.25,
    z: 1.8
}).addTo(stage);
new Hilo3d.PointLight({
    name: 'Cyan moonlight',
    color: new Hilo3d.Color(0.1, 0.52, 1),
    amount: 23,
    range: 12,
    x: ARTWORK_CENTER_X - 3.5,
    y: 2.1,
    z: 2.4
}).addTo(stage);

let elapsed = 0;
sceneRoot.onUpdate = deltaTime => {
    const safeDelta = Math.min(deltaTime, 50);
    if (motionEnabled) elapsed += safeDelta * 0.001;
    particleField.update(
        camera,
        renderer,
        ARTWORK_CENTER_X,
        ARTWORK_CENTER_Y + 0.3,
        elapsed,
        safeDelta,
        motionEnabled
    );
    if (!motionEnabled) return;
    eclipseRoot.rotationY = Math.sin(elapsed * 0.19) * 6;
    eclipseRoot.rotationX = Math.cos(elapsed * 0.13) * 1.4;
    crownRing.rotationZ += safeDelta * 0.004;
    coolOrbit.rotationZ -= safeDelta * 0.007;
    warmOrbit.rotationY += safeDelta * 0.005;
    violetOrbit.rotationX -= safeDelta * 0.0035;
    wireShell.rotationY -= safeDelta * 0.009;
    wireShell.rotationZ += safeDelta * 0.004;
    eclipseCore.rotationY += safeDelta * 0.0025;
    relicRoot.rotationZ += safeDelta * 0.003;
    centralSeed.y = -0.12 + Math.sin(elapsed * 1.1) * 0.035;
};

const bloomButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-bloom-mode]')];
const motionButton = requireButton('#motionToggle');
const renderStatus = requireElement('#renderStatus');

function updateInterface(): void {
    document.body.dataset['bloom'] = bloomEnabled ? 'on' : 'off';
    document.body.dataset['motion'] = motionEnabled ? 'on' : 'off';
    for (const button of bloomButtons) {
        const isActive = button.dataset['bloomMode'] === (bloomEnabled ? 'bloom' : 'raw');
        button.setAttribute('aria-pressed', String(isActive));
    }
    motionButton.setAttribute('aria-pressed', String(motionEnabled));
    motionButton.textContent = motionEnabled ? 'drift · on' : 'drift · still';
    renderStatus.textContent = `${renderer.backend} · ${bloomEnabled ? 'bloom composite' : 'raw hdr'}`;
}

function navigateToBloomMode(enabled: boolean): void {
    const target = new URL(location.href);
    if (enabled) target.searchParams.delete('bloom');
    else target.searchParams.set('bloom', 'off');
    location.href = target.href;
}

for (const button of bloomButtons) {
    button.addEventListener('click', () => {
        navigateToBloomMode(button.dataset['bloomMode'] === 'bloom');
    });
}
motionButton.addEventListener('click', () => {
    motionEnabled = !motionEnabled;
    updateInterface();
});
window.addEventListener('keydown', event => {
    if (event.code === 'KeyB') navigateToBloomMode(!bloomEnabled);
    if (event.code === 'Space') {
        event.preventDefault();
        motionEnabled = !motionEnabled;
        updateInterface();
    }
});

updateInterface();
document.body.dataset['renderReady'] = 'true';
particleField.update(
    camera,
    renderer,
    ARTWORK_CENTER_X,
    ARTWORK_CENTER_Y + 0.3,
    0,
    0,
    motionEnabled
);
ticker.start();
window.addEventListener(
    'pagehide',
    () => {
        particleField.destroy();
    },
    { once: true }
);
