import * as Hilo3d from '../../src/Hilo3d';

const ENVIRONMENT_ASSET_URLS = {
    'diffuse.rgbd': new URL(
        '../image/environment/photo-studio-loft-hall/diffuse.rgbd',
        import.meta.url
    ).href,
    'specular.rgbd': new URL(
        '../image/environment/photo-studio-loft-hall/specular.rgbd',
        import.meta.url
    ).href,
    'right.png': new URL('../image/environment/photo-studio-loft-hall/right.png', import.meta.url)
        .href,
    'left.png': new URL('../image/environment/photo-studio-loft-hall/left.png', import.meta.url)
        .href,
    'top.png': new URL('../image/environment/photo-studio-loft-hall/top.png', import.meta.url).href,
    'bottom.png': new URL('../image/environment/photo-studio-loft-hall/bottom.png', import.meta.url)
        .href,
    'front.png': new URL('../image/environment/photo-studio-loft-hall/front.png', import.meta.url)
        .href,
    'back.png': new URL('../image/environment/photo-studio-loft-hall/back.png', import.meta.url)
        .href
} as const;
const RGBD_MAGIC = 'H3DRGBD1';
const HEADER_BYTES = 16;

type EnvironmentAssetName = keyof typeof ENVIRONMENT_ASSET_URLS;

function assetUrl(name: EnvironmentAssetName): string {
    return ENVIRONMENT_ASSET_URLS[name];
}

function expectedPayloadBytes(faceSize: number, levelCount: number): number {
    let bytes = 0;
    for (let level = 0; level < levelCount; level += 1) {
        const size = Math.max(1, faceSize >> level);
        bytes += size * size * 4 * 6;
    }
    return bytes;
}

async function loadRGBDCube(
    name: Extract<EnvironmentAssetName, `${string}.rgbd`>
): Promise<Hilo3d.CubeTexture> {
    const url = assetUrl(name);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(
            `Failed to load default environment ${name}: ${String(response.status)} ${response.statusText}`
        );
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength < HEADER_BYTES) {
        throw new Error(`Default environment ${name} has a truncated header.`);
    }
    const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, RGBD_MAGIC.length));
    if (magic !== RGBD_MAGIC) {
        throw new Error(`Default environment ${name} has an invalid RGBD signature.`);
    }
    const header = new DataView(buffer);
    const faceSize = header.getUint32(8, true);
    const levelCount = header.getUint32(12, true);
    const completeLevelCount = Math.floor(Math.log2(faceSize)) + 1;
    if (
        faceSize < 1 ||
        (faceSize & (faceSize - 1)) !== 0 ||
        levelCount < 1 ||
        levelCount > completeLevelCount
    ) {
        throw new Error(
            `Default environment ${name} has invalid dimensions ${String(faceSize)} / ${String(levelCount)}.`
        );
    }
    const payloadBytes = expectedPayloadBytes(faceSize, levelCount);
    if (buffer.byteLength !== HEADER_BYTES + payloadBytes) {
        throw new Error(
            `Default environment ${name} has ${String(buffer.byteLength)} bytes; expected ${String(HEADER_BYTES + payloadBytes)}.`
        );
    }

    const mipmaps: Hilo3d.TextureMipmap[] = [];
    let offset = HEADER_BYTES;
    for (let level = 0; level < levelCount; level += 1) {
        const size = Math.max(1, faceSize >> level);
        const faceBytes = size * size * 4;
        for (let face = 0; face < 6; face += 1) {
            mipmaps.push({
                data: new Uint8Array(buffer, offset, faceBytes),
                width: size,
                height: size,
                face: face as Hilo3d.TextureCubeFace
            });
            offset += faceBytes;
        }
    }

    return new Hilo3d.CubeTexture({
        image: [],
        width: faceSize,
        height: faceSize,
        internalFormat: Hilo3d.constants.RGBA8,
        format: Hilo3d.constants.RGBA,
        type: Hilo3d.constants.webgl.UNSIGNED_BYTE,
        minFilter:
            levelCount > 1
                ? Hilo3d.constants.webgl.LINEAR_MIPMAP_LINEAR
                : Hilo3d.constants.webgl.LINEAR,
        magFilter: Hilo3d.constants.webgl.LINEAR,
        anisotropic: levelCount > 1 ? 4 : 1,
        mipmaps
    });
}

export async function loadDefaultEnvironmentMaps(): Promise<{
    readonly diffuseEnvMap: Hilo3d.CubeTexture;
    readonly specularEnvMap: Hilo3d.CubeTexture;
}> {
    const [diffuseEnvMap, specularEnvMap] = await Promise.all([
        loadRGBDCube('diffuse.rgbd'),
        loadRGBDCube('specular.rgbd')
    ]);
    return { diffuseEnvMap, specularEnvMap };
}

export function getDefaultSkyboxFaceUrls(): readonly [
    string,
    string,
    string,
    string,
    string,
    string
] {
    return [
        assetUrl('right.png'),
        assetUrl('left.png'),
        assetUrl('top.png'),
        assetUrl('bottom.png'),
        assetUrl('front.png'),
        assetUrl('back.png')
    ];
}

export function loadDefaultSkyboxMap(): Promise<Hilo3d.CubeTexture> {
    return new Hilo3d.CubeTextureLoader().load({
        images: getDefaultSkyboxFaceUrls(),
        internalFormat: Hilo3d.constants.SRGB8,
        format: Hilo3d.constants.RGB,
        minFilter: Hilo3d.constants.webgl.LINEAR,
        magFilter: Hilo3d.constants.webgl.LINEAR,
        anisotropic: 4
    });
}
