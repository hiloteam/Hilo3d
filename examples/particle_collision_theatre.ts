import * as Hilo3d from '../src/Hilo3d';
import * as Particle from '@hilo3d/addon-particle';
import { createExampleContext, loadEnvironmentMaps } from './shared/init';
import {
    createParticleTexture,
    installExampleDisposal,
    requireElement
} from './shared/particleShowcase';

type RainPayload = Readonly<{
    position: Particle.ParticleVector3;
    velocity: Particle.ParticleVector3;
}>;

type ColliderFinish = 'anisotropy' | 'clearcoat' | 'gem' | 'lacquer';

type CollisionLane = Readonly<{
    emitter: string;
    event: string;
    x: number;
    phase: number;
    burstCounts: readonly [number, number, number];
    color: readonly [number, number, number];
    collider: Particle.ParticleAnalyticCollider;
}>;

const compactViewport = window.matchMedia('(max-width: 720px)').matches;
const context = await createExampleContext({
    camera: {
        fov: compactViewport ? 48 : 38,
        near: 0.1,
        far: 60,
        x: 0.1,
        y: compactViewport ? 3.8 : 2.7,
        z: compactViewport ? 22.5 : 12.6
    },
    stage: {
        renderPipeline: new Hilo3d.PostProcessRenderPipelineFactory({
            bloom: { threshold: 0.82, knee: 0.24, intensity: 0.26, scatter: 0.36, maxLevels: 4 },
            colorUber: {
                exposure: -0.12,
                contrast: 0.14,
                saturation: 0.04,
                toneMapping: 'pbr-neutral',
                vignetteIntensity: 0.34,
                vignetteSmoothness: 0.78,
                vignetteColor: new Hilo3d.Color(0.012, 0.009, 0.014, 0.46)
            }
        })
    },
    controls: {
        target: new Hilo3d.Vector3(0.1, 0.64, -0.05),
        minDistance: compactViewport ? 14 : 9,
        maxDistance: compactViewport ? 28 : 18,
        minPolarAngle: 0.62,
        maxPolarAngle: 2.05
    }
});
const { stage, renderer, directionLight, ambientLight } = context;

renderer.clearColor.set(0.016, 0.014, 0.019, 1);
directionLight.amount = 1.8;
directionLight.color.set(1, 0.88, 0.74, 1);
directionLight.direction.set(-0.65, -1, -0.4);
ambientLight.amount = 0.08;

const areaLight = new Hilo3d.AreaLight({
    color: new Hilo3d.Color(1, 0.55, 0.3),
    amount: 3.6,
    width: 4.5,
    height: 2.5,
    x: -1.5,
    y: 4,
    z: 3
}).addTo(stage);
areaLight.lookAt(new Hilo3d.Vector3(0, 0.2, 0));
new Hilo3d.PointLight({
    color: new Hilo3d.Color(0.2, 0.75, 1),
    amount: 5,
    range: 10,
    x: 3.2,
    y: 1.6,
    z: 2.4
}).addTo(stage);

const environmentMaps = await loadEnvironmentMaps();
const { brdfLUT, diffuseEnvMap, specularEnvMap } = environmentMaps;
const studioEnvironment = Object.freeze({
    brdfLUT,
    diffuseEnvMap: Object.freeze({ texture: diffuseEnvMap, encoding: 'srgb' as const }),
    specularEnvMap: Object.freeze({ texture: specularEnvMap, encoding: 'srgb' as const }),
    diffuseEnvIntensity: 1,
    specularEnvIntensity: 1
});

const floorY = -1.24;
const planeY = floorY + 0.32;
new Hilo3d.Mesh({
    y: floorY - 0.18,
    geometry: new Hilo3d.BoxGeometry({ width: 9.5, height: 0.36, depth: 6.1 }),
    material: new Hilo3d.PBRMaterial({
        ...studioEnvironment,
        baseColor: new Hilo3d.Color(0.038, 0.036, 0.043),
        metallic: 0.2,
        roughness: 0.48
    }),
    receiveShadows: true
}).addTo(stage);

new Hilo3d.Mesh({
    y: 0.78,
    z: -2.72,
    geometry: new Hilo3d.BoxGeometry({ width: 9.5, height: 4.35, depth: 0.12 }),
    material: new Hilo3d.PBRMaterial({
        ...studioEnvironment,
        baseColor: new Hilo3d.Color(0.038, 0.038, 0.047),
        metallic: 0.12,
        roughness: 0.78
    }),
    receiveShadows: true
}).addTo(stage);

