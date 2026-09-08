import * as Hilo3d from '../../src/Hilo3d';
import { createLumenRoundedBox } from './lumenGeometry';
import { loadDefaultEnvironmentMaps } from './defaultEnvironment';

type Triple = readonly [number, number, number];
type Surface = (along: number, across: number) => Triple;
const TAU = Math.PI * 2;

interface RibbonFrame {
    readonly center: Triple;
    readonly right: Triple;
    readonly up: Triple;
    readonly width: number;
}

function subtract(a: Triple, b: Triple): Triple {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function normalize(v: Triple): Triple {
    const length = Math.hypot(...v);
    return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: Triple, b: Triple): Triple {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Closed, asymmetrical calligraphic knot, elongated vertically to read as an exhibition piece. */
function ribbonCenter(t: number): Triple {
    const radius = 1.35 + 0.38 * Math.cos(3 * t);
    return [radius * Math.cos(2 * t), radius * Math.sin(2 * t) * 1.12, 0.64 * Math.sin(3 * t)];
}

function ribbonFrame(t: number): RibbonFrame {
    const tangent = normalize(subtract(ribbonCenter(t + 0.0001), ribbonCenter(t - 0.0001)));
    const outward = normalize(cross(tangent, [0, 0, 1]));
    const binormal = cross(tangent, outward);
    const twist = 0.55 * Math.sin(3 * t + 0.8) + 0.32 * Math.cos(t);
    const cosine = Math.cos(twist);
    const sine = Math.sin(twist);
    return {
        center: ribbonCenter(t),
        right: [
            outward[0] * cosine + binormal[0] * sine,
            outward[1] * cosine + binormal[1] * sine,
            outward[2] * cosine + binormal[2] * sine
        ],
        up: [
            binormal[0] * cosine - outward[0] * sine,
            binormal[1] * cosine - outward[1] * sine,
            binormal[2] * cosine - outward[2] * sine
        ],
        width: 0.36 + 0.12 * (0.5 + Math.sin(t + 0.4) * 0.5)
    };
}

function framePoint(frame: RibbonFrame, width: number, depth: number): Triple {
    return [
        frame.center[0] + frame.right[0] * width + frame.up[0] * depth,
        frame.center[1] + frame.right[1] * width + frame.up[1] * depth,
        frame.center[2] + frame.right[2] * width + frame.up[2] * depth
    ];
}

/** Finite-difference normals follow the actual swept surface, including its changing ribbon width. */
function surfaceGeometry(surface: Surface, rows: number, columns: number): Hilo3d.Geometry {
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const epsilon = 0.0001;
    for (let row = 0; row <= rows; row++) {
        const u = (row / rows) * TAU;
        for (let column = 0; column <= columns; column++) {
            const v = (column / columns) * TAU;
            const position = surface(u, v);
            const along = subtract(surface(u + epsilon, v), surface(u - epsilon, v));
            const across = subtract(surface(u, v + epsilon), surface(u, v - epsilon));
            vertices.push(...position);
            normals.push(...normalize(cross(across, along)));
            uvs.push(row / rows, column / columns);
            if (row < rows && column < columns) {
                const a = row * (columns + 1) + column;
                const b = a + columns + 1;
                indices.push(a, a + 1, b, a + 1, b + 1, b);
            }
        }
    }
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(vertices), 3),
        normals: new Hilo3d.GeometryData(new Float32Array(normals), 3),
        uvs: new Hilo3d.GeometryData(new Float32Array(uvs), 2),
        indices: new Hilo3d.GeometryData(new Uint16Array(indices), 1)
    });
}

function ribbonGeometry(): Hilo3d.Geometry {
    return surfaceGeometry(
        (t, section) => {
            const frame = ribbonFrame(t);
            const cosine = Math.cos(section);
            const sine = Math.sin(section);
            // A superellipse leaves broad satin faces, softly rolled shoulders and a closed edge.
            return framePoint(
                frame,
                frame.width * Math.sign(cosine) * Math.pow(Math.abs(cosine), 0.4),
                0.055 * Math.sign(sine) * Math.pow(Math.abs(sine), 0.4)
            );
        },
        360,
        32
    );
}

