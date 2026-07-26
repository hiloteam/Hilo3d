import * as Hilo3d from '../../src/Hilo3d';

type Vector3Tuple = readonly [number, number, number];
type ColorTuple = readonly [number, number, number];
type CubeFaceIndex = 0 | 1 | 2 | 3 | 4 | 5;
type StudioEnvironmentVariant = 'diffuse' | 'specular';

interface StudioSoftbox {
    readonly direction: Vector3Tuple;
    readonly right: Vector3Tuple;
    readonly up: Vector3Tuple;
    readonly halfWidth: number;
    readonly halfHeight: number;
    readonly feather: number;
    readonly color: ColorTuple;
    readonly intensity: number;
}

function dot(left: Vector3Tuple, right: Vector3Tuple): number {
    return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: Vector3Tuple, right: Vector3Tuple): Vector3Tuple {
    return [
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0]
    ];
}

function normalize(value: Vector3Tuple): Vector3Tuple {
    const length = Math.hypot(value[0], value[1], value[2]);
    return [value[0] / length, value[1] / length, value[2] / length];
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function smoothstep(minimum: number, maximum: number, value: number): number {
    const t = clamp01((value - minimum) / (maximum - minimum));
    return t * t * (3 - 2 * t);
}

function mixColor(left: ColorTuple, right: ColorTuple, amount: number): ColorTuple {
    return [
        left[0] + (right[0] - left[0]) * amount,
        left[1] + (right[1] - left[1]) * amount,
        left[2] + (right[2] - left[2]) * amount
    ];
}

function addColor(target: [number, number, number], color: ColorTuple, intensity: number): void {
    target[0] += color[0] * intensity;
    target[1] += color[1] * intensity;
    target[2] += color[2] * intensity;
}

function createSoftbox(
    direction: Vector3Tuple,
    halfWidth: number,
    halfHeight: number,
    feather: number,
    color: ColorTuple,
    intensity: number
): StudioSoftbox {
    const normalizedDirection = normalize(direction);
    const referenceUp: Vector3Tuple =
        Math.abs(normalizedDirection[1]) > 0.92 ? [0, 0, 1] : [0, 1, 0];
    const right = normalize(cross(referenceUp, normalizedDirection));
    return {
        direction: normalizedDirection,
        right,
        up: normalize(cross(normalizedDirection, right)),
        halfWidth,
        halfHeight,
        feather,
        color,
        intensity
    };
}

const softboxes = [
    createSoftbox([-0.56, 0.52, 0.64], 0.4, 0.21, 0.035, [1, 0.9, 0.78], 0.92),
    createSoftbox([0.68, 0.18, 0.71], 0.17, 0.38, 0.055, [0.3, 0.66, 1], 0.62),
    createSoftbox([-0.22, -0.08, -0.97], 0.24, 0.1, 0.05, [1, 0.34, 0.12], 0.28)
] as const;

function softboxMask(direction: Vector3Tuple, softbox: StudioSoftbox): number {
    const forward = dot(direction, softbox.direction);
    if (forward <= 0.05) return 0;
    const x = Math.abs(dot(direction, softbox.right) / forward);
    const y = Math.abs(dot(direction, softbox.up) / forward);
    const horizontal = 1 - smoothstep(softbox.halfWidth, softbox.halfWidth + softbox.feather, x);
    const vertical = 1 - smoothstep(softbox.halfHeight, softbox.halfHeight + softbox.feather, y);
    return horizontal * vertical * smoothstep(0.1, 0.42, forward);
}

function studioRadiance(direction: Vector3Tuple, variant: StudioEnvironmentVariant): ColorTuple {
    const vertical = smoothstep(-0.92, 0.86, direction[1]);
    const base = mixColor(
        variant === 'diffuse' ? [0.12, 0.09, 0.095] : [0.1, 0.07, 0.078],
        variant === 'diffuse' ? [0.24, 0.31, 0.44] : [0.2, 0.28, 0.42],
        vertical
    );
    const color: [number, number, number] = [base[0], base[1], base[2]];
    const horizon = Math.exp(-Math.abs(direction[1] + 0.14) * 7.5);
    addColor(color, variant === 'diffuse' ? [0.32, 0.21, 0.16] : [0.23, 0.13, 0.075], horizon);

    for (const softbox of softboxes) {
        if (variant === 'specular') {
            addColor(color, softbox.color, softboxMask(direction, softbox) * softbox.intensity);
        } else {
            const broadLobe = Math.pow(Math.max(0, dot(direction, softbox.direction)), 5);
            addColor(color, softbox.color, broadLobe * softbox.intensity * 0.16);
        }
    }

    const floorBounce = Math.pow(clamp01(-direction[1]), 2);
    addColor(color, [0.19, 0.07, 0.025], floorBounce * (variant === 'diffuse' ? 0.12 : 0.06));
    return [clamp01(color[0]), clamp01(color[1]), clamp01(color[2])];
}

function cubeDirection(
    face: CubeFaceIndex,
    pixelX: number,
    pixelY: number,
    size: number
): Vector3Tuple {
    const x = ((pixelX + 0.5) / size) * 2 - 1;
    const y = ((pixelY + 0.5) / size) * 2 - 1;
    switch (face) {
        case 0:
            return normalize([1, -y, -x]);
        case 1:
            return normalize([-1, -y, x]);
        case 2:
            return normalize([x, 1, y]);
        case 3:
            return normalize([x, -1, -y]);
        case 4:
            return normalize([x, -y, 1]);
        case 5:
            return normalize([-x, -y, -1]);
    }
}

function createStudioFace(
    face: CubeFaceIndex,
    variant: StudioEnvironmentVariant,
    size: number
): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Studio environment requires Canvas 2D');
    const image = context.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const color = studioRadiance(cubeDirection(face, x, y, size), variant);
            const offset = (y * size + x) * 4;
            image.data[offset] = Math.round(color[0] * 255);
            image.data[offset + 1] = Math.round(color[1] * 255);
            image.data[offset + 2] = Math.round(color[2] * 255);
            image.data[offset + 3] = 255;
        }
    }
    context.putImageData(image, 0, 0);
    return canvas;
}

