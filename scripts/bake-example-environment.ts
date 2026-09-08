import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
import { PNG } from 'pngjs';
import { format, resolveConfig } from 'prettier';

type Vector3 = readonly [number, number, number];
type Color3 = [number, number, number];
type CubeFace = 0 | 1 | 2 | 3 | 4 | 5;

interface RadianceImage {
    readonly shape: readonly [number, number];
    readonly data: Float32Array;
    readonly exposure: number;
    readonly gamma: number;
}

interface RadianceParserModule {
    readonly parseRadianceHDR: (input: Uint8Array) => RadianceImage;
}

interface EnvironmentImage {
    readonly width: number;
    readonly height: number;
    readonly data: Float32Array;
}

interface HemisphereSample {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly weight: number;
    readonly lod: number;
}

const root = resolve(import.meta.dirname, '..');
const sourceName = 'photo_studio_loft_hall_2k.hdr';
const sourceUrl = `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/${sourceName}`;
const sourceDigest = '2eadabfce70a1f27d958aa18b2572d75883f9964f4656c10e706a44cafe129d0';
const cacheDirectory = resolve(root, '.cache/example-environment');
const outputDirectory = resolve(root, 'examples/image/environment/photo-studio-loft-hall');
const faceNames = ['right', 'left', 'top', 'bottom', 'front', 'back'] as const;
const diffuseSize = 64;
const specularSize = 256;
const skyboxSize = 128;
const backgroundExposure = 8;
const sampleCount = 1024;
const targetMeanLuminance = 0.45;
// World longitude = source longitude + this offset; shared by every derived texture.
const longitudeOffset = -Math.PI / 2;

function valueAt(values: Float32Array, index: number): number {
    const value = values[index];
    if (value === undefined) throw new RangeError('Environment pixel is outside the source.');
    return value;
}

function normalize(x: number, y: number, z: number): Vector3 {
    const inverseLength = 1 / Math.hypot(x, y, z);
    return [x * inverseLength, y * inverseLength, z * inverseLength];
}

function cubeDirection(face: CubeFace, pixelX: number, pixelY: number, size: number): Vector3 {
    const x = ((pixelX + 0.5) / size) * 2 - 1;
    const y = ((pixelY + 0.5) / size) * 2 - 1;
    switch (face) {
        case 0:
            return normalize(1, -y, -x);
        case 1:
            return normalize(-1, -y, x);
        case 2:
            return normalize(x, 1, y);
        case 3:
            return normalize(x, -1, -y);
        case 4:
            return normalize(x, -y, 1);
        case 5:
            return normalize(-x, -y, -1);
    }
}

async function loadSource(): Promise<RadianceImage> {
    await mkdir(cacheDirectory, { recursive: true });
    const sourcePath = resolve(cacheDirectory, sourceName);
    let bytes: Uint8Array;
    try {
        bytes = await readFile(sourcePath);
    } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
            throw error;
        }
        const response = await fetch(sourceUrl);
        if (!response.ok) {
            throw new Error(`HDR download failed: ${String(response.status)}`, { cause: error });
        }
        bytes = new Uint8Array(await response.arrayBuffer());
        await writeFile(sourcePath, bytes);
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== sourceDigest) {
        throw new Error(`HDR source SHA-256 changed: ${digest}; review the upstream asset first.`);
    }

    // Load the engine's maintained decoder without pulling browser sources into the Node project.
    const parser = await createJiti(import.meta.url).import<RadianceParserModule>(
        resolve(root, 'src/loader/RadianceHDRParser.ts')
    );
    const image = parser.parseRadianceHDR(bytes);
    if (image.shape[0] !== 2048 || image.shape[1] !== 1024 || image.gamma !== 1) {
        throw new Error('The pinned environment must be a linear 2048 × 1024 Radiance image.');
    }
    return image;
}