const lanes: readonly CollisionLane[] = Object.freeze([
    {
        emitter: 'sphere-stream',
        event: 'impact-sphere',
        x: -2.7,
        phase: 0.15,
        burstCounts: [1, 3, 1],
        color: [0.08, 0.88, 1],
        collider: { type: 'sphere', center: [-2.7, -0.4, 0], radius: 0.68 }
    },
    {
        emitter: 'box-stream',
        event: 'impact-box',
        x: -0.88,
        phase: 0.65,
        burstCounts: [2, 1, 4],
        color: [0.92, 0.16, 1],
        collider: { type: 'box', center: [-0.88, -0.5, 0], size: [1.08, 1.08, 1.08] }
    },
    {
        emitter: 'capsule-stream',
        event: 'impact-capsule',
        x: 1.12,
        phase: 1.1,
        burstCounts: [1, 2, 1],
        color: [1, 0.42, 0.06],
        collider: {
            type: 'capsule',
            start: [0.68, -0.92, 0],
            end: [1.48, 0.82, 0],
            radius: 0.25
        }
    },
    {
        emitter: 'plane-stream',
        event: 'impact-plane',
        x: 3,
        phase: 1.6,
        burstCounts: [3, 1, 2],
        color: [0.34, 1, 0.46],
        collider: { type: 'plane', normal: [0, 1, 0], offset: planeY }
    }
]);

function laneMaterial(
    color: readonly [number, number, number],
    metallic: number,
    roughness: number,
    finish: ColliderFinish
): Hilo3d.PBRMaterial {
    const finishParameters =
        finish === 'anisotropy'
            ? {
                  anisotropyStrength: 0.82,
                  anisotropyRotation: Math.PI * 0.18,
                  clearcoatFactor: 0.22,
                  clearcoatRoughnessFactor: 0.1
              }
            : finish === 'gem'
              ? {
                    clearcoatFactor: 0.96,
                    clearcoatRoughnessFactor: 0.055,
                    iridescenceFactor: 0.2,
                    iridescenceIor: 1.36,
                    iridescenceThicknessMinimum: 180,
                    iridescenceThicknessMaximum: 520
                }
              : finish === 'lacquer'
                ? {
                      clearcoatFactor: 0.9,
                      clearcoatRoughnessFactor: 0.1,
                      iridescenceFactor: 0.07,
                      iridescenceIor: 1.32,
                      iridescenceThicknessMinimum: 240,
                      iridescenceThicknessMaximum: 420
                  }
                : {
                      clearcoatFactor: 1,
                      clearcoatRoughnessFactor: 0.065
                  };
    return new Hilo3d.PBRMaterial({
        ...studioEnvironment,
        ...finishParameters,
        baseColor: new Hilo3d.Color(
            0.04 + color[0] * 0.22,
            0.042 + color[1] * 0.22,
            0.05 + color[2] * 0.22
        ),
        metallic,
        roughness,
        emissionFactor: new Hilo3d.Color(color[0] * 0.002, color[1] * 0.002, color[2] * 0.002)
    });
}

function accentMaterial(
    color: readonly [number, number, number],
    intensity = 0.28
): Hilo3d.PBRMaterial {
    return new Hilo3d.PBRMaterial({
        ...studioEnvironment,
        baseColor: new Hilo3d.Color(0.04, 0.038, 0.046),
        metallic: 0.76,
        roughness: 0.26,
        emissionFactor: new Hilo3d.Color(
            color[0] * intensity,
            color[1] * intensity,
            color[2] * intensity
        )
    });
}

const nicheMaterial = new Hilo3d.PBRMaterial({
    ...studioEnvironment,
    baseColor: new Hilo3d.Color(0.048, 0.047, 0.058),
    metallic: 0.1,
    roughness: 0.82
});
const plinthMaterial = new Hilo3d.PBRMaterial({
    ...studioEnvironment,
    baseColor: new Hilo3d.Color(0.075, 0.072, 0.084),
    metallic: 0.36,
    roughness: 0.38
});
const sourceHousingMaterial = new Hilo3d.PBRMaterial({
    ...studioEnvironment,
    baseColor: new Hilo3d.Color(0.16, 0.112, 0.07),
    metallic: 0.68,
    roughness: 0.3
});
const stageEdgeMaterial = new Hilo3d.PBRMaterial({
    ...studioEnvironment,
    baseColor: new Hilo3d.Color(0.18, 0.105, 0.055),
    metallic: 0.76,
    roughness: 0.24,
    emissionFactor: new Hilo3d.Color(0.01, 0.004, 0.001)
});
const colliderTrimMaterial = new Hilo3d.PBRMaterial({
    ...studioEnvironment,
    baseColor: new Hilo3d.Color(0.42, 0.22, 0.072),
    metallic: 0.88,
    roughness: 0.18,
    emissionFactor: new Hilo3d.Color(0.018, 0.007, 0.0015)
});

new Hilo3d.Mesh({
    y: floorY - 0.01,
    z: 3.035,
    geometry: new Hilo3d.BoxGeometry({ width: 9.2, height: 0.028, depth: 0.035 }),
    material: stageEdgeMaterial,
    castShadows: false
}).addTo(stage);

