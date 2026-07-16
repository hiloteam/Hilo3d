import BasicLoader, { type LoaderRequest } from './BasicLoader';
import Loader from './Loader';
import Texture from '../texture/Texture';
import type { LoaderTextureOptions } from './textureOptions';

interface KTXMipmap {
    data: Uint8Array;
    width: number;
    height: number;
}

const KTX_IDENTIFIER = new Uint8Array([
    0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a
]);

/** Parser for a single-face KTX 1.1 2D texture container. */
class KhronosTextureContainer {
    static readonly HEADER_LEN = 12 + 13 * Uint32Array.BYTES_PER_ELEMENT;
    static readonly COMPRESSED_2D = 0;
    static readonly TEX_2D = 2;

    readonly isKhronosTextureContainer = true;
    readonly className = 'KhronosTextureContainer';
    readonly arrayBuffer: ArrayBuffer;
    readonly baseOffset: number;
    readonly glType: GLenum;
    readonly glTypeSize: number;
    readonly glFormat: GLenum;
    readonly glInternalFormat: GLenum;
    readonly glBaseInternalFormat: GLenum;
    readonly pixelWidth: number;
    readonly pixelHeight: number;
    readonly pixelDepth: number;
    readonly numberOfArrayElements: number;
    readonly numberOfFaces: number;
    readonly numberOfMipmapLevels: number;
    readonly bytesOfKeyValueData: number;
    readonly loadType: number;
    private readonly littleEndian: boolean;

    constructor(arrayBuffer: ArrayBuffer, facesExpected: 1 | 6, baseOffset = 0) {
        if (!Number.isSafeInteger(baseOffset) || baseOffset < 0) {
            throw new RangeError('KTX base offset must be a non-negative safe integer.');
        }
        if (baseOffset + KhronosTextureContainer.HEADER_LEN > arrayBuffer.byteLength) {
            throw new RangeError('KTX header is truncated.');
        }
        this.arrayBuffer = arrayBuffer;
        this.baseOffset = baseOffset;
        const identifier = new Uint8Array(arrayBuffer, baseOffset, KTX_IDENTIFIER.length);
        if (!identifier.every((byte, index) => byte === KTX_IDENTIFIER[index])) {
            throw new TypeError('Texture is missing the KTX 1.1 identifier.');
        }

        const dataSize = Uint32Array.BYTES_PER_ELEMENT;
        const header = new DataView(arrayBuffer, baseOffset + 12, 13 * dataSize);
        const endianness = header.getUint32(0, true);
        if (endianness === 0x04030201) {
            this.littleEndian = true;
        } else if (endianness === 0x01020304) {
            this.littleEndian = false;
        } else {
            throw new TypeError('KTX file has an invalid endianness marker.');
        }
        this.glType = header.getUint32(dataSize, this.littleEndian);
        this.glTypeSize = header.getUint32(2 * dataSize, this.littleEndian);
        this.glFormat = header.getUint32(3 * dataSize, this.littleEndian);
        this.glInternalFormat = header.getUint32(4 * dataSize, this.littleEndian);
        this.glBaseInternalFormat = header.getUint32(5 * dataSize, this.littleEndian);
        this.pixelWidth = header.getUint32(6 * dataSize, this.littleEndian);
        this.pixelHeight = header.getUint32(7 * dataSize, this.littleEndian);
        this.pixelDepth = header.getUint32(8 * dataSize, this.littleEndian);
        this.numberOfArrayElements = header.getUint32(9 * dataSize, this.littleEndian);
        this.numberOfFaces = header.getUint32(10 * dataSize, this.littleEndian);
        this.numberOfMipmapLevels = header.getUint32(11 * dataSize, this.littleEndian);
        this.bytesOfKeyValueData = header.getUint32(12 * dataSize, this.littleEndian);

        if (this.pixelWidth === 0 || this.pixelHeight === 0 || this.pixelDepth !== 0) {
            throw new TypeError('Only 2D KTX textures are supported.');
        }
        if (this.numberOfArrayElements !== 0) {
            throw new TypeError('KTX texture arrays are not supported.');
        }
        if (this.numberOfFaces !== facesExpected) {
            throw new TypeError(
                `Expected ${String(facesExpected)} KTX face(s), received ${String(this.numberOfFaces)}.`
            );
        }
        if (this.numberOfMipmapLevels === 0) {
            throw new TypeError('KTX runtime mipmap generation is not supported.');
        }
        this.loadType =
            this.glType === 0
                ? KhronosTextureContainer.COMPRESSED_2D
                : KhronosTextureContainer.TEX_2D;
    }