function normalizeEnvironment(image: RadianceImage): {
    readonly image: EnvironmentImage;
    readonly scale: number;
    readonly meanLuminance: number;
    readonly brightestDirection: Vector3;
} {
    const [width, height] = image.shape;
    let weightedLuminance = 0;
    let totalWeight = 0;
    let peakLuminance = 0;
    let peakX = 0;
    let peakY = 0;
    for (let y = 0; y < height; y++) {
        const weight = Math.sin(((y + 0.5) / height) * Math.PI);
        for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * 4;
            const luminance =
                0.2126 * valueAt(image.data, offset) +
                0.7152 * valueAt(image.data, offset + 1) +
                0.0722 * valueAt(image.data, offset + 2);
            weightedLuminance += luminance * weight;
            totalWeight += weight;
            if (luminance > peakLuminance) {
                peakLuminance = luminance;
                peakX = x;
                peakY = y;
            }
        }
    }
    const meanLuminance = weightedLuminance / totalWeight;
    const scale = targetMeanLuminance / meanLuminance;
    const data = new Float32Array(width * height * 3);
    for (let index = 0; index < width * height; index++) {
        for (let channel = 0; channel < 3; channel++) {
            data[index * 3 + channel] = valueAt(image.data, index * 4 + channel) * scale;
        }
    }
    const longitude = ((peakX + 0.5) / width - 0.5) * Math.PI * 2 + longitudeOffset;
    const latitude = (0.5 - (peakY + 0.5) / height) * Math.PI;
    return {
        image: { width, height, data },
        scale,
        meanLuminance,
        brightestDirection: [
            Math.cos(latitude) * Math.cos(longitude),
            Math.sin(latitude),
            Math.cos(latitude) * Math.sin(longitude)
        ]
    };
}

function createSourceMipmaps(source: EnvironmentImage): readonly EnvironmentImage[] {
    const mipmaps: EnvironmentImage[] = [source];
    let previous = source;
    while (previous.height > 1) {
        const width = previous.width / 2;
        const height = previous.height / 2;
        const data = new Float32Array(width * height * 3);
        for (let y = 0; y < height; y++) {
            const row0Weight = Math.sin(((y * 2 + 0.5) / previous.height) * Math.PI);
            const row1Weight = Math.sin(((y * 2 + 1.5) / previous.height) * Math.PI);
            for (let x = 0; x < width; x++) {
                for (let channel = 0; channel < 3; channel++) {
                    const topLeft = (y * 2 * previous.width + x * 2) * 3 + channel;
                    const bottomLeft = topLeft + previous.width * 3;
                    data[(y * width + x) * 3 + channel] =
                        ((valueAt(previous.data, topLeft) + valueAt(previous.data, topLeft + 3)) *
                            row0Weight +
                            (valueAt(previous.data, bottomLeft) +
                                valueAt(previous.data, bottomLeft + 3)) *
                                row1Weight) /
                        (2 * (row0Weight + row1Weight));
                }
            }
        }
        previous = { width, height, data };
        mipmaps.push(previous);
    }
    return mipmaps;
}

function sampleBilinear(image: EnvironmentImage, u: number, v: number, output: Color3): void {
    const sourceX = u * image.width - 0.5;
    const sourceY = Math.max(0, Math.min(image.height - 1, v * image.height - 0.5));
    const floorX = Math.floor(sourceX);
    const x0 = ((floorX % image.width) + image.width) % image.width;
    const x1 = (x0 + 1) % image.width;
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(image.height - 1, y0 + 1);
    const fx = sourceX - floorX;
    const fy = sourceY - y0;
    for (const channel of [0, 1, 2] as const) {
        const top =
            valueAt(image.data, (y0 * image.width + x0) * 3 + channel) * (1 - fx) +
            valueAt(image.data, (y0 * image.width + x1) * 3 + channel) * fx;
        const bottom =
            valueAt(image.data, (y1 * image.width + x0) * 3 + channel) * (1 - fx) +
            valueAt(image.data, (y1 * image.width + x1) * 3 + channel) * fx;
        output[channel] = top * (1 - fy) + bottom * fy;
    }
}

function sampleEnvironment(
    mipmaps: readonly EnvironmentImage[],
    x: number,
    y: number,
    z: number,
    lod: number,
    output: Color3,
    scratch: Color3
): void {
    const u = (Math.atan2(z, x) - longitudeOffset) / (Math.PI * 2) + 0.5;
    const v = Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI;
    const level = Math.max(0, Math.min(mipmaps.length - 1, lod));
    const lower = Math.floor(level);
    const first = mipmaps[lower];
    if (!first) throw new Error('Missing source mip.');
    sampleBilinear(first, u, v, output);
    const fraction = level - lower;
    if (fraction > 0) {
        const second = mipmaps[lower + 1];
        if (!second) throw new Error('Missing source mip.');
        sampleBilinear(second, u, v, scratch);
        for (const channel of [0, 1, 2] as const) {
            output[channel] += (scratch[channel] - output[channel]) * fraction;
        }
    }
}