function addLaneArchitecture(lane: CollisionLane): void {
    new Hilo3d.Mesh({
        x: lane.x,
        y: 0.52,
        z: -2.63,
        geometry: new Hilo3d.BoxGeometry({ width: 1.28, height: 3.28, depth: 0.1 }),
        material: nicheMaterial,
        receiveShadows: true
    }).addTo(stage);
    new Hilo3d.Mesh({
        x: lane.x,
        y: floorY + 0.032,
        z: -0.03,
        geometry: new Hilo3d.BoxGeometry({ width: 1.5, height: 0.064, depth: 1.78 }),
        material: plinthMaterial,
        castShadows: false
    }).addTo(stage);
    if (lane.emitter === 'plane-stream') {
        new Hilo3d.Mesh({
            x: lane.x,
            y: floorY + 0.16,
            z: -0.02,
            geometry: new Hilo3d.BoxGeometry({ width: 1.08, height: 0.32, depth: 1.08 }),
            material: plinthMaterial,
            castShadows: false,
            receiveShadows: true
        }).addTo(stage);
    }
    new Hilo3d.Mesh({
        x: lane.x,
        y: floorY + 0.042,
        z: 0.78,
        geometry: new Hilo3d.BoxGeometry({ width: 0.62, height: 0.015, depth: 0.028 }),
        material: accentMaterial(lane.color, 0.22),
        castShadows: false
    }).addTo(stage);
    new Hilo3d.Mesh({
        x: lane.x,
        y: 2.94,
        z: -0.04,
        geometry: new Hilo3d.BoxGeometry({ width: 0.64, height: 0.1, depth: 0.36 }),
        material: sourceHousingMaterial,
        castShadows: false
    }).addTo(stage);
    new Hilo3d.Mesh({
        x: lane.x,
        y: 2.865,
        z: 0.02,
        geometry: new Hilo3d.SphereGeometry({
            radius: 0.13,
            widthSegments: 18,
            heightSegments: 10
        }),
        material: accentMaterial(lane.color, 0.4),
        scaleY: 0.22,
        castShadows: false
    }).addTo(stage);
}

for (const lane of lanes) addLaneArchitecture(lane);

const stageAccent = accentMaterial([0.96, 0.62, 0.28], 0.035);
new Hilo3d.Mesh({
    y: floorY + 0.06,
    z: -2.63,
    geometry: new Hilo3d.BoxGeometry({ width: 9.05, height: 0.02, depth: 0.035 }),
    material: stageAccent,
    castShadows: false
}).addTo(stage);

function addColliderMesh(
    geometry: Hilo3d.Geometry,
    position: Particle.ParticleVector3,
    color: readonly [number, number, number],
    rotationZ = 0,
    metallic = 0.5,
    roughness = 0.24,
    finish: ColliderFinish = 'clearcoat'
): Hilo3d.Node {
    const root = new Hilo3d.Node({
        x: position[0],
        y: position[1],
        z: position[2],
        rotationZ
    }).addTo(stage);
    new Hilo3d.Mesh({
        geometry,
        material: laneMaterial(color, metallic, roughness, finish),
        castShadows: true
    }).addTo(root);
    return root;
}

function createCapsuleGeometry(radius: number, segmentLength: number): Hilo3d.Geometry {
    const radialSegments = 24;
    const hemisphereSegments = 8;
    const halfSegment = segmentLength * 0.5;
    const profiles: Readonly<{ y: number; radius: number; normalY: number }>[] = [];
    profiles.push({ y: -halfSegment - radius, radius: 0, normalY: -1 });
    for (let index = 1; index <= hemisphereSegments; index += 1) {
        const angle = -Math.PI * 0.5 + (index / hemisphereSegments) * Math.PI * 0.5;
        profiles.push({
            y: -halfSegment + Math.sin(angle) * radius,
            radius: Math.cos(angle) * radius,
            normalY: Math.sin(angle)
        });
    }
    profiles.push({ y: halfSegment, radius, normalY: 0 });
    for (let index = 1; index <= hemisphereSegments; index += 1) {
        const angle = (index / hemisphereSegments) * Math.PI * 0.5;
        profiles.push({
            y: halfSegment + Math.sin(angle) * radius,
            radius: Math.cos(angle) * radius,
            normalY: Math.sin(angle)
        });
    }

    const ringStride = radialSegments + 1;
    const vertices = new Float32Array(profiles.length * ringStride * 3);
    const normals = new Float32Array(vertices.length);
    const tangents = new Float32Array(profiles.length * ringStride * 4);
    for (let profileIndex = 0; profileIndex < profiles.length; profileIndex += 1) {
        const profile = profiles[profileIndex];
        if (!profile) throw new Error('Capsule profile generation failed');
        const radialNormal = Math.sqrt(Math.max(0, 1 - profile.normalY * profile.normalY));
        for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex += 1) {
            const angle = (radialIndex / radialSegments) * Math.PI * 2;
            const offset = (profileIndex * ringStride + radialIndex) * 3;
            const cosine = Math.cos(angle);
            const sine = Math.sin(angle);
            vertices[offset] = cosine * profile.radius;
            vertices[offset + 1] = profile.y;
            vertices[offset + 2] = sine * profile.radius;
            normals[offset] = cosine * radialNormal;
            normals[offset + 1] = profile.normalY;
            normals[offset + 2] = sine * radialNormal;
            const tangentOffset = (profileIndex * ringStride + radialIndex) * 4;
            tangents[tangentOffset] = -sine;
            tangents[tangentOffset + 1] = 0;
            tangents[tangentOffset + 2] = cosine;
            tangents[tangentOffset + 3] = 1;
        }
    }

    const indices = new Uint16Array((profiles.length - 1) * radialSegments * 6);
    let indexOffset = 0;
    for (let profileIndex = 0; profileIndex + 1 < profiles.length; profileIndex += 1) {
        for (let radialIndex = 0; radialIndex < radialSegments; radialIndex += 1) {
            const current = profileIndex * ringStride + radialIndex;
            const next = current + ringStride;
            indices[indexOffset++] = current;
            indices[indexOffset++] = next;
            indices[indexOffset++] = current + 1;
            indices[indexOffset++] = current + 1;
            indices[indexOffset++] = next;
            indices[indexOffset++] = next + 1;
        }
    }
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(vertices, 3),
        normals: new Hilo3d.GeometryData(normals, 3),
        tangents: new Hilo3d.GeometryData(tangents, 4),
        indices: new Hilo3d.GeometryData(indices, 1)
    });
}

