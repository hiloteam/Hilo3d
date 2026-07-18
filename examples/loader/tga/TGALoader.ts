import BasicLoader, { type LoaderRequest } from '../../../src/loader/BasicLoader';
import Loader from '../../../src/loader/Loader';
import DataTexture from '../../../src/texture/DataTexture';
import { RGBA, UNSIGNED_BYTE } from '../../../src/constants/webgl';
import { RGBA8 } from '../../../src/constants/webgl2';

const TGA_HEADER_SIZE = 18;
const TRUE_COLOR = 2;
const RLE_TRUE_COLOR = 10;

export interface TGAHeader {
    readonly idLength: number;
    readonly colorMapType: number;
    readonly dataTypeCode: number;
    readonly colorMapOrigin: number;
    readonly colorMapLength: number;
    readonly colorMapDepth: number;
    readonly xOrigin: number;
    readonly yOrigin: number;
    readonly width: number;
    readonly height: number;
    readonly bitsPerPixel: 16 | 24 | 32;
    readonly bytesPerPixel: 2 | 3 | 4;
    readonly imageDescriptor: number;
}

function requireByte(data: Uint8Array, index: number, label: string): number {
    const value = data[index];
    if (value === undefined) throw new RangeError(`TGA ${label} exceeds the source buffer.`);
    return value;
}

function expandFiveBits(value: number): number {
    return (value << 3) | (value >> 2);
}

/** Strict true-color TGA decoder backed by the project's standard resource transport. */
class TGALoader {
    readonly isTGALoader = true;
    readonly className = 'TGALoader';
    private readonly transport: BasicLoader;

    constructor(transport: BasicLoader = new BasicLoader()) {
        this.transport = transport;
    }

    async load(params: LoaderRequest): Promise<DataTexture> {
        if (!params.src) throw new TypeError('TGALoader requires a source URL.');
        const resource = await this.transport.loadRes(params.src, BasicLoader.TYPE_BUFFER);
        if (!(resource instanceof ArrayBuffer)) {
            throw new TypeError('TGA source did not resolve to an ArrayBuffer.');
        }
        const header = this.readHeader(resource);
        const pixels = this.readPixels(header, resource);
        return this.createTexture(header, pixels);
    }

    readHeader(buffer: ArrayBuffer): TGAHeader {
        if (buffer.byteLength < TGA_HEADER_SIZE) throw new RangeError('TGA header is truncated.');
        const view = new DataView(buffer, 0, TGA_HEADER_SIZE);
        const bitsPerPixel = view.getUint8(16);
        if (bitsPerPixel !== 16 && bitsPerPixel !== 24 && bitsPerPixel !== 32) {
            throw new RangeError('TGALoader supports only 16, 24 and 32-bit true-color images.');
        }
        const bytesPerPixel = bitsPerPixel / 8;
        if (bytesPerPixel !== 2 && bytesPerPixel !== 3 && bytesPerPixel !== 4) {
            throw new RangeError('TGA pixel size is unsupported.');
        }
        const header: TGAHeader = {
            idLength: view.getUint8(0),
            colorMapType: view.getUint8(1),
            dataTypeCode: view.getUint8(2),
            colorMapOrigin: view.getUint16(3, true),
            colorMapLength: view.getUint16(5, true),
            colorMapDepth: view.getUint8(7),
            xOrigin: view.getUint16(8, true),
            yOrigin: view.getUint16(10, true),
            width: view.getUint16(12, true),
            height: view.getUint16(14, true),
            bitsPerPixel,
            bytesPerPixel,
            imageDescriptor: view.getUint8(17)
        };
        this.validateHeader(header);
        return header;
    }

    private validateHeader(header: TGAHeader): void {
        if (header.dataTypeCode !== TRUE_COLOR && header.dataTypeCode !== RLE_TRUE_COLOR) {
            throw new RangeError('TGALoader supports only true-color image types 2 and 10.');
        }
        if (header.colorMapType !== 0) {
            throw new RangeError('Color-mapped TGA images are not supported.');
        }
        if (header.width <= 0 || header.height <= 0) {
            throw new RangeError('TGA dimensions must be greater than zero.');
        }
        if ((header.imageDescriptor & 0x0f) > header.bitsPerPixel) {
            throw new RangeError('TGA attribute bit count exceeds its pixel depth.');
        }
    }