function radicalInverse(index: number): number {
    let bits = index;
    bits = ((bits << 16) | (bits >>> 16)) >>> 0;
    bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
    bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
    bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
    bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
    return bits / 4294967296;
}

function hemisphereSamples(roughness: number, count = sampleCount): readonly HemisphereSample[] {
    const samples: HemisphereSample[] = [];
    const sourceTexelSolidAngle = (4 * Math.PI) / (2048 * 1024);
    for (let index = 0; index < count; index++) {
        const phi = (2 * Math.PI * index) / count;
        const xi = radicalInverse(index);
        const alphaSquared = roughness ** 4;
        const cosTheta = Math.sqrt((1 - xi) / (1 + (alphaSquared - 1) * xi));
        const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
        const z = 2 * cosTheta * cosTheta - 1;
        if (z <= 0) continue;
        const denominator = cosTheta * cosTheta * (alphaSquared - 1) + 1;
        const distribution = alphaSquared / (Math.PI * denominator * denominator);
        const pdf = distribution / 4;
        const sampleSolidAngle = 1 / (count * pdf);
        samples.push({
            x: 2 * cosTheta * sinTheta * Math.cos(phi),
            y: 2 * cosTheta * sinTheta * Math.sin(phi),
            z,
            weight: z,
            lod: Math.max(0, 0.5 * Math.log2(sampleSolidAngle / sourceTexelSolidAngle))
        });
    }
    return samples;
}

function convolve(
    mipmaps: readonly EnvironmentImage[],
    normal: Vector3,
    samples: readonly HemisphereSample[],
    output: Color3
): void {
    const tangent =
        Math.abs(normal[1]) < 0.999
            ? normalize(normal[2], 0, -normal[0])
            : normalize(0, -normal[2], normal[1]);
    const bitangent: Vector3 = [
        normal[1] * tangent[2] - normal[2] * tangent[1],
        normal[2] * tangent[0] - normal[0] * tangent[2],
        normal[0] * tangent[1] - normal[1] * tangent[0]
    ];
    const sampled: Color3 = [0, 0, 0];
    const scratch: Color3 = [0, 0, 0];
    output.fill(0);
    let weight = 0;
    for (const sample of samples) {
        const x = tangent[0] * sample.x + bitangent[0] * sample.y + normal[0] * sample.z;
        const y = tangent[1] * sample.x + bitangent[1] * sample.y + normal[1] * sample.z;
        const z = tangent[2] * sample.x + bitangent[2] * sample.y + normal[2] * sample.z;
        sampleEnvironment(mipmaps, x, y, z, sample.lod, sampled, scratch);
        output[0] += sampled[0] * sample.weight;
        output[1] += sampled[1] * sample.weight;
        output[2] += sampled[2] * sample.weight;
        weight += sample.weight;
    }
    output[0] /= weight;
    output[1] /= weight;
    output[2] /= weight;
}