function createTorusGeometry(majorRadius: number, tubeRadius: number): Hilo3d.Geometry {
    const radialSegments = 48;
    const tubeSegments = 8;
    const ringStride = tubeSegments + 1;
    const vertices = new Float32Array((radialSegments + 1) * ringStride * 3);
    const normals = new Float32Array(vertices.length);
    for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex += 1) {
        const radialAngle = (radialIndex / radialSegments) * Math.PI * 2;
        const radialCosine = Math.cos(radialAngle);
        const radialSine = Math.sin(radialAngle);
        for (let tubeIndex = 0; tubeIndex <= tubeSegments; tubeIndex += 1) {
            const tubeAngle = (tubeIndex / tubeSegments) * Math.PI * 2;
            const tubeCosine = Math.cos(tubeAngle);
            const tubeSine = Math.sin(tubeAngle);
            const radius = majorRadius + tubeCosine * tubeRadius;
            const offset = (radialIndex * ringStride + tubeIndex) * 3;
            vertices[offset] = radialCosine * radius;
            vertices[offset + 1] = tubeSine * tubeRadius;
            vertices[offset + 2] = radialSine * radius;
            normals[offset] = radialCosine * tubeCosine;
            normals[offset + 1] = tubeSine;
            normals[offset + 2] = radialSine * tubeCosine;
        }
    }
    const indices = new Uint16Array(radialSegments * tubeSegments * 6);
    let indexOffset = 0;
    for (let radialIndex = 0; radialIndex < radialSegments; radialIndex += 1) {
        for (let tubeIndex = 0; tubeIndex < tubeSegments; tubeIndex += 1) {
            const current = radialIndex * ringStride + tubeIndex;
            const next = current + ringStride;
            indices[indexOffset++] = current;
            indices[indexOffset++] = next;
            indices[indexOffset++] = current + 1;
            indices[indexOffset++] = current + 1;
            indices[indexOffset++] = next;
            indices[indexOffset++] = next + 1;
        }
    }
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(vertices, 3),
        normals: new Hilo3d.GeometryData(normals, 3),
        indices: new Hilo3d.GeometryData(indices, 1)
    });
}

function signedPower(value: number, exponent: number): number {
    return Math.sign(value) * Math.pow(Math.abs(value), exponent);
}

function createRoundedBoxGeometry(size: number): Hilo3d.Geometry {
    const widthSegments = 40;
    const heightSegments = 24;
    const exponent = 0.3;
    const gradientExponent = 2 / exponent - 1;
    const half = size * 0.5;
    const rowStride = widthSegments + 1;
    const vertices = new Float32Array((heightSegments + 1) * rowStride * 3);
    const normals = new Float32Array(vertices.length);
    for (let yIndex = 0; yIndex <= heightSegments; yIndex += 1) {
        const latitude = -Math.PI * 0.5 + (yIndex / heightSegments) * Math.PI;
        const latitudeCosine = Math.cos(latitude);
        const latitudeSine = Math.sin(latitude);
        for (let xIndex = 0; xIndex <= widthSegments; xIndex += 1) {
            const longitude = (xIndex / widthSegments) * Math.PI * 2;
            const x =
                signedPower(latitudeCosine, exponent) * signedPower(Math.cos(longitude), exponent);
            const y = signedPower(latitudeSine, exponent);
            const z =
                signedPower(latitudeCosine, exponent) * signedPower(Math.sin(longitude), exponent);
            const offset = (yIndex * rowStride + xIndex) * 3;
            vertices[offset] = x * half;
            vertices[offset + 1] = y * half;
            vertices[offset + 2] = z * half;
            const normalX = signedPower(x, gradientExponent);
            const normalY = signedPower(y, gradientExponent);
            const normalZ = signedPower(z, gradientExponent);
            const normalLength = Math.hypot(normalX, normalY, normalZ) || 1;
            normals[offset] = normalX / normalLength;
            normals[offset + 1] = normalY / normalLength;
            normals[offset + 2] = normalZ / normalLength;
        }
    }
    const indices = new Uint16Array(widthSegments * heightSegments * 6);
    let indexOffset = 0;
    for (let yIndex = 0; yIndex < heightSegments; yIndex += 1) {
        for (let xIndex = 0; xIndex < widthSegments; xIndex += 1) {
            const current = yIndex * rowStride + xIndex;
            const next = current + rowStride;
            indices[indexOffset++] = current;
            indices[indexOffset++] = next;
            indices[indexOffset++] = current + 1;
            indices[indexOffset++] = current + 1;
            indices[indexOffset++] = next;
            indices[indexOffset++] = next + 1;
        }
    }
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(vertices, 3),
        normals: new Hilo3d.GeometryData(normals, 3),
        indices: new Hilo3d.GeometryData(indices, 1)
    });
}

