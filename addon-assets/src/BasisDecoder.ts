import { inspectKTX2, selectTextureFormat } from './KTX2.js';
import type { AssetTextureMipmap, DecodedAssetTexture, TextureDecodeRequest } from './types.js';

type WasmFunction = (...args: number[]) => number;

/** Pinned @h00w 2.1.0 C ABI. The package's JavaScript/Embind loader is deliberately not imported. */
class BasisModule {
    constructor(
        readonly memory: WebAssembly.Memory,
        readonly exports: WebAssembly.Exports
    ) {}

    call(name: string, ...args: number[]): number {
        const value = this.exports[name];
        if (typeof value !== 'function')
            throw new TypeError(`Basis WASM export ${name} is missing.`);
        return (value as WasmFunction)(...args);
    }

    allocate(size: number): number {
        const pointer = this.call('o', size);
        if (pointer === 0 || pointer + size > this.memory.buffer.byteLength)
            throw new RangeError('Basis worker memory budget exhausted.');
        return pointer;
    }
}

/** Strict ESM adapter for the pinned raw C-ABI WASM binary, with bounded memory growth. */
export async function createBasisDecoder(
    wasm: ArrayBuffer,
    maxMemoryBytes: number
): Promise<(request: Readonly<TextureDecodeRequest>) => DecodedAssetTexture> {
    const state: { memory?: WebAssembly.Memory } = {};
    const noop = (): void => {
        /* The numeric C ABI does not use Embind type registrations. */
    };
    const imports: WebAssembly.Imports = {
        a: {
            a: noop,
            b: noop,
            c: noop,
            d: noop,
            e: noop,
            g: noop,
            h: noop,
            k: noop,
            l: noop,
            i: (): never => {
                throw new Error('Basis WASM aborted.');
            },
            f: (_fd: number, iov: number, count: number, written: number): number => {
                const memory = state.memory;
                if (!memory) return 8;
                const view = new DataView(memory.buffer);
                let bytes = 0;
                for (let index = 0; index < count; index++)
                    bytes += view.getUint32(iov + index * 8 + 4, true);
                view.setUint32(written, bytes, true);
                return 0;
            },
            j: (size: number): number => {
                const memory = state.memory;
                if (!memory || size > maxMemoryBytes) return 0;
                try {
                    memory.grow(Math.max(0, Math.ceil((size - memory.buffer.byteLength) / 65536)));
                    return 1;
                } catch {
                    return 0;
                }
            }
        }
    };
    const { instance } = await WebAssembly.instantiate(wasm, imports);
    const exportedMemory = instance.exports['m'];
    if (!(exportedMemory instanceof WebAssembly.Memory))
        throw new TypeError('Invalid Basis WASM memory export.');
    const memory = exportedMemory;
    state.memory = memory;
    if (memory.buffer.byteLength > maxMemoryBytes)
        throw new RangeError('Basis initial memory exceeds the worker budget.');
    const module = new BasisModule(memory, instance.exports);
    module.call('n');
    module.call('q');
    return (request: Readonly<TextureDecodeRequest>): DecodedAssetTexture => {
        const colorSpace = inspectKTX2(request.data, request.source);
        if (
            !Number.isSafeInteger(request.mipLevel) ||
            request.mipLevel < 0 ||
            request.mipLevel >= request.source.mipLevelCount
        )
            throw new RangeError('KTX2 mip demand is outside the authored chain.');
        const format = selectTextureFormat(request.capabilities, request.source, request.mipLevel);
        const target = format === 'astc' ? 10 : format === 'bc3' ? 3 : format === 'etc2' ? 1 : 13;
        const input = module.allocate(request.data.byteLength);
        const transcoder = module.call('B');
        if (transcoder === 0) {
            module.call('p', input);
            throw new RangeError('Basis could not allocate a transcoder.');
        }
        try {
            new Uint8Array(module.memory.buffer).set(new Uint8Array(request.data), input);
            if (
                !module.call('D', transcoder, input, request.data.byteLength) ||
                !module.call('G', transcoder)
            ) {
                throw new TypeError('Basis could not initialize the KTX2 texture.');
            }
            const mipmaps: AssetTextureMipmap[] = [];
            for (let level = request.mipLevel; level < request.source.mipLevelCount; level++) {
                const width = Math.max(1, Math.floor(request.source.width / 2 ** level));
                const height = Math.max(1, Math.floor(request.source.height / 2 ** level));
                const count =
                    format === 'rgba8'
                        ? width * height
                        : Math.ceil(width / 4) * Math.ceil(height / 4);
                const length = count * (format === 'rgba8' ? 4 : 16);
                const output = module.allocate(length);
                try {
                    if (
                        !module.call(
                            'I',
                            transcoder,
                            level,
                            0,
                            0,
                            output,
                            count,
                            target,
                            0,
                            0,
                            0,
                            -1,
                            -1,
                            0
                        )
                    ) {
                        throw new Error(`Basis transcoding failed at mip ${String(level)}.`);
                    }
                    const data = new Uint8Array(length);
                    data.set(new Uint8Array(module.memory.buffer, output, length));
                    mipmaps.push({ width, height, data });
                } finally {
                    module.call('p', output);
                }
            }
            return { format, colorSpace, mipLevel: request.mipLevel, mipmaps };
        } finally {
            module.call('C', transcoder);
            module.call('p', input);
        }
    };
}