function linearToSrgb(value: number): number {
    return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

function encodeRGBD(target: Buffer, offset: number, color: Color3, diffuse: boolean): void {
    const r = linearToSrgb(color[0]);
    const g = linearToSrgb(color[1]);
    const b = linearToSrgb(color[2]);
    const maximum = Math.max(r, g, b);
    if (diffuse && maximum > 1) {
        throw new Error('Diffuse environment exceeds its RGB-only sRGB storage contract.');
    }
    // pbr.frag divides encoded RGB by D BEFORE decoding sRGB. Diffuse reads RGB only.
    const divisorByte = diffuse ? 255 : Math.min(255, Math.floor(255 / Math.max(1, maximum)));
    if (divisorByte < 1) throw new Error('Specular radiance exceeds RGBD storage capacity.');
    target[offset] = Math.round(r * divisorByte);
    target[offset + 1] = Math.round(g * divisorByte);
    target[offset + 2] = Math.round(b * divisorByte);
    target[offset + 3] = divisorByte;
}

function diffuseConvolution(source: EnvironmentImage): Float32Array {
    const samples: { readonly direction: Vector3; readonly color: Color3 }[] = [];
    for (let row = 0; row < source.height; row++) {
        const latitude = (0.5 - (row + 0.5) / source.height) * Math.PI;
        const vertical = Math.sin(latitude);
        const horizontal = Math.cos(latitude);
        const solidAngleOverPi =
            ((Math.sin((0.5 - row / source.height) * Math.PI) -
                Math.sin((0.5 - (row + 1) / source.height) * Math.PI)) *
                2) /
            source.width;
        for (let column = 0; column < source.width; column++) {
            const longitude = ((column + 0.5) / source.width - 0.5) * 2 * Math.PI + longitudeOffset;
            const offset = (row * source.width + column) * 3;
            samples.push({
                direction: [
                    horizontal * Math.cos(longitude),
                    vertical,
                    horizontal * Math.sin(longitude)
                ],
                color: [
                    valueAt(source.data, offset) * solidAngleOverPi,
                    valueAt(source.data, offset + 1) * solidAngleOverPi,
                    valueAt(source.data, offset + 2) * solidAngleOverPi
                ]
            });
        }
    }
    const colors = new Float32Array(diffuseSize * diffuseSize * 6 * 3);
    let offset = 0;
    for (let face = 0; face < 6; face++) {
        for (let y = 0; y < diffuseSize; y++) {
            for (let x = 0; x < diffuseSize; x++) {
                const normal = cubeDirection(face as CubeFace, x, y, diffuseSize);
                let r = 0;
                let g = 0;
                let b = 0;
                for (const sample of samples) {
                    const cosine = Math.max(
                        0,
                        normal[0] * sample.direction[0] +
                            normal[1] * sample.direction[1] +
                            normal[2] * sample.direction[2]
                    );
                    r += sample.color[0] * cosine;
                    g += sample.color[1] * cosine;
                    b += sample.color[2] * cosine;
                }
                colors[offset++] = r;
                colors[offset++] = g;
                colors[offset++] = b;
            }
        }
    }
    return colors;
}

async function bakeCube(
    mipmaps: readonly EnvironmentImage[],
    diffuseColors?: Float32Array
): Promise<void> {
    const diffuse = diffuseColors !== undefined;
    const faceSize = diffuse ? diffuseSize : specularSize;
    const levelCount = diffuse ? 1 : Math.log2(faceSize) + 1;
    let byteLength = 16;
    for (let level = 0; level < levelCount; level++) {
        byteLength += (faceSize >> level) ** 2 * 4 * 6;
    }
    const data = Buffer.alloc(byteLength);
    data.write('H3DRGBD1', 0, 'ascii');
    data.writeUInt32LE(faceSize, 8);
    data.writeUInt32LE(levelCount, 12);
    const color: Color3 = [0, 0, 0];
    const scratch: Color3 = [0, 0, 0];
    let offset = 16;
    for (let level = 0; level < levelCount; level++) {
        const size = faceSize >> level;
        const samples = diffuse || level === 0 ? [] : hemisphereSamples(level / (levelCount - 1));
        for (let face = 0; face < 6; face++) {
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const direction = cubeDirection(face as CubeFace, x, y, size);
                    if (diffuseColors) {
                        const colorOffset = (face * size * size + y * size + x) * 3;
                        color[0] = valueAt(diffuseColors, colorOffset);
                        color[1] = valueAt(diffuseColors, colorOffset + 1);
                        color[2] = valueAt(diffuseColors, colorOffset + 2);
                    } else if (level === 0) {
                        sampleEnvironment(mipmaps, ...direction, 0, color, scratch);
                    } else {
                        convolve(mipmaps, direction, samples, color);
                    }
                    encodeRGBD(data, offset, color, diffuse);
                    offset += 4;
                }
            }
        }
        console.log(
            `${diffuse ? 'Diffuse' : 'Specular'} level ${String(level)}: ${String(size)} px`
        );
    }
    await writeFile(resolve(outputDirectory, diffuse ? 'diffuse.rgbd' : 'specular.rgbd'), data);
}

async function bakeSkybox(source: EnvironmentImage): Promise<void> {
    // Compress display highlights before blur so windows retain their shape without HDR bloom.
    const displaySource: EnvironmentImage = {
        width: source.width,
        height: source.height,
        data: source.data.map(
            value => (value * backgroundExposure) / (1 + value * backgroundExposure)
        )
    };
    const mipmaps = createSourceMipmaps(displaySource);
    const samples = hemisphereSamples(0.3, 256);
    const color: Color3 = [0, 0, 0];
    for (let face = 0; face < 6; face++) {
        const image = new PNG({ width: skyboxSize, height: skyboxSize });
        for (let y = 0; y < skyboxSize; y++) {
            for (let x = 0; x < skyboxSize; x++) {
                const direction = cubeDirection(face as CubeFace, x, y, skyboxSize);
                convolve(mipmaps, direction, samples, color);
                const offset = (y * skyboxSize + x) * 4;
                for (const channel of [0, 1, 2] as const) {
                    image.data[offset + channel] = Math.round(linearToSrgb(color[channel]) * 255);
                }
                image.data[offset + 3] = 255;
            }
        }
        await writeFile(
            resolve(outputDirectory, `${String(faceNames[face])}.png`),
            PNG.sync.write(image, { colorType: 2, inputHasAlpha: true, deflateLevel: 9 })
        );
    }
}