function addPlateTrim(root: Hilo3d.Node, size: number): void {
    const half = size * 0.5;
    const thickness = 0.018;
    const elevation = 0.052;
    for (const z of [-half, half]) {
        new Hilo3d.Mesh({
            y: elevation,
            z,
            geometry: new Hilo3d.BoxGeometry({
                width: size + thickness,
                height: thickness,
                depth: thickness
            }),
            material: colliderTrimMaterial,
            castShadows: false
        }).addTo(root);
    }
    for (const x of [-half, half]) {
        new Hilo3d.Mesh({
            x,
            y: elevation,
            geometry: new Hilo3d.BoxGeometry({
                width: thickness,
                height: thickness,
                depth: size + thickness
            }),
            material: colliderTrimMaterial,
            castShadows: false
        }).addTo(root);
    }
}

addColliderMesh(
    new Hilo3d.SphereGeometry({ radius: 0.68, widthSegments: 48, heightSegments: 32 }),
    [-2.7, -0.4, 0],
    lanes[0]?.color ?? [0, 1, 1],
    0,
    0.12,
    0.2,
    'clearcoat'
);

addColliderMesh(
    createRoundedBoxGeometry(1.08),
    [-0.88, -0.5, 0],
    lanes[1]?.color ?? [1, 0, 1],
    0,
    0.1,
    0.24,
    'gem'
);

const capsuleStart = lanes[2]?.collider;
if (capsuleStart?.type !== 'capsule') throw new Error('Collision theatre capsule lane is invalid');
const capsuleDx = capsuleStart.end[0] - capsuleStart.start[0];
const capsuleDy = capsuleStart.end[1] - capsuleStart.start[1];
const capsuleLength = Math.hypot(capsuleDx, capsuleDy);
const capsuleCenter: Particle.ParticleVector3 = [
    (capsuleStart.start[0] + capsuleStart.end[0]) * 0.5,
    (capsuleStart.start[1] + capsuleStart.end[1]) * 0.5,
    0
];
const capsuleColor = lanes[2]?.color ?? [1, 0.5, 0];
const capsuleColliderMesh = addColliderMesh(
    createCapsuleGeometry(capsuleStart.radius, capsuleLength),
    capsuleCenter,
    capsuleColor,
    -(Math.atan2(capsuleDx, capsuleDy) * 180) / Math.PI,
    0.78,
    0.3,
    'anisotropy'
);
for (const y of [-capsuleLength * 0.5, capsuleLength * 0.5]) {
    new Hilo3d.Mesh({
        y,
        geometry: createTorusGeometry(capsuleStart.radius + 0.006, 0.011),
        material: colliderTrimMaterial,
        castShadows: false
    }).addTo(capsuleColliderMesh);
}

const planeColliderMesh = addColliderMesh(
    new Hilo3d.BoxGeometry({ width: 1.35, height: 0.08, depth: 1.35 }),
    [3, planeY + 0.04, 0],
    lanes[3]?.color ?? [0.3, 1, 0.5],
    0,
    0.08,
    0.3,
    'lacquer'
);
new Hilo3d.Mesh({
    y: 0.057,
    geometry: new Hilo3d.BoxGeometry({ width: 1.08, height: 0.022, depth: 1.08 }),
    material: new Hilo3d.PBRMaterial({
        ...studioEnvironment,
        baseColor: new Hilo3d.Color(0.048, 0.25, 0.13),
        metallic: 0.12,
        roughness: 0.17,
        clearcoatFactor: 1,
        clearcoatRoughnessFactor: 0.055,
        iridescenceFactor: 0.09,
        iridescenceThicknessMinimum: 220,
        iridescenceThicknessMaximum: 460
    }),
    castShadows: false
}).addTo(planeColliderMesh);
addPlateTrim(planeColliderMesh, 1.35);