function ribbonSelvedge(side: number): Hilo3d.Geometry {
    return surfaceGeometry(
        (t, section) => {
            const frame = ribbonFrame(t);
            return framePoint(
                frame,
                side * frame.width + Math.cos(section) * 0.016,
                Math.sin(section) * 0.016
            );
        },
        360,
        8
    );
}

/** A beveled disc in XZ, with a real sidewall instead of a flat billboard. */
function discGeometry(): Hilo3d.Geometry {
    const profile = [
        [0, -0.5],
        [0.97, -0.5],
        [1, -0.4],
        [1, 0.4],
        [0.97, 0.5],
        [0, 0.5]
    ] as const;
    const profileNormals = [
        [0, -1],
        [0.35, -0.94],
        [1, -0.1],
        [1, 0.1],
        [0.35, 0.94],
        [0, 1]
    ] as const;
    const vertices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const segments = 144;
    for (const [row, [radius, height]] of profile.entries()) {
        const normal = profileNormals[row];
        if (normal === undefined) throw new Error('Missing gallery disc normal');
        for (let column = 0; column <= segments; column++) {
            const angle = (column / segments) * TAU;
            const x = Math.cos(angle);
            const z = Math.sin(angle);
            vertices.push(x * radius, height, z * radius);
            normals.push(x * normal[0], normal[1], z * normal[0]);
            uvs.push(x * radius * 0.5 + 0.5, z * radius * 0.5 + 0.5);
            if (row < profile.length - 1 && column < segments) {
                const a = row * (segments + 1) + column;
                const b = a + segments + 1;
                indices.push(a, b, a + 1, a + 1, b, b + 1);
            }
        }
    }
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(vertices), 3),
        normals: new Hilo3d.GeometryData(new Float32Array(normals), 3),
        uvs: new Hilo3d.GeometryData(new Float32Array(uvs), 2),
        indices: new Hilo3d.GeometryData(new Uint16Array(indices), 1)
    });
}

function ringGeometry(radius: number, thickness: number): Hilo3d.Geometry {
    return surfaceGeometry(
        (t, section) => {
            const r = radius + Math.cos(section) * thickness;
            return [Math.cos(t) * r, Math.sin(t) * r, -Math.sin(section) * thickness];
        },
        160,
        12
    );
}

/** Open circular tube; its end sections are buried inside the mechanical socket meshes. */
function arcGeometry(
    radius: number,
    thickness: number,
    startDegrees: number,
    endDegrees: number
): Hilo3d.Geometry {
    const start = (startDegrees / 180) * Math.PI;
    const span = ((endDegrees - startDegrees) / 180) * Math.PI;
    return surfaceGeometry(
        (along, section) => {
            const angle = start + (along / TAU) * span;
            const r = radius + Math.cos(section) * thickness;
            return [Math.cos(angle) * r, Math.sin(angle) * r, -Math.sin(section) * thickness];
        },
        192,
        12
    );
}

/** Inward-facing 42 m studio cove; its nearest floor bend is beyond every permitted orbit. */
function cycloramaGeometry(): Hilo3d.Geometry {
    const profile: {
        readonly radius: number;
        readonly height: number;
        readonly radialNormal: number;
        readonly verticalNormal: number;
    }[] = [];
    const bendSegments = 12;
    for (let step = 0; step <= bendSegments; step++) {
        const angle = (step / bendSegments) * Math.PI * 0.5;
        profile.push({
            radius: 36 + Math.sin(angle) * 6,
            height: 5.84 - Math.cos(angle) * 6,
            radialNormal: -Math.sin(angle),
            verticalNormal: Math.cos(angle)
        });
    }
    profile.push({ radius: 42, height: 45, radialNormal: -1, verticalNormal: 0 });
    const vertices: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const segments = 192;
    for (const [row, point] of profile.entries()) {
        for (let column = 0; column <= segments; column++) {
            const angle = (column / segments) * TAU;
            const x = Math.cos(angle);
            const z = Math.sin(angle);
            vertices.push(x * point.radius, point.height, z * point.radius);
            normals.push(x * point.radialNormal, point.verticalNormal, z * point.radialNormal);
            if (row < profile.length - 1 && column < segments) {
                const a = row * (segments + 1) + column;
                const b = a + segments + 1;
                indices.push(a, a + 1, b, a + 1, b + 1, b);
            }
        }
    }
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(vertices), 3),
        normals: new Hilo3d.GeometryData(new Float32Array(normals), 3),
        indices: new Hilo3d.GeometryData(new Uint16Array(indices), 1)
    });
}

