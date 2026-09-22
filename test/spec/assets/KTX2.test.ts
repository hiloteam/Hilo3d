import { describe, expect, it } from 'vitest';
import { WorkerTextureDecoder, type TextureAssetSource } from '@hilo/addon-assets';
import {
    inspectKTX2,
    selectTextureFormat,
    textureByteLength
} from '../../../addon-assets/src/KTX2';

const metadata = (codec: string, byteLength: number): TextureAssetSource => ({
    id: codec,
    version: '1',
    url: `/test/asset/ktx2/${codec}.ktx2`,
    byteLength,
    width: 40,
    height: 40,
    mipLevelCount: 6
});
describe('real KTX2/Basis workers', () => {
    it('uses RGBA for compressed suffixes whose new base mip is not block aligned', async () => {
        const data = await (await fetch('/test/asset/ktx2/etc1s.ktx2')).arrayBuffer();
        const source = metadata('etc1s', data.byteLength);
        const capabilities = { astc: true, bc: true, etc2: true };
        expect(selectTextureFormat(capabilities, source, 0)).toBe('astc');
        expect(selectTextureFormat(capabilities, source, 1)).toBe('astc');
        for (const mip of [2, 3, 4, 5])
            expect(selectTextureFormat(capabilities, source, mip)).toBe('rgba8');
        const decoder = new WorkerTextureDecoder(1);
        try {
            const result = await decoder.decode(
                { data, source, mipLevel: 5, capabilities },
                new AbortController().signal
            );
            expect(result.format).toBe('rgba8');
            expect(result.mipmaps[0]?.data.length).toBe(4);
        } finally {
            decoder.destroy();
        }
    });

    for (const codec of ['etc1s', 'uastc', 'uastc-zstd']) {
        it(`transcodes ${codec} to every portable family with owned full mip suffixes`, async () => {
            const data = await (await fetch(`/test/asset/ktx2/${codec}.ktx2`)).arrayBuffer();
            const source = metadata(codec, data.byteLength);
            const decoder = new WorkerTextureDecoder(1);
            try {
                for (const format of ['rgba8', 'bc3', 'etc2', 'astc'] as const) {
                    const result = await decoder.decode(
                        {
                            data: data.slice(0),
                            source,
                            mipLevel: 1,
                            capabilities: {
                                astc: format === 'astc',
                                bc: format === 'bc3',
                                etc2: format === 'etc2'
                            }
                        },
                        new AbortController().signal
                    );
                    expect(result.format).toBe(format);
                    expect(result.colorSpace).toBe('srgb');
                    expect(result.mipmaps.map(mip => mip.width)).toEqual([20, 10, 5, 2, 1]);
                    expect(result.mipmaps.reduce((sum, mip) => sum + mip.data.length, 0)).toBe(
                        textureByteLength(source, 1, format)
                    );
                    expect(result.mipmaps[0]?.data.some(value => value !== 0)).toBe(true);
                }
            } finally {
                decoder.destroy();
            }
        });
    }

    it('rejects malformed metadata, overlapping sections and unsupported orientation before WASM', async () => {
        const data = await (await fetch('/test/asset/ktx2/uastc.ktx2')).arrayBuffer();
        const source = metadata('uastc', data.byteLength);
        expect(inspectKTX2(data, source)).toBe('srgb');
        expect(() => inspectKTX2(data, { ...source, width: 41 })).toThrow(/manifest/);
        const corrupt = data.slice(0);
        new DataView(corrupt).setBigUint64(80, 0n, true);
        expect(() => inspectKTX2(corrupt, source)).toThrow(/range/);
        new DataView(corrupt).setUint32(36, 6, true);
        expect(() => inspectKTX2(corrupt, source)).toThrow(/non-cube/);
    });

    it('terminates an aborted worker and permits retry on a fresh worker', async () => {
        const data = await (await fetch('/test/asset/ktx2/etc1s.ktx2')).arrayBuffer();
        const source = metadata('etc1s', data.byteLength),
            decoder = new WorkerTextureDecoder(1);
        try {
            const controller = new AbortController();
            const pending = decoder.decode(
                {
                    data: data.slice(0),
                    source,
                    mipLevel: 0,
                    capabilities: { astc: false, bc: false, etc2: false }
                },
                controller.signal
            );
            controller.abort();
            await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
            const retry = await decoder.decode(
                {
                    data: data.slice(0),
                    source,
                    mipLevel: 0,
                    capabilities: { astc: false, bc: false, etc2: false }
                },
                new AbortController().signal
            );
            expect(Array.from(retry.mipmaps[0]?.data.slice(0, 4) ?? [])).toEqual([
                181, 148, 16, 255
            ]);
        } finally {
            decoder.destroy();
        }
    });
});