const meteorTexture = createParticleTexture({ style: 'comet' });
const glowTexture = createParticleTexture({ style: 'disc' });
const sparkTexture = createParticleTexture({ style: 'spark' });
const shockwaveTexture = createParticleTexture({ style: 'ring' });
const fadeCurve = new Particle.ParticleCurve(
    [
        { time: 0, value: 0.12 },
        { time: 0.1, value: 1 },
        { time: 1, value: 0 }
    ],
    { interpolation: 'smooth' }
);
const sparkFadeCurve = new Particle.ParticleCurve(
    [
        { time: 0, value: 0.72 },
        { time: 0.08, value: 1 },
        { time: 0.62, value: 0.68 },
        { time: 1, value: 0 }
    ],
    { interpolation: 'smooth' }
);
const shockwaveSizeCurve = new Particle.ParticleCurve(
    [
        { time: 0, value: 0.35 },
        { time: 0.18, value: 2.4 },
        { time: 1, value: 6.2 }
    ],
    { interpolation: 'smooth' }
);
const shockwaveFadeCurve = new Particle.ParticleCurve(
    [
        { time: 0, value: 0 },
        { time: 0.08, value: 1 },
        { time: 0.5, value: 0.52 },
        { time: 1, value: 0 }
    ],
    { interpolation: 'smooth' }
);
function collisionEmitter(lane: CollisionLane): Particle.ParticleEmitterDefinitionInput {
    const triggerModule: readonly Particle.ParticleModule[] =
        lane.emitter === 'sphere-stream'
            ? [
                  {
                      type: 'trigger',
                      volumes: [{ type: 'sphere', center: [-2.7, 1.62, 0], radius: 0.58 }],
                      events: { enter: 'gate-enter', inside: 'gate-inside', exit: 'gate-exit' }
                  }
              ]
            : [];
    return {
        name: lane.emitter,
        capacity: 96,
        execution: 'cpu',
        duration: 9.5,
        fixedStep: 1 / 120,
        maxCatchUpSteps: 16,
        eventCapacity: 768,
        eventOverflow: 'drop-oldest',
        bounds: { mode: 'dynamic' },
        emission: {
            rateOverTime: { min: 0.12, max: 0.45 },
            bursts: lane.burstCounts.map((count, index) => ({
                time: lane.phase + index * 3.1,
                count
            }))
        },
        shape: { type: 'disc', radius: 0.2, distribution: 'volume' },
        initialize: {
            position: [lane.x, 2.72, 0],
            direction: { min: [-0.08, -1, -0.04], max: [0.08, -0.96, 0.04] },
            speed: { min: 1.4, max: 2.05 },
            lifetime: { min: 3.8, max: 5.2 },
            size: { min: 0.11, max: 0.145 },
            mass: { min: 0.8, max: 1.25 }
        },
        modules: [
            { type: 'gravity', force: [0, -0.4, 0] },
            { type: 'drag', coefficient: 0.035 },
            {
                type: 'collision',
                colliders: [lane.collider],
                bounce: 0.38,
                friction: 0.06,
                radiusScale: 0.8,
                lifetimeLoss: 0.78,
                event: lane.event
            },
            ...triggerModule,
            {
                type: 'sub-emitter',
                event: lane.event,
                emitter: 'impact-sparks',
                count: 72,
                inheritVelocity: false
            },
            {
                type: 'sub-emitter',
                event: lane.event,
                emitter: 'impact-shockwaves',
                count: 1,
                inheritVelocity: false
            },
            { type: 'size-by-speed', speedRange: [0, 4], curve: fadeCurve },
            {
                type: 'color-over-lifetime',
                gradient: new Particle.ParticleGradient([
                    {
                        time: 0,
                        color: [lane.color[0] * 1.8, lane.color[1] * 1.8, lane.color[2] * 1.8, 1]
                    },
                    {
                        time: 0.55,
                        color: [lane.color[0] * 1.25, lane.color[1] * 1.25, lane.color[2] * 1.25, 1]
                    },
                    { time: 1, color: [1, 0.3, 0.04, 0.72] }
                ])
            }
        ],
        renderers: [
            {
                type: 'sprite',
                texture: meteorTexture,
                alignment: 'stretched',
                stretchScale: 1.5,
                pivot: [0.5, 1],
                blend: 'additive',
                depthWrite: false,
                sort: 'distance',
                renderOrder: 2
            },
            {
                type: 'sprite',
                texture: glowTexture,
                alignment: 'view',
                blend: 'additive',
                depthWrite: false,
                sort: 'distance',
                renderOrder: 3
            }
        ]
    };
}

