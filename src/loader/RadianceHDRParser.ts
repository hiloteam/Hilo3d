export interface RadianceHDRImage {
    readonly shape: readonly [width: number, height: number];
    readonly exposure: number;
    readonly gamma: number;
    readonly data: Float32Array;
}

type Axis = 'X' | 'Y';
type Direction = '+' | '-';

interface ResolutionAxis {
    axis: Axis;
    direction: Direction;
    length: number;
}

class ByteReader {
    private offset = 0;
    private readonly decoder = new TextDecoder('ascii', { fatal: true });

    constructor(private readonly bytes: Uint8Array) {}

    readByte(description: string): number {
        const value = this.bytes[this.offset];
        if (value === undefined) {
            throw new Error(`Unexpected end of HDR data while reading ${description}.`);
        }
        this.offset++;
        return value;
    }

    readBytes(length: number, description: string): Uint8Array {
        const end = this.offset + length;
        if (!Number.isSafeInteger(end) || end > this.bytes.length) {
            throw new Error(`Unexpected end of HDR data while reading ${description}.`);
        }
        const value = this.bytes.slice(this.offset, end);
        this.offset = end;
        return value;
    }

    readLine(description: string): string {
        const start = this.offset;
        while (this.offset < this.bytes.length && this.bytes[this.offset] !== 0x0a) {
            this.offset++;
        }
        if (this.offset >= this.bytes.length) {
            throw new Error(`Unexpected end of HDR data while reading ${description}.`);
        }

        let end = this.offset;
        this.offset++;
        if (end > start && this.bytes[end - 1] === 0x0d) end--;
        return this.decoder.decode(this.bytes.subarray(start, end));
    }
}

function parsePositiveNumber(value: string, field: string): number {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new Error(`HDR ${field} must be a positive finite number; received ${value}.`);
    }
    return number;
}

function parseResolutionAxis(
    directionValue: string | undefined,
    axisValue: string | undefined,
    lengthValue: string | undefined
): ResolutionAxis {
    if (
        (directionValue !== '+' && directionValue !== '-') ||
        (axisValue !== 'X' && axisValue !== 'Y') ||
        lengthValue === undefined
    ) {
        throw new Error('HDR resolution line is malformed.');
    }
    const length = Number(lengthValue);
    if (!Number.isSafeInteger(length) || length <= 0) {
        throw new Error(`HDR ${axisValue} resolution must be a positive integer.`);
    }
    return { axis: axisValue, direction: directionValue, length };
}

function parseResolution(line: string): readonly [ResolutionAxis, ResolutionAxis] {
    const match = /^([+-])([XY])\s+(\d+)\s+([+-])([XY])\s+(\d+)$/u.exec(line);
    if (!match) throw new Error(`Unsupported HDR resolution line: ${line}`);
    const major = parseResolutionAxis(match[1], match[2], match[3]);
    const minor = parseResolutionAxis(match[4], match[5], match[6]);
    if (major.axis === minor.axis) {
        throw new Error('HDR resolution must describe one X axis and one Y axis.');
    }
    return [major, minor];
}

function byteAt(bytes: Uint8Array, index: number): number {
    const value = bytes[index];
    if (value === undefined) throw new Error('HDR decoder produced an incomplete pixel.');
    return value;
}

function writePixel(target: Uint8Array, index: number, pixel: Uint8Array): void {
    const offset = index * 4;
    target[offset] = byteAt(pixel, 0);
    target[offset + 1] = byteAt(pixel, 1);
    target[offset + 2] = byteAt(pixel, 2);
    target[offset + 3] = byteAt(pixel, 3);
}

function decodeLegacyScanline(
    reader: ByteReader,
    firstPixel: Uint8Array,
    length: number
): Uint8Array {
    const scanline = new Uint8Array(length * 4);
    let pixel = firstPixel;
    let previousPixel: Uint8Array | null = null;
    let pixelIndex = 0;
    let runShift = 0;

    while (pixelIndex < length) {
        const isRun = byteAt(pixel, 0) === 1 && byteAt(pixel, 1) === 1 && byteAt(pixel, 2) === 1;
        if (isRun) {
            if (!previousPixel) throw new Error('HDR legacy RLE starts with a repeat marker.');
            const repeatCount = byteAt(pixel, 3) * Math.pow(2, runShift);
            if (
                !Number.isSafeInteger(repeatCount) ||
                repeatCount <= 0 ||
                pixelIndex + repeatCount > length
            ) {
                throw new Error('HDR legacy RLE repeat exceeds the scanline width.');
            }
            for (let repeat = 0; repeat < repeatCount; repeat++) {
                writePixel(scanline, pixelIndex++, previousPixel);
            }
            runShift += 8;
        } else {
            writePixel(scanline, pixelIndex++, pixel);
            previousPixel = pixel;
            runShift = 0;
        }

        if (pixelIndex < length) pixel = reader.readBytes(4, 'legacy RGBE pixel');
    }

    return scanline;
}