/** Subtle mineral variation; deterministic so the exhibit has identical surfaces on both backends. */
function limestoneTexture(): Hilo3d.Texture<HTMLCanvasElement> {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Gallery stone requires Canvas 2D');
    const image = context.createImageData(512, 512);
    for (let y = 0; y < 512; y++) {
        for (let x = 0; x < 512; x++) {
            const hash = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
            const grain = hash - Math.floor(hash);
            const strata = Math.sin(x * 0.036 + Math.sin(y * 0.011) * 2.1);
            const value = Math.round(229 + grain * 15 + strata * 4);
            const offset = (y * 512 + x) * 4;
            image.data[offset] = value;
            image.data[offset + 1] = value;
            image.data[offset + 2] = value;
            image.data[offset + 3] = 255;
        }
    }
    context.putImageData(image, 0, 0);
    return new Hilo3d.Texture({ image: canvas });
}

/** Builds the original CHROMATIC installation entirely from reusable indexed geometry. */
export async function createScriptablePipelineScene(stage: Hilo3d.Stage): Promise<{
    readonly target: Hilo3d.Vector3;
    readonly position: Hilo3d.Vector3;
    readonly meshCount: number;
    update(timeSeconds: number): void;
    dispose(): void;
}> {
    const environment = await loadDefaultEnvironmentMaps();
    const brdfLUT = await new Hilo3d.TextureLoader().load({
        src: new URL('../image/brdfLUT.png', import.meta.url).href,
        wrapS: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
        wrapT: Hilo3d.constants.webgl.CLAMP_TO_EDGE
    });
    const mineral = limestoneTexture();
    const root = new Hilo3d.Node({ name: 'CHROMATIC / A study in light' }).addTo(stage);
    const sculpture = new Hilo3d.Node({ name: 'Continuous folded porcelain ribbon' })
        .setPosition(0.85, 3.5, 0)
        .setScale(1.15)
        .setRotation(2, 5, -11)
        .addTo(root);
    const defaults = {
        brdfLUT,
        diffuseEnvMap: { texture: environment.diffuseEnvMap, encoding: 'srgb' as const },
        specularEnvMap: { texture: environment.specularEnvMap, encoding: 'srgb' as const },
        diffuseEnvIntensity: 0.75,
        specularEnvIntensity: 1.25
    };
    const material = (
        color: Triple,
        roughness: number,
        metallic = 0,
        stoneSurface = false
    ): Hilo3d.PBRMaterial =>
        new Hilo3d.PBRMaterial({
            ...defaults,
            baseColor: new Hilo3d.Color(...color),
            ...(stoneSurface
                ? { baseColorMap: { texture: mineral, encoding: 'linear' as const } }
                : {}),
            roughness,
            metallic
        });
    const pearl = new Hilo3d.PBRMaterial({
        ...defaults,
        name: 'Pearlescent ceramic / brushed silver',
        baseColor: new Hilo3d.Color(0.84, 0.9, 0.89),
        metallic: 0.58,
        roughness: 0.27,
        clearcoatFactor: 0.65,
        clearcoatRoughnessFactor: 0.19,
        iridescenceFactor: 0.28,
        iridescenceThicknessMinimum: 160,
        iridescenceThicknessMaximum: 380
    });
    const brass = material([0.74, 0.44, 0.17], 0.25, 0.88);
    const black = material([0.025, 0.038, 0.038], 0.48, 0.1);
    const stone = material([0.025, 0.051, 0.052], 0.81, 0, true);
    const studioBackdrop = material([0.025, 0.051, 0.052], 0.81);
    const ivory = material([0.66, 0.58, 0.44], 0.68, 0, true);
    const teal = material([0.029, 0.095, 0.097], 0.74);
    const trim = material([0.1, 0.17, 0.16], 0.42, 0.45);
    const warmLight = new Hilo3d.PBRMaterial({
        unlit: true,
        baseColor: new Hilo3d.Color(0.2, 0.09, 0.035),
        emissionFactor: new Hilo3d.Color(3.8, 1.75, 0.56)
    });
    const coolLight = new Hilo3d.PBRMaterial({
        unlit: true,
        baseColor: new Hilo3d.Color(0.02, 0.1, 0.12),
        emissionFactor: new Hilo3d.Color(0.55, 2.3, 2.5)
    });
    const box = new Hilo3d.BoxGeometry();
    const rounded = createLumenRoundedBox();
    const disc = discGeometry();
    let meshCount = 0;
    function mesh(
        name: string,
        geometry: Hilo3d.Geometry,
        surface: Hilo3d.PBRMaterial,
        position: Triple,
        scale: Triple = [1, 1, 1],
        parent = root
    ): Hilo3d.Mesh {
        meshCount++;
        return new Hilo3d.Mesh({
            name,
            geometry,
            material: surface,
            castShadows: true,
            receiveShadows: true
        })
            .setPosition(...position)
            .setScale(...scale)
            .addTo(parent);
    }
    function accent(
        name: string,
        geometry: Hilo3d.Geometry,
        surface: Hilo3d.PBRMaterial,
        position: Triple,
        scale: Triple = [1, 1, 1],
        parent = root
    ): Hilo3d.Mesh {
        const lightMesh = mesh(name, geometry, surface, position, scale, parent);
        lightMesh.castShadows = false;
        lightMesh.receiveShadows = false;
        return lightMesh;
    }

    mesh('Folded continuous ribbon', ribbonGeometry(), pearl, [0, 0, 0], [1, 1, 1], sculpture);
    for (const side of [-1, 1]) {
        mesh(
            'Hand-polished brass selvedge',
            ribbonSelvedge(side),
            brass,
            [0, 0, 0],
            [1, 1, 1],
            sculpture
        );
    }

    // The low, layered island creates a grounded silhouette and several different shadow receivers.
    mesh('Gallery floor', box, stone, [0, -0.36, 0], [100, 0.4, 100]).castShadows = false;
    mesh('Circular exhibition island', disc, black, [0.85, -0.04, 0], [3.72, 0.36, 3.72]);
    mesh('Island limestone tread', disc, ivory, [0.85, 0.16, 0], [3.61, 0.11, 3.61]);
    mesh('Floating black plinth', disc, black, [0.85, 0.5, 0], [2.42, 0.56, 2.42]);
    mesh('Plinth bronze reveal', disc, brass, [0.85, 0.793, 0], [2.4, 0.038, 2.4]);
    mesh('Honed ivory presentation surface', disc, ivory, [0.85, 0.857, 0], [2.34, 0.09, 2.34]);
    accent(
        'Warm light beneath plinth',
        ringGeometry(2.405, 0.012),
        warmLight,
        [0.85, 0.3, 0]
    ).rotationX = -90;
    for (const radius of [2.92, 3.46]) {
        mesh(
            'Inlaid bronze floor orbit',
            ringGeometry(radius, 0.008),
            brass,
            [0.85, 0.22, 0]
        ).rotationX = -90;
    }
    for (let index = 0; index < 12; index++) {
        const angle = (index / 12) * TAU;
        const marker = mesh(
            'Radial scale inlay',
            box,
            brass,
            [0.85 + Math.cos(angle) * 3.23, 0.222, Math.sin(angle) * 3.23],
            [0.012, 0.006, 0.1]
        );
        marker.rotationY = 90 - (angle / Math.PI) * 180;
        marker.castShadows = false;
    }

    // One light armature shares the sculpture's plinth. Its center is genuinely open, and the
    // arc ends are anchored at the presentation surface instead of passing through the stone.
    const armature = new Hilo3d.Node({ name: 'Open light armature / part of the sculpture plinth' })
        .setPosition(0.85, 3.32, -0.3)
        .setRotation(0, 25, 0)
        .addTo(root);
    mesh(
        'Brushed graphite arch',
        arcGeometry(3.05, 0.075, -52, 232),
        trim,
        [0, 0, 0],
        [1, 1, 1],
        armature
    );
    mesh(
        'Outer bronze arch reveal',
        arcGeometry(3.095, 0.012, -52, 232),
        brass,
        [0, 0, 0.037],
        [1, 1, 1],
        armature
    );
    for (const offset of [-0.069, 0.069]) {
        accent(
            'Warm inset light / left arc',
            arcGeometry(3.05, 0.018, 92, 226),
            warmLight,
            [0, 0, offset],
            [1, 1, 1],
            armature
        );
        accent(
            'Cool inset light / right arc',
            arcGeometry(3.05, 0.018, -46, 78),
            coolLight,
            [0, 0, offset],
            [1, 1, 1],
            armature
        );
    }
    for (const side of [-1, 1]) {
        const footX = side * 1.878;
        mesh(
            'Arch foot fixed to plinth',
            rounded,
            black,
            [footX, -2.34, 0],
            [0.6, 0.16, 0.62],
            armature
        );
        const collar = mesh(
            'Bronze arch socket',
            rounded,
            brass,
            [footX, -2.285, 0],
            [0.19, 0.28, 0.24],
            armature
        );
        collar.rotationZ = -side * 52;
        for (const boltX of [-0.19, 0.19]) {
            for (const boltZ of [-0.2, 0.2]) {
                mesh(
                    'Recessed armature fastener',
                    box,
                    brass,
                    [footX + boltX, -2.251, boltZ],
                    [0.038, 0.02, 0.038],
                    armature
                );
            }
        }
    }
    // The former tall wall fins now belong to the base: a small, grounded rhythm of metal ribs.
    for (let index = 0; index < 13; index++) {
        const angle = ((205 + index * 7) / 180) * Math.PI;
        const rib = mesh(
            'Low radial plinth rib',
            rounded,
            teal,
            [0.85 + Math.cos(angle) * 3.15, 0.37, Math.sin(angle) * 3.15],
            [0.07, 0.3, 0.38]
        );
        rib.rotationY = 90 - (angle / Math.PI) * 180;
    }
    // Only the seamless room enclosure remains distant; it contains no detached artwork.
    const cove = mesh(
        'Continuous studio cyclorama',
        cycloramaGeometry(),
        studioBackdrop,
        [0, 0, 0]
    );
    cove.castShadows = false;
    cove.receiveShadows = false;
    mesh(
        'Small exhibition label stand',
        rounded,
        black,
        [-1.9, 0.75, 1.85],
        [0.7, 1.22, 0.37]
    ).rotationY = 18;
    mesh(
        'Brass exhibition label',
        rounded,
        brass,
        [-1.84, 1.385, 1.97],
        [0.59, 0.045, 0.25]
    ).rotationX = 12;

    new Hilo3d.AmbientLight({ color: new Hilo3d.Color(0.62, 0.75, 0.79), amount: 0.32 }).addTo(
        root
    );
    new Hilo3d.DirectionalLight({
        name: 'Warm museum skylight',
        color: new Hilo3d.Color(1, 0.83, 0.61),
        amount: 2.15,
        direction: new Hilo3d.Vector3(-0.45, -1, -0.5),
        shadow: {
            width: 2048,
            height: 2048,
            minBias: 0.001,
            maxBias: 0.004,
            cascadeMaxDistance: 30,
            shadowStrength: 1
        }
    }).addTo(root);
    new Hilo3d.DirectionalLight({
        name: 'Cool sculpture rim',
        color: new Hilo3d.Color(0.4, 0.81, 1),
        amount: 0.8,
        direction: new Hilo3d.Vector3(0.75, -0.25, -0.4)
    }).addTo(root);
    new Hilo3d.PointLight({
        name: 'Amber armature light',
        color: new Hilo3d.Color(1, 0.48, 0.16),
        amount: 9,
        range: 10,
        quadraticAttenuation: 0.5
    })
        .setPosition(-1.4, 4.4, 0.9)
        .addTo(root);
    new Hilo3d.PointLight({
        name: 'Cyan armature light',
        color: new Hilo3d.Color(0.25, 0.8, 1),
        amount: 7,
        range: 10,
        quadraticAttenuation: 0.5
    })
        .setPosition(3.0, 3.8, -1.2)
        .addTo(root);
    let disposed = false;
    return {
        target: new Hilo3d.Vector3(0.85, 2.65, 0),
        position: new Hilo3d.Vector3(10.4, 5.7, 13.2),
        meshCount,
        update(timeSeconds: number): void {
            sculpture.rotationY = 5 + Math.sin(timeSeconds * 0.13) * 13;
            sculpture.y = 3.5 + Math.sin(timeSeconds * 0.65) * 0.035;
        },
        dispose(): void {
            if (disposed) return;
            disposed = true;
            root.destroy(stage.renderer);
            brdfLUT.destroy();
            mineral.destroy();
            environment.diffuseEnvMap.destroy();
            environment.specularEnvMap.destroy();
        }
    };
}