const definition = Particle.ParticleSystemDefinition.create({
    emitters: [
        ...lanes.map(collisionEmitter),
        {
            name: 'rain-stream',
            capacity: 420,
            execution: 'cpu',
            duration: 9.5,
            fixedStep: 1 / 120,
            maxCatchUpSteps: 16,
            eventCapacity: 1_024,
            eventOverflow: 'drop-oldest',
            overflow: 'replace-oldest',
            bounds: { mode: 'dynamic' },
            emission: { rateOverTime: 0 },
            initialize: {
                direction: [0, -1, 0],
                speed: 3,
                lifetime: { min: 2.6, max: 4.2 },
                size: { min: 0.085, max: 0.12 },
                mass: { min: 0.72, max: 1.1 }
            },
            modules: [
                { type: 'gravity', force: [0, -0.55, 0] },
                { type: 'drag', coefficient: 0.025 },
                {
                    type: 'collision',
                    colliders: lanes.map(lane => lane.collider),
                    bounce: 0.28,
                    friction: 0.08,
                    radiusScale: 0.7,
                    lifetimeLoss: 0.62,
                    event: 'impact-rain'
                },
                {
                    type: 'sub-emitter',
                    event: 'impact-rain',
                    emitter: 'impact-sparks',
                    count: 14,
                    inheritVelocity: false
                },
                { type: 'size-by-speed', speedRange: [0, 5], curve: fadeCurve },
                {
                    type: 'color-over-lifetime',
                    gradient: new Particle.ParticleGradient([
                        { time: 0, color: [1.45, 1.8, 2.3, 1] },
                        { time: 0.55, color: [0.36, 0.9, 1.5, 0.95] },
                        { time: 1, color: [1, 0.24, 0.025, 0.7] }
                    ])
                }
            ],
            renderers: [
                {
                    type: 'sprite',
                    texture: meteorTexture,
                    alignment: 'stretched',
                    stretchScale: 1.35,
                    pivot: [0.5, 1],
                    blend: 'additive',
                    depthWrite: false,
                    sort: 'distance',
                    renderOrder: 2
                },
                {
                    type: 'sprite',
                    texture: sparkTexture,
                    alignment: 'view',
                    blend: 'additive',
                    depthWrite: false,
                    sort: 'distance',
                    renderOrder: 3
                }
            ]
        },
        {
            name: 'impact-sparks',
            capacity: 9_600,
            execution: 'cpu',
            eventCapacity: 8_192,
            eventOverflow: 'drop-oldest',
            overflow: 'replace-oldest',
            bounds: { mode: 'dynamic' },
            shape: { type: 'sphere', radius: 0.09, distribution: 'surface' },
            initialize: {
                lifetime: { min: 0.42, max: 0.92 },
                speed: { min: 0.35, max: 2.45 },
                size: { min: 0.025, max: 0.06 }
            },
            modules: [
                { type: 'gravity', force: [0, -1.35, 0] },
                { type: 'drag', coefficient: 0.58 },
                { type: 'size-over-lifetime', curve: sparkFadeCurve },
                { type: 'alpha-over-lifetime', curve: sparkFadeCurve },
                {
                    type: 'color-over-lifetime',
                    gradient: new Particle.ParticleGradient([
                        { time: 0, color: [2.4, 2.1, 1.25, 1] },
                        { time: 0.28, color: [2.2, 0.62, 0.04, 1] },
                        { time: 0.72, color: [1.2, 0.12, 0.015, 0.9] },
                        { time: 1, color: [0.45, 0.01, 0.005, 0] }
                    ])
                }
            ],
            renderers: [
                {
                    type: 'sprite',
                    texture: meteorTexture,
                    alignment: 'stretched',
                    stretchScale: 0.72,
                    pivot: [0.5, 1],
                    blend: 'additive',
                    depthWrite: false,
                    renderOrder: 5
                },
                {
                    type: 'sprite',
                    texture: glowTexture,
                    alignment: 'view',
                    blend: 'additive',
                    depthWrite: false,
                    renderOrder: 6
                }
            ]
        },
        {
            name: 'impact-shockwaves',
            capacity: 640,
            execution: 'cpu',
            overflow: 'replace-oldest',
            bounds: { mode: 'dynamic' },
            initialize: {
                lifetime: { min: 0.32, max: 0.48 },
                speed: 0,
                size: { min: 0.105, max: 0.15 }
            },
            modules: [
                { type: 'size-over-lifetime', curve: shockwaveSizeCurve },
                { type: 'alpha-over-lifetime', curve: shockwaveFadeCurve },
                {
                    type: 'color-over-lifetime',
                    gradient: new Particle.ParticleGradient([
                        { time: 0, color: [1.8, 1.05, 0.46, 0.9] },
                        { time: 0.4, color: [1.2, 0.58, 0.18, 0.62] },
                        { time: 1, color: [0.52, 0.18, 0.06, 0] }
                    ])
                }
            ],
            renderers: [
                {
                    type: 'sprite',
                    texture: shockwaveTexture,
                    alignment: 'view',
                    blend: 'additive',
                    depthWrite: false,
                    sort: 'distance',
                    renderOrder: 4
                }
            ]
        }
    ]
});

const particles = new Particle.ParticleSystem({
    definition,
    seed: 991,
    eventReadbackCapacity: 12_288
}).addTo(stage);