    private writePixel(
        source: Uint8Array,
        sourceOffset: number,
        header: TGAHeader,
        destination: Uint8Array,
        filePixelIndex: number
    ): void {
        if (sourceOffset + header.bytesPerPixel > source.length) {
            throw new RangeError('TGA pixel data is truncated.');
        }
        const fileColumn = filePixelIndex % header.width;
        const fileRow = Math.floor(filePixelIndex / header.width);
        const rightToLeft = (header.imageDescriptor & 0x10) !== 0;
        const column = rightToLeft ? header.width - 1 - fileColumn : fileColumn;
        const destinationOffset = (fileRow * header.width + column) * 4;

        const blue = requireByte(source, sourceOffset, 'blue channel');
        const greenOrHigh = requireByte(source, sourceOffset + 1, 'green channel');
        if (header.bytesPerPixel === 2) {
            destination[destinationOffset] = expandFiveBits((greenOrHigh & 0x7c) >> 2);
            destination[destinationOffset + 1] = expandFiveBits(
                ((greenOrHigh & 0x03) << 3) | (blue >> 5)
            );
            destination[destinationOffset + 2] = expandFiveBits(blue & 0x1f);
            destination[destinationOffset + 3] = (greenOrHigh & 0x80) === 0 ? 0 : 255;
            return;
        }

        destination[destinationOffset] = requireByte(source, sourceOffset + 2, 'red channel');
        destination[destinationOffset + 1] = greenOrHigh;
        destination[destinationOffset + 2] = blue;
        destination[destinationOffset + 3] =
            header.bytesPerPixel === 4
                ? requireByte(source, sourceOffset + 3, 'alpha channel')
                : 255;
    }

    readPixels(header: TGAHeader, buffer: ArrayBuffer): Uint8Array {
        const source = new Uint8Array(buffer);
        const pixelCount = header.width * header.height;
        if (!Number.isSafeInteger(pixelCount) || pixelCount <= 0) {
            throw new RangeError('TGA pixel count is invalid.');
        }
        const pixels = new Uint8Array(pixelCount * 4);
        let sourceOffset = TGA_HEADER_SIZE + header.idLength;
        if (sourceOffset > source.length)
            throw new RangeError('TGA image ID exceeds the source buffer.');

        if (header.dataTypeCode === TRUE_COLOR) {
            for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
                this.writePixel(source, sourceOffset, header, pixels, pixelIndex);
                sourceOffset += header.bytesPerPixel;
            }
            return pixels;
        }

        let pixelIndex = 0;
        while (pixelIndex < pixelCount) {
            const packetHeader = requireByte(source, sourceOffset, 'RLE packet header');
            sourceOffset++;
            const packetLength = (packetHeader & 0x7f) + 1;
            if (pixelIndex + packetLength > pixelCount) {
                throw new RangeError('TGA RLE packet exceeds the declared image size.');
            }
            const runLengthPacket = (packetHeader & 0x80) !== 0;
            for (let packetIndex = 0; packetIndex < packetLength; packetIndex++) {
                this.writePixel(source, sourceOffset, header, pixels, pixelIndex);
                pixelIndex++;
                if (!runLengthPacket) sourceOffset += header.bytesPerPixel;
            }
            if (runLengthPacket) sourceOffset += header.bytesPerPixel;
        }
        return pixels;
    }

    createTexture(header: TGAHeader, pixels: Uint8Array): DataTexture {
        return new DataTexture({
            width: header.width,
            height: header.height,
            flipY: (header.imageDescriptor & 0x20) === 0,
            image: pixels,
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE
        });
    }
}

Loader.addLoader('tga', TGALoader);

export default TGALoader;