function createStudioFaces(
    variant: StudioEnvironmentVariant,
    size: number
): [
    HTMLCanvasElement,
    HTMLCanvasElement,
    HTMLCanvasElement,
    HTMLCanvasElement,
    HTMLCanvasElement,
    HTMLCanvasElement
] {
    return [
        createStudioFace(0, variant, size),
        createStudioFace(1, variant, size),
        createStudioFace(2, variant, size),
        createStudioFace(3, variant, size),
        createStudioFace(4, variant, size),
        createStudioFace(5, variant, size)
    ];
}

/**
 * Creates a seam-coherent, neutral studio environment without legacy LDR skybox assets.
 */
export function createStudioEnvironmentMaps(): {
    readonly diffuseEnvMap: Hilo3d.CubeTexture;
    readonly specularEnvMap: Hilo3d.CubeTexture;
} {
    const diffuseEnvMap = new Hilo3d.CubeTexture({
        image: createStudioFaces('diffuse', 64),
        internalFormat: Hilo3d.constants.RGBA8,
        format: Hilo3d.constants.RGBA,
        minFilter: Hilo3d.constants.webgl.LINEAR,
        magFilter: Hilo3d.constants.webgl.LINEAR
    });
    const specularEnvMap = new Hilo3d.CubeTexture({
        image: createStudioFaces('specular', 256),
        internalFormat: Hilo3d.constants.RGBA8,
        format: Hilo3d.constants.RGBA,
        minFilter: Hilo3d.constants.webgl.LINEAR_MIPMAP_LINEAR,
        magFilter: Hilo3d.constants.webgl.LINEAR,
        anisotropic: 4
    });
    return { diffuseEnvMap, specularEnvMap };
}

/**
 * Produces loadable PNG data URLs for examples that specifically exercise CubeTextureLoader and
 * image-release behavior.
 */
export function createStudioEnvironmentFaceUrls(
    size = 256
): readonly [string, string, string, string, string, string] {
    const faces = createStudioFaces('specular', size);
    return [
        faces[0].toDataURL('image/png'),
        faces[1].toDataURL('image/png'),
        faces[2].toDataURL('image/png'),
        faces[3].toDataURL('image/png'),
        faces[4].toDataURL('image/png'),
        faces[5].toDataURL('image/png')
    ];
}
