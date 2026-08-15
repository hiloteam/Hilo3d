import * as Hilo3d from '../../src/Hilo3d';

export type ParticleTextureStyle = 'disc' | 'spark' | 'ring' | 'smoke' | 'ribbon' | 'comet';

export interface ParticleTextureOptions {
    readonly size?: number;
    readonly style?: ParticleTextureStyle;
    readonly core?: readonly [number, number, number];
}

function clampByte(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
}

/** Creates a small linear particle texture without adding a remote example dependency. */
export function createParticleTexture(
    options: Readonly<ParticleTextureOptions> = {}
): Hilo3d.Texture<Uint8Array> {
    const size = options.size ?? 64;
    const style = options.style ?? 'disc';
    const core = options.core ?? [255, 255, 255];
    const pixels = new Uint8Array(size * size * 4);
    const center = (size - 1) * 0.5;
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const nx = (x - center) / center;
            const ny = (y - center) / center;
            const radius = Math.hypot(nx, ny);
            const angle = Math.atan2(ny, nx);
            const radial = Math.max(0, 1 - radius);
            let alpha = radial * radial;
            if (style === 'spark') {
                const rays = Math.pow(Math.abs(Math.cos(angle * 4)), 18) * Math.max(0, 1 - radius);
                alpha = Math.max(Math.pow(radial, 5), rays * 0.72) * (0.82 + radial * 0.18);
            } else if (style === 'ring') {
                const ring = Math.exp(-Math.pow((radius - 0.58) * 8, 2));
                alpha = Math.max(ring * 0.82, Math.pow(radial, 8) * 0.7);
            } else if (style === 'smoke') {
                const turbulence =
                    Math.sin(nx * 11 + ny * 7) * 0.08 + Math.cos(ny * 13 - nx * 5) * 0.07;
                alpha = Math.pow(Math.max(0, radial + turbulence), 1.8) * 0.72;
            } else if (style === 'ribbon') {
                const edge = Math.max(0, 1 - Math.abs(nx));
                const filament = Math.exp(-Math.pow(nx * 4.2, 2));
                alpha = Math.min(1, Math.pow(edge, 1.7) * 0.72 + filament * 0.46);
            } else if (style === 'comet') {
                const across = Math.exp(-Math.pow(nx * 3.8, 2));
                const along = Math.pow(Math.max(0, 1 - y / Math.max(1, size - 1)), 1.35);
                alpha = across * along;
            }
            const offset = (y * size + x) * 4;
            pixels[offset] = core[0];
            pixels[offset + 1] = core[1];
            pixels[offset + 2] = core[2];
            pixels[offset + 3] = clampByte(alpha * 255);
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
        wrapT: style === 'ribbon' ? Hilo3d.constants.REPEAT : Hilo3d.constants.CLAMP_TO_EDGE,
        magFilter: Hilo3d.constants.LINEAR,
        minFilter: Hilo3d.constants.LINEAR
    });
}

/** Builds a 4x4 procedural atlas whose cells evolve from a pinprick to an energy ring. */
export function createParticleAtlas(
    rows = 4,
    columns = 4,
    cellSize = 32
): Hilo3d.Texture<Uint8Array> {
    const width = columns * cellSize;
    const height = rows * cellSize;
    const pixels = new Uint8Array(width * height * 4);
    const center = (cellSize - 1) * 0.5;
    const frameCount = rows * columns;
    for (let frame = 0; frame < frameCount; frame += 1) {
        const row = Math.floor(frame / columns);
        const column = frame % columns;
        const phase = frame / Math.max(1, frameCount - 1);
        for (let y = 0; y < cellSize; y += 1) {
            for (let x = 0; x < cellSize; x += 1) {
                const nx = (x - center) / center;
                const ny = (y - center) / center;
                const radius = Math.hypot(nx, ny);
                const expandingRing = Math.exp(-Math.pow((radius - phase * 0.72) * 12, 2));
                const core = Math.pow(Math.max(0, 1 - radius * (1.4 + phase)), 3);
                const alpha = Math.max(expandingRing * (1 - phase) * 0.85, core);
                const targetX = column * cellSize + x;
                const targetY = row * cellSize + y;
                const offset = (targetY * width + targetX) * 4;
                pixels[offset] = 255;
                pixels[offset + 1] = clampByte(220 + phase * 35);
                pixels[offset + 2] = clampByte(150 + phase * 105);
                pixels[offset + 3] = clampByte(alpha * 255);
            }
        }
    }
    return new Hilo3d.Texture({
        image: pixels,
        width,
        height,
        internalFormat: Hilo3d.constants.RGBA8,
        format: Hilo3d.constants.RGBA,
        type: Hilo3d.constants.UNSIGNED_BYTE,
        wrapS: Hilo3d.constants.CLAMP_TO_EDGE,
        wrapT: Hilo3d.constants.CLAMP_TO_EDGE,
        magFilter: Hilo3d.constants.LINEAR,
        minFilter: Hilo3d.constants.LINEAR
    });
}

export function addParticlePedestal(
    stage: Hilo3d.Node,
    color: Hilo3d.Color = new Hilo3d.Color(0.06, 0.12, 0.22)
): Hilo3d.Mesh {
    return new Hilo3d.Mesh({
        y: -1.48,
        geometry: new Hilo3d.BoxGeometry({ width: 7.6, height: 0.22, depth: 7.6 }),
        material: new Hilo3d.PBRMaterial({
            baseColor: color,
            metallic: 0.72,
            roughness: 0.28
        }),
        castShadows: false,
        receiveShadows: true
    }).addTo(stage);
}

function createRingGeometry(radius: number): Hilo3d.Geometry {
    const geometry = new Hilo3d.Geometry({ mode: Hilo3d.constants.LINES });
    const segments = 96;
    for (let index = 0; index < segments; index += 1) {
        const start = (index / segments) * Math.PI * 2;
        const end = ((index + 1) / segments) * Math.PI * 2;
        geometry.addPoints(
            [Math.cos(start) * radius, Math.sin(start) * radius, 0],
            [Math.cos(end) * radius, Math.sin(end) * radius, 0]
        );
        geometry.addIndices(index * 2, index * 2 + 1);
    }
    return geometry;
}

export function addParticleBackdrop(stage: Hilo3d.Node): Hilo3d.Node {
    const root = new Hilo3d.Node().addTo(stage);
    const ringMaterial = new Hilo3d.BasicMaterial({
        diffuse: new Hilo3d.Color(0.16, 0.48, 0.9),
        lightType: 'NONE',
        opacity: 0.28,
        compositing: { mode: 'alpha-blend', premultiplied: false }
    });
    for (let index = 0; index < 3; index += 1) {
        const ring = new Hilo3d.Mesh({
            y: -1.31 + index * 0.012,
            rotationX: -90,
            geometry: createRingGeometry(1.35 + index * 0.82),
            material: ringMaterial,
            castShadows: false
        }).addTo(root);
        ring.onUpdate = deltaTime => {
            ring.rotationZ += deltaTime * (0.006 + index * 0.003) * (index % 2 === 0 ? 1 : -1);
        };
    }
    return root;
}

export function requireElement<ElementType extends Element>(
    selector: string,
    constructor: new () => ElementType
): ElementType {
    const element = document.querySelector(selector);
    if (!(element instanceof constructor))
        throw new Error(`Missing particle UI element ${selector}`);
    return element;
}

export function installExampleDisposal(dispose: () => void): void {
    window.addEventListener('pagehide', dispose, { once: true });
}
