import BasicLoader, { type LoaderRequest } from './BasicLoader';
import Loader from './Loader';
import Texture from '../texture/Texture';
import extensions from '../renderer/extensions';
import { textureOptions, type LoaderTextureOptions } from './textureOptions';

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

    constructor(arrayBuffer: ArrayBuffer, facesExpected: 1 | 6, baseOffset = 0) {
        this.arrayBuffer = arrayBuffer;
        this.baseOffset = baseOffset;
        const identifier = new Uint8Array(arrayBuffer, baseOffset, KTX_IDENTIFIER.length);
        if (!identifier.every((byte, index) => byte === KTX_IDENTIFIER[index])) {
            throw new TypeError('Texture is missing the KTX 1.1 identifier.');
        }

        const dataSize = Uint32Array.BYTES_PER_ELEMENT;
        const header = new DataView(arrayBuffer, baseOffset + 12, 13 * dataSize);
        const littleEndian = header.getUint32(0, true) === 0x04030201;
        this.glType = header.getUint32(dataSize, littleEndian);
        this.glTypeSize = header.getUint32(2 * dataSize, littleEndian);
        this.glFormat = header.getUint32(3 * dataSize, littleEndian);
        this.glInternalFormat = header.getUint32(4 * dataSize, littleEndian);
        this.glBaseInternalFormat = header.getUint32(5 * dataSize, littleEndian);
        this.pixelWidth = header.getUint32(6 * dataSize, littleEndian);
        this.pixelHeight = header.getUint32(7 * dataSize, littleEndian);
        this.pixelDepth = header.getUint32(8 * dataSize, littleEndian);
        this.numberOfArrayElements = header.getUint32(9 * dataSize, littleEndian);
        this.numberOfFaces = header.getUint32(10 * dataSize, littleEndian);
        this.numberOfMipmapLevels = Math.max(1, header.getUint32(11 * dataSize, littleEndian));
        this.bytesOfKeyValueData = header.getUint32(12 * dataSize, littleEndian);

        if (this.pixelHeight === 0 || this.pixelDepth !== 0) {
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
            const imageSize = new DataView(
                this.arrayBuffer,
                this.baseOffset + dataOffset,
                Int32Array.BYTES_PER_ELEMENT
            ).getInt32(0, true);
            if (imageSize <= 0) {
                throw new RangeError(`Invalid KTX mip level ${String(level)} size.`);
            }

            for (let face = 0; face < this.numberOfFaces; face++) {
                const data = new Uint8Array(
                    this.arrayBuffer,
                    this.baseOffset + dataOffset + 4,
                    imageSize
                );
                mipmaps.push({ data, width, height });
                dataOffset += imageSize + 4;
                dataOffset += 3 - ((imageSize + 3) % 4);
            }
            width = Math.max(1, Math.floor(width / 2));
            height = Math.max(1, Math.floor(height / 2));
        }
        return mipmaps;
    }
}

export type KTXLoadRequest = Omit<LoaderRequest, 'src'> &
    LoaderTextureOptions<Uint8Array> & { src: string | ArrayBuffer | ArrayBufferView };

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

    constructor() {
        for (const extension of [
            KTXLoader.astc,
            KTXLoader.atc,
            KTXLoader.etc,
            KTXLoader.etc1,
            KTXLoader.pvrtc,
            KTXLoader.s3tc,
            KTXLoader.s3tcSrgb
        ]) {
            extensions.use(extension);
        }
    }

    async load(params: KTXLoadRequest | LoaderRequest): Promise<Texture<Uint8Array>> {
        if (!isKTXLoadRequest(params)) {
            throw new TypeError('KTXLoader requires a URL or binary source.');
        }
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
        const ktx = new KhronosTextureContainer(buffer, 1, baseOffset);
        const fullMipCount = Math.floor(Math.log2(Math.max(ktx.pixelWidth, ktx.pixelHeight))) + 1;
        const mipmaps = ktx.mipmaps(ktx.numberOfMipmapLevels >= fullMipCount);
        const firstLevel = mipmaps[0];
        if (!firstLevel) throw new TypeError('KTX texture does not contain an image level.');

        return new Texture<Uint8Array>({
            compressed: ktx.loadType === KhronosTextureContainer.COMPRESSED_2D,
            type: ktx.glType,
            width: ktx.pixelWidth,
            height: ktx.pixelHeight,
            internalFormat: ktx.glInternalFormat,
            format: ktx.glFormat,
            mipmaps: ktx.numberOfMipmapLevels >= fullMipCount ? mipmaps : null,
            image: firstLevel.data,
            ...textureOptions(params)
        });
    }
}

Loader.addLoader('ktx', KTXLoader);

export { KhronosTextureContainer };
export default KTXLoader;