function decodeModernScanline(reader: ByteReader, length: number): Uint8Array {
    const channels = new Uint8Array(length * 4);
    for (let channel = 0; channel < 4; channel++) {
        let output = channel * length;
        const end = output + length;
        while (output < end) {
            const code = reader.readByte('RLE packet');
            if (code === 0) throw new Error('HDR RLE packet has a zero length.');
            if (code > 128) {
                const runLength = code - 128;
                if (output + runLength > end) throw new Error('HDR RLE run exceeds its channel.');
                const value = reader.readByte('RLE run value');
                channels.fill(value, output, output + runLength);
                output += runLength;
            } else {
                if (output + code > end) throw new Error('HDR RLE literal exceeds its channel.');
                channels.set(reader.readBytes(code, 'RLE literal'), output);
                output += code;
            }
        }
    }

    const scanline = new Uint8Array(length * 4);
    for (let pixel = 0; pixel < length; pixel++) {
        const offset = pixel * 4;
        scanline[offset] = byteAt(channels, pixel);
        scanline[offset + 1] = byteAt(channels, length + pixel);
        scanline[offset + 2] = byteAt(channels, length * 2 + pixel);
        scanline[offset + 3] = byteAt(channels, length * 3 + pixel);
    }
    return scanline;
}

function decodeScanline(reader: ByteReader, length: number): Uint8Array {
    const firstPixel = reader.readBytes(4, 'scanline header');
    const hasModernHeader =
        length >= 8 &&
        length <= 0x7fff &&
        byteAt(firstPixel, 0) === 2 &&
        byteAt(firstPixel, 1) === 2 &&
        (byteAt(firstPixel, 2) & 0x80) === 0;
    if (!hasModernHeader) return decodeLegacyScanline(reader, firstPixel, length);

    const encodedLength = (byteAt(firstPixel, 2) << 8) | byteAt(firstPixel, 3);
    if (encodedLength !== length) {
        throw new Error(
            `HDR RLE scanline width ${String(encodedLength)} does not match ${String(length)}.`
        );
    }
    return decodeModernScanline(reader, length);
}

function coordinate(axis: ResolutionAxis, index: number, width: number, height: number): number {
    if (axis.axis === 'X') return axis.direction === '+' ? index : width - index - 1;
    return axis.direction === '-' ? index : height - index - 1;
}

/** Parse a Radiance RGBE image without legacy CommonJS parser dependencies. */
export function parseRadianceHDR(input: ArrayBuffer | Uint8Array): RadianceHDRImage {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const reader = new ByteReader(bytes);
    const signature = reader.readLine('signature');
    if (signature !== '#?RADIANCE' && signature !== '#?RGBE') {
        throw new Error(`Unsupported HDR signature: ${signature}`);
    }

    let exposure = 1;
    let gamma = 1;
    let formatFound = false;
    for (;;) {
        const line = reader.readLine('header');
        if (line.length === 0) break;
        if (line.startsWith('#')) continue;
        const separator = line.indexOf('=');
        if (separator < 0) continue;
        const field = line.slice(0, separator).trim().toUpperCase();
        const value = line.slice(separator + 1).trim();
        if (field === 'FORMAT') {
            if (value !== '32-bit_rle_rgbe') throw new Error(`Unsupported HDR format: ${value}`);
            formatFound = true;
        } else if (field === 'EXPOSURE') {
            exposure *= parsePositiveNumber(value, 'exposure');
        } else if (field === 'GAMMA') {
            gamma = parsePositiveNumber(value, 'gamma');
        }
    }
    if (!formatFound) throw new Error('HDR header is missing FORMAT=32-bit_rle_rgbe.');

    const [majorAxis, minorAxis] = parseResolution(reader.readLine('resolution'));
    const width = majorAxis.axis === 'X' ? majorAxis.length : minorAxis.length;
    const height = majorAxis.axis === 'Y' ? majorAxis.length : minorAxis.length;
    const pixelCount = width * height;
    if (!Number.isSafeInteger(pixelCount) || pixelCount > 0x3fffffff) {
        throw new RangeError(`HDR dimensions ${String(width)}x${String(height)} are too large.`);
    }

    const data = new Float32Array(pixelCount * 4);
    for (let majorIndex = 0; majorIndex < majorAxis.length; majorIndex++) {
        const scanline = decodeScanline(reader, minorAxis.length);
        for (let minorIndex = 0; minorIndex < minorAxis.length; minorIndex++) {
            const majorCoordinate = coordinate(majorAxis, majorIndex, width, height);
            const minorCoordinate = coordinate(minorAxis, minorIndex, width, height);
            const x = majorAxis.axis === 'X' ? majorCoordinate : minorCoordinate;
            const y = majorAxis.axis === 'Y' ? majorCoordinate : minorCoordinate;
            const sourceOffset = minorIndex * 4;
            const destinationOffset = (y * width + x) * 4;
            const exponent = byteAt(scanline, sourceOffset + 3);
            if (exponent === 0) {
                data[destinationOffset] = 0;
                data[destinationOffset + 1] = 0;
                data[destinationOffset + 2] = 0;
            } else {
                const scale = Math.pow(2, exponent - 136);
                data[destinationOffset] = byteAt(scanline, sourceOffset) * scale;
                data[destinationOffset + 1] = byteAt(scanline, sourceOffset + 1) * scale;
                data[destinationOffset + 2] = byteAt(scanline, sourceOffset + 2) * scale;
            }
            data[destinationOffset + 3] = 1;
        }
    }

    return { shape: [width, height], exposure, gamma, data };
}

export default parseRadianceHDR;