    mipmaps(loadMipmaps: boolean): KTXMipmap[] {
        const mipmaps: KTXMipmap[] = [];
        let dataOffset = KhronosTextureContainer.HEADER_LEN + this.bytesOfKeyValueData;
        let width = this.pixelWidth;
        let height = this.pixelHeight;
        const count = loadMipmaps ? this.numberOfMipmapLevels : 1;

        for (let level = 0; level < count; level++) {
            const levelOffset = this.baseOffset + dataOffset;
            if (levelOffset > this.arrayBuffer.byteLength - Uint32Array.BYTES_PER_ELEMENT) {
                throw new RangeError(
                    `KTX mip level ${String(level)} is truncated before imageSize.`
                );
            }
            const imageSize = new DataView(
                this.arrayBuffer,
                levelOffset,
                Uint32Array.BYTES_PER_ELEMENT
            ).getUint32(0, this.littleEndian);
            if (imageSize === 0) {
                throw new RangeError(`Invalid KTX mip level ${String(level)} size.`);
            }
            dataOffset += Uint32Array.BYTES_PER_ELEMENT;

            for (let face = 0; face < this.numberOfFaces; face++) {
                const imageOffset = this.baseOffset + dataOffset;
                if (imageOffset > this.arrayBuffer.byteLength - imageSize) {
                    throw new RangeError(
                        `KTX mip level ${String(level)} face ${String(face)} data is truncated.`
                    );
                }
                const data = new Uint8Array(this.arrayBuffer, imageOffset, imageSize);
                mipmaps.push({ data, width, height });
                dataOffset += imageSize;
                const padding = (4 - (imageSize % 4)) % 4;
                if (this.baseOffset + dataOffset > this.arrayBuffer.byteLength - padding) {
                    throw new RangeError(
                        `KTX mip level ${String(level)} face ${String(face)} padding is truncated.`
                    );
                }
                dataOffset += padding;
            }
            width = Math.max(1, Math.floor(width / 2));
            height = Math.max(1, Math.floor(height / 2));
        }
        return mipmaps;
    }
}

const KTX_TEXTURE_OPTION_KEYS = [
    'isImageCanRelease',
    'magFilter',
    'minFilter',
    'wrapS',
    'wrapT',
    'name',
    'uv',
    'anisotropic'
] as const satisfies readonly (keyof LoaderTextureOptions<Uint8Array>)[];

/** KTX-safe lifecycle, metadata and sampler options. Texel layout remains container-owned. */
export type KTXTextureOptions = Pick<
    LoaderTextureOptions<Uint8Array>,
    | 'isImageCanRelease'
    | 'magFilter'
    | 'minFilter'
    | 'wrapS'
    | 'wrapT'
    | 'name'
    | 'uv'
    | 'anisotropic'
>;

export type KTXLoadRequest = Omit<LoaderRequest, 'src'> &
    KTXTextureOptions & { src: string | ArrayBuffer | ArrayBufferView };

const KTX_REQUEST_KEYS = new Set<PropertyKey>([
    'src',
    'type',
    'defaultType',
    'crossOrigin',
    ...KTX_TEXTURE_OPTION_KEYS
]);

function validateKTXRequestOptions(request: KTXLoadRequest): void {
    for (const key of Reflect.ownKeys(request)) {
        if (!KTX_REQUEST_KEYS.has(key)) {
            throw new TypeError(
                `KTXLoader does not accept option ${String(key)}; container metadata is authoritative.`
            );
        }
    }
    if (request.type !== undefined && typeof request.type !== 'string') {
        throw new TypeError('KTX loader routing type must be a string.');
    }
    if (request.defaultType !== undefined && typeof request.defaultType !== 'string') {
        throw new TypeError('KTX loader default type must be a string.');
    }
}