async function bakeSphericalHarmonics(image: EnvironmentImage): Promise<void> {
    const coefficients = Array.from({ length: 9 }, (): Color3 => [0, 0, 0]);
    const scales = [
        Math.sqrt(1 / (4 * Math.PI)),
        -Math.sqrt(3 / (4 * Math.PI)),
        Math.sqrt(3 / (4 * Math.PI)),
        -Math.sqrt(3 / (4 * Math.PI)),
        Math.sqrt(15 / (4 * Math.PI)),
        -Math.sqrt(15 / (4 * Math.PI)),
        Math.sqrt(5 / (16 * Math.PI)),
        -Math.sqrt(15 / (4 * Math.PI)),
        Math.sqrt(15 / (16 * Math.PI))
    ];
    for (let row = 0; row < image.height; row++) {
        const latitude = (0.5 - (row + 0.5) / image.height) * Math.PI;
        const y = Math.sin(latitude);
        const horizontal = Math.cos(latitude);
        const solidAngle =
            ((Math.sin((0.5 - row / image.height) * Math.PI) -
                Math.sin((0.5 - (row + 1) / image.height) * Math.PI)) *
                2 *
                Math.PI) /
            image.width;
        for (let column = 0; column < image.width; column++) {
            const longitude = ((column + 0.5) / image.width - 0.5) * 2 * Math.PI + longitudeOffset;
            const x = horizontal * Math.cos(longitude);
            const z = horizontal * Math.sin(longitude);
            const basis = [1, y, z, x, y * x, y * z, 3 * z * z - 1, z * x, x * x - y * y];
            for (let index = 0; index < coefficients.length; index++) {
                const coefficient = coefficients[index];
                const scale = scales[index];
                const polynomial = basis[index];
                if (!coefficient || scale === undefined || polynomial === undefined) {
                    throw new Error('Incomplete spherical-harmonic basis.');
                }
                // scaleForRender() applies the basis and 1/π, so store convolved irradiance.
                const convolution =
                    index === 0 ? Math.PI : index < 4 ? (2 * Math.PI) / 3 : Math.PI / 4;
                const weight = polynomial * scale * solidAngle * convolution;
                for (const channel of [0, 1, 2] as const) {
                    coefficient[channel] +=
                        valueAt(image.data, (row * image.width + column) * 3 + channel) * weight;
                }
            }
        }
    }
    const outputPath = resolve(outputDirectory, 'spherical-harmonics.json');
    const options = await resolveConfig(outputPath);
    await writeFile(
        outputPath,
        await format(JSON.stringify(coefficients), { ...options, filepath: outputPath })
    );
}

const source = await loadSource();
const normalized = normalizeEnvironment(source);
const diffuseSource = createSourceMipmaps(normalized.image)[4];
if (!diffuseSource) throw new Error('Missing diffuse quadrature source.');
const diffuseColors = diffuseConvolution(diffuseSource);
let diffusePeak = 0;
for (const value of diffuseColors) diffusePeak = Math.max(diffusePeak, value);
const storageScale = Math.min(1, 0.95 / diffusePeak);
if (storageScale < 1) {
    normalized.image.data.set(normalized.image.data.map(value => value * storageScale));
    diffuseColors.set(diffuseColors.map(value => value * storageScale));
}
const sourceMipmaps = createSourceMipmaps(normalized.image);
await mkdir(outputDirectory, { recursive: true });
console.log(
    JSON.stringify(
        {
            sourceMeanLuminance: normalized.meanLuminance,
            normalizationScale: normalized.scale * storageScale,
            normalizedMeanLuminance: targetMeanLuminance * storageScale,
            diffusePeak: diffusePeak * storageScale,
            brightestDirection: normalized.brightestDirection
        },
        null,
        2
    )
);
await bakeSkybox(normalized.image);
await bakeSphericalHarmonics(normalized.image);
await bakeCube(sourceMipmaps, diffuseColors);
await bakeCube(sourceMipmaps);