const rainChannel = new Particle.ParticleEventChannel<RainPayload>({
    name: 'theatre-rain',
    capacity: 192,
    overflow: 'drop-oldest',
    schema: { position: 'vec3', velocity: 'vec3' }
});

const readout = requireElement('#particle-readout', HTMLOutputElement);
const burstButton = requireElement('#burst-button', HTMLButtonElement);
const pauseButton = requireElement('#pause-button', HTMLButtonElement);
const restartButton = requireElement('#restart-button', HTMLButtonElement);
const totals: Record<string, number> = {};
let rainBurstIndex = 0;

function rainRandom(index: number, channel: number): number {
    let value = (Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(channel + 17, 0x85ebca6b)) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d) >>> 0;
    value ^= value >>> 15;
    return (value >>> 0) / 0x1_0000_0000;
}

function launchMeteorRain(): void {
    const rainCount = 144;
    const guidedCount = 48;
    const sequenceBase = rainBurstIndex * rainCount;
    rainBurstIndex += 1;
    for (let index = 0; index < rainCount; index += 1) {
        const sequence = sequenceBase + index;
        const guidedLane = index < guidedCount ? lanes[index % lanes.length] : undefined;
        const spawnX =
            guidedLane === undefined
                ? -4.15 + rainRandom(sequence, 0) * 8.3
                : guidedLane.x + (rainRandom(sequence, 0) - 0.5) * 0.42;
        const spawnZ =
            guidedLane === undefined
                ? -1.4 + rainRandom(sequence, 2) * 2.8
                : (rainRandom(sequence, 2) - 0.5) * 0.34;
        rainChannel.submit({
            position: [spawnX, 3.05 + rainRandom(sequence, 1) * 1.55, spawnZ],
            velocity: [
                (rainRandom(sequence, 3) - 0.5) * 0.24,
                -(2.45 + rainRandom(sequence, 4) * 1.75),
                (rainRandom(sequence, 5) - 0.5) * 0.16
            ]
        });
    }
    rainChannel.emitTo(particles, {
        emitter: 'rain-stream',
        positionField: 'position',
        velocityField: 'velocity',
        count: 1
    });
}

burstButton.addEventListener('click', () => {
    launchMeteorRain();
});
pauseButton.addEventListener('click', () => {
    if (particles.playing) {
        particles.pause();
        pauseButton.textContent = 'Play';
    } else {
        particles.play();
        pauseButton.textContent = 'Pause';
    }
});
restartButton.addEventListener('click', () => {
    particles.restart();
    rainChannel.drain();
    rainBurstIndex = 0;
    pauseButton.textContent = 'Pause';
    for (const key of Object.keys(totals)) totals[key] = 0;
});

const canvas = stage.renderer.domElement;
if (canvas === null) throw new Error('Particle collision theatre requires a presentation canvas');
let pointerStart: Readonly<{ id: number; x: number; y: number }> | null = null;
canvas.addEventListener('pointerdown', event => {
    if (event.button === 0) {
        pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }
});
canvas.addEventListener('pointerup', event => {
    if (pointerStart?.id !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
    pointerStart = null;
    if (distance <= 6) launchMeteorRain();
});
canvas.addEventListener('pointercancel', () => {
    pointerStart = null;
});

let readingEvents = false;
let lastRead = 0;
particles.onUpdate = () => {
    const now = performance.now();
    if (readingEvents || now - lastRead < 140) return;
    lastRead = now;
    readingEvents = true;
    void particles.readEvents(12_288).then(aggregate => {
        for (const [name, count] of Object.entries(aggregate.counts)) {
            totals[name] = (totals[name] ?? 0) + count;
        }
        const impactCount =
            lanes.reduce((sum, lane) => sum + (totals[lane.event] ?? 0), 0) +
            (totals['impact-rain'] ?? 0);
        readout.textContent = [
            `alive      ${String(particles.aliveCount).padStart(5)}`,
            `collisions ${String(impactCount).padStart(5)}`,
            `sphere     ${String(totals['impact-sphere'] ?? 0).padStart(5)}`,
            `box        ${String(totals['impact-box'] ?? 0).padStart(5)}`,
            `capsule    ${String(totals['impact-capsule'] ?? 0).padStart(5)}`,
            `plane      ${String(totals['impact-plane'] ?? 0).padStart(5)}`,
            `rain       ${String(totals['impact-rain'] ?? 0).padStart(5)}`,
            `trigger    ${String(totals['gate-enter'] ?? 0).padStart(5)}`,
            `dropped    ${String(aggregate.droppedCount + rainChannel.droppedCount).padStart(5)}`,
            '',
            'click field · four-body meteor rain'
        ].join('\n');
        readingEvents = false;
    });
};

document.body.dataset['particleExampleReady'] = 'true';
installExampleDisposal(() => {
    brdfLUT.destroy();
    diffuseEnvMap.destroy();
    specularEnvMap.destroy();
    environmentMaps.skyboxMap.destroy();
    context.dispose();
});