function ktxTextureOptions(source: KTXTextureOptions): KTXTextureOptions {
    return {
        ...(source.isImageCanRelease !== undefined
            ? { isImageCanRelease: source.isImageCanRelease }
            : {}),
        ...(source.magFilter !== undefined ? { magFilter: source.magFilter } : {}),
        ...(source.minFilter !== undefined ? { minFilter: source.minFilter } : {}),
        ...(source.wrapS !== undefined ? { wrapS: source.wrapS } : {}),
        ...(source.wrapT !== undefined ? { wrapT: source.wrapT } : {}),
        ...(source.name !== undefined ? { name: source.name } : {}),
        ...(source.uv !== undefined ? { uv: source.uv } : {}),
        ...(source.anisotropic !== undefined ? { anisotropic: source.anisotropic } : {})
    };
}

function isKTXLoadRequest(request: KTXLoadRequest | LoaderRequest): request is KTXLoadRequest {
    return (
        typeof request.src === 'string' ||
        request.src instanceof ArrayBuffer ||
        ArrayBuffer.isView(request.src)
    );
}

class KTXLoader {
    static readonly astc = 'WEBGL_compressed_texture_astc';
    static readonly atc = 'WEBGL_compressed_texture_atc';
    static readonly etc = 'WEBGL_compressed_texture_etc';
    static readonly etc1 = 'WEBGL_compressed_texture_etc1';
    static readonly pvrtc = 'WEBGL_compressed_texture_pvrtc';
    static readonly s3tc = 'WEBGL_compressed_texture_s3tc';
    static readonly s3tcSrgb = 'WEBGL_compressed_texture_s3tc_srgb';

    readonly isKTXLoader = true;
    readonly className = 'KTXLoader';
    private readonly resourceLoader = new BasicLoader();

    async load(params: KTXLoadRequest | LoaderRequest): Promise<Texture<Uint8Array>> {
        if (!isKTXLoadRequest(params)) {
            throw new TypeError('KTXLoader requires a URL or binary source.');
        }
        validateKTXRequestOptions(params);
        if (params.src instanceof ArrayBuffer) return this.createTexture(params, params.src);
        if (ArrayBuffer.isView(params.src)) {
            const bytes = new Uint8Array(
                params.src.buffer,
                params.src.byteOffset,
                params.src.byteLength
            );
            return this.createTexture(params, Uint8Array.from(bytes).buffer);
        }
        const resource = await this.resourceLoader.loadRes(params.src, BasicLoader.TYPE_BUFFER);
        if (!(resource instanceof ArrayBuffer)) {
            throw new TypeError(`KTX resource ${params.src} did not return binary data.`);
        }
        return this.createTexture(params, resource);
    }

    createTexture(
        params: KTXLoadRequest,
        buffer: ArrayBuffer,
        baseOffset = 0
    ): Texture<Uint8Array> {
        validateKTXRequestOptions(params);
        const ktx = new KhronosTextureContainer(buffer, 1, baseOffset);
        const fullMipCount = Math.floor(Math.log2(Math.max(ktx.pixelWidth, ktx.pixelHeight))) + 1;
        if (ktx.numberOfMipmapLevels > fullMipCount) {
            throw new RangeError(
                `KTX mipmap chain has ${String(ktx.numberOfMipmapLevels)} levels; ${String(fullMipCount)} is the maximum for ${String(ktx.pixelWidth)}x${String(ktx.pixelHeight)}`
            );
        }
        const mipmaps = ktx.mipmaps(true);
        const firstLevel = mipmaps[0];
        if (!firstLevel) throw new TypeError('KTX texture does not contain an image level.');

        return new Texture<Uint8Array>({
            ...ktxTextureOptions(params),
            compressed: ktx.loadType === KhronosTextureContainer.COMPRESSED_2D,
            type: ktx.glType,
            width: ktx.pixelWidth,
            height: ktx.pixelHeight,
            internalFormat: ktx.glInternalFormat,
            format: ktx.glFormat,
            mipmaps,
            image: firstLevel.data
        });
    }
}

Loader.addLoader('ktx', KTXLoader);

export { KhronosTextureContainer };
export default KTXLoader;
