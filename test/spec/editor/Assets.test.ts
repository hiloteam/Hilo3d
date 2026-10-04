import { describe, expect, it, vi } from 'vitest';
import {
    assetDecodedImageBytes,
    assetHash,
    assetURL,
    importAsset,
    MAX_ASSET_BYTES,
    validateAsset,
    validateProjectAssetDecoding,
    type ProjectAsset
} from '../../../editor/assets';

function makeGLB(json: unknown, binary?: Uint8Array): Uint8Array<ArrayBuffer> {
    const text = new TextEncoder().encode(JSON.stringify(json));
    const jsonLength = Math.ceil(text.length / 4) * 4;
    const binaryLength = binary ? Math.ceil(binary.length / 4) * 4 : 0;
    const output = new Uint8Array(20 + jsonLength + (binary ? 8 + binaryLength : 0));
    const view = new DataView(output.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, output.length, true);
    view.setUint32(12, jsonLength, true);
    view.setUint32(16, 0x4e4f534a, true);
    output.fill(32, 20, 20 + jsonLength);
    output.set(text, 20);
    if (binary) {
        view.setUint32(20 + jsonLength, binaryLength, true);
        view.setUint32(24 + jsonLength, 0x004e4942, true);
        output.set(binary, 28 + jsonLength);
    }
    return output;
}

async function texture(mime = 'image/png', width = 4): Promise<File> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = 3;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    context.fillStyle = '#da7546';
    context.fillRect(0, 0, width, 3);
    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(value => {
            if (value) resolve(value);
            else reject(new Error('Image encoding failed'));
        }, mime);
    });
    const extension = mime === 'image/jpeg' ? 'jpg' : mime.slice(6);
    return new File([blob], `Warm Tile.${extension}`, { type: mime });
}

function fixturePNG(
    chunks: readonly { kind: string; data: Uint8Array }[]
): Uint8Array<ArrayBuffer> {
    const output = new Uint8Array(
        8 + chunks.reduce((sum, chunk) => sum + chunk.data.length + 12, 0)
    );
    output.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(output.buffer);
    let offset = 8;
    for (const chunk of chunks) {
        view.setUint32(offset, chunk.data.length);
        output.set(new TextEncoder().encode(chunk.kind), offset + 4);
        output.set(chunk.data, offset + 8);
        let crc = 0xffffffff;
        for (const byte of output.subarray(offset + 4, offset + 8 + chunk.data.length)) {
            crc ^= byte;
            for (let bit = 0; bit < 8; bit += 1)
                crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
        }
        view.setUint32(offset + 8 + chunk.data.length, (crc ^ 0xffffffff) >>> 0);
        offset += chunk.data.length + 12;
    }
    return output;
}

function pngHeader(): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(13);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 1);
    view.setUint32(4, 1);
    bytes[8] = 8;
    bytes[9] = 6;
    return bytes;
}

function bundled(
    bytes: Uint8Array,
    mimeType: ProjectAsset['mimeType'] = 'image/png'
): ProjectAsset {
    const hash = assetHash(bytes);
    return {
        id: `fixture-${hash.slice(0, 12)}`,
        name: 'Broken fixture',
        kind: mimeType === 'model/gltf-binary' ? 'model' : 'texture',
        mimeType,
        size: bytes.length,
        hash,
        source: {
            fileName: mimeType === 'model/gltf-binary' ? 'Broken.glb' : 'Broken.png',
            importedAt: new Date().toISOString()
        },
        data: btoa(String.fromCharCode(...bytes))
    };
}

describe('editor asset import', () => {
    it('computes standards-compatible SHA-256 across padding boundaries', async () => {
        expect(assetHash(new Uint8Array())).toBe(
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
        );
        expect(assetHash(new TextEncoder().encode('abc'))).toBe(
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
        );
        for (const length of [55, 56, 63, 64, 65, 1024, 100_000]) {
            const bytes = Uint8Array.from({ length }, (_, index) => index % 251);
            const native = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
            expect(assetHash(bytes)).toBe(
                Array.from(native, value => value.toString(16).padStart(2, '0')).join('')
            );
        }
    });

    for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
        it(`decodes and preserves ${mime} textures with content-stable IDs`, async () => {
            const file = await texture(mime);
            const first = await importAsset(file);
            const second = await importAsset(file);
            expect(first.id).toBe(second.id);
            expect(first.id).toMatch(/^warm-tile-[a-f0-9]{12}$/u);
            expect(first.mimeType).toBe(mime);
            expect(first.kind).toBe('texture');
            expect(assetDecodedImageBytes(first)).toBe(4 * 3 * 4);
            expect(validateAsset(first)).toEqual(first);
            const url = assetURL(first);
            try {
                expect(new Uint8Array(await (await fetch(url)).arrayBuffer())).toEqual(
                    new Uint8Array(await file.arrayBuffer())
                );
            } finally {
                URL.revokeObjectURL(url);
            }
        });
    }

    it('preserves GLB bytes and embedded image/buffer resources', async () => {
        const png = new Uint8Array(await (await texture()).arrayBuffer());
        const bytes = makeGLB(
            {
                asset: { version: '2.0' },
                buffers: [{ byteLength: png.length }],
                bufferViews: [{ buffer: 0, byteLength: png.length }],
                images: [{ bufferView: 0, mimeType: 'image/png' }]
            },
            png
        );
        const asset = await importAsset(new File([bytes], '陶土 chair.glb'));
        expect(asset.kind).toBe('model');
        expect(assetDecodedImageBytes(asset)).toBe(4 * 3 * 4);
        expect(asset.hash).toBe(assetHash(bytes));
        expect(asset.id).toMatch(/^chair-[a-f0-9]{12}$/u);
        expect(asset.source.fileName).toBe('陶土 chair.glb');
        const url = assetURL(asset);
        try {
            expect(new Uint8Array(await (await fetch(url)).arrayBuffer())).toEqual(bytes);
        } finally {
            URL.revokeObjectURL(url);
        }
    });

    it('budgets each GLTF texture allocation when samplers reuse the same source image', async () => {
        const png = new Uint8Array(await (await texture()).arrayBuffer());
        const bytes = makeGLB(
            {
                asset: { version: '2.0' },
                buffers: [{ byteLength: png.length }],
                bufferViews: [{ buffer: 0, byteLength: png.length }],
                images: [{ bufferView: 0, mimeType: 'image/png' }],
                textures: [{ source: 0 }, { source: 0 }, { source: 0 }]
            },
            png
        );
        const asset = await importAsset(new File([bytes], 'reused-texture.glb'));
        expect(assetDecodedImageBytes(asset)).toBe(4 * 3 * 4 * 3);
    });

    it('accepts bounded embedded data URIs without introducing network dependencies', async () => {
        const json = {
            asset: { version: '2.0' },
            buffers: [{ byteLength: 4, uri: 'data:application/octet-stream;base64,AQIDBA==' }]
        };
        const asset = await importAsset(new File([makeGLB(json)], 'embedded.glb'));
        expect(asset.kind).toBe('model');
        expect(assetDecodedImageBytes(asset)).toBe(0);
    });

    it('rejects corrupt containers, external resources and out-of-bounds GLB views', async () => {
        const invalidHeader = makeGLB({ asset: { version: '2.0' } });
        invalidHeader[0] = 0;
        await expect(importAsset(new File([invalidHeader], 'broken.glb'))).rejects.toThrow(
            'GLB requires'
        );
        const wrongChunk = makeGLB({ asset: { version: '2.0' } });
        new DataView(wrongChunk.buffer).setUint32(12, 3, true);
        await expect(importAsset(new File([wrongChunk], 'broken.glb'))).rejects.toThrow(
            'chunk size'
        );
        for (const uri of [
            'https://example.com/model.bin',
            '../texture.png',
            'data:text/html;base64,PHNjcmlwdD4=',
            'javascript:alert(1)'
        ]) {
            const bytes = makeGLB({ asset: { version: '2.0' }, images: [{ uri }] });
            await expect(importAsset(new File([bytes], 'external.glb'))).rejects.toThrow(
                'external URI'
            );
        }
        const bytes = makeGLB(
            {
                asset: { version: '2.0' },
                buffers: [{ byteLength: 4 }],
                bufferViews: [{ buffer: 0, byteOffset: 3, byteLength: 4 }]
            },
            new Uint8Array(4)
        );
        await expect(importAsset(new File([bytes], 'range.glb'))).rejects.toThrow(
            'exceeds its buffer'
        );
    });

    it('rejects invalid image bytes and dimensions before allocating large textures', async () => {
        const file = await texture();
        const bytes = new Uint8Array(await file.arrayBuffer());
        await expect(importAsset(new File([bytes], 'mislabeled.jpg'))).rejects.toThrow('JPEG');
        await expect(
            importAsset(new File([bytes.subarray(0, 35)], 'truncated.png'))
        ).rejects.toThrow('PNG');
        new DataView(bytes.buffer).setUint32(16, 20_000);
        await expect(importAsset(new File([bytes], 'oversized.png'))).rejects.toThrow('dimensions');
        const embedded = makeGLB(
            {
                asset: { version: '2.0' },
                buffers: [{ byteLength: bytes.length }],
                bufferViews: [{ buffer: 0, byteLength: bytes.length }],
                images: [{ bufferView: 0, mimeType: 'image/png' }]
            },
            bytes
        );
        await expect(importAsset(new File([embedded], 'oversized-embedded.glb'))).rejects.toThrow(
            'dimensions'
        );
    });

    it('detects modified payloads, mismatched sizes, unknown fields and invalid base64', async () => {
        const asset = await importAsset(await texture());
        expect(() => validateAsset({ ...asset, data: `AAAA${asset.data.slice(4)}` })).toThrow(
            'checksum'
        );
        expect(() => validateAsset({ ...asset, size: asset.size + 1 })).toThrow('size mismatch');
        expect(() => validateAsset({ ...asset, data: 'not base64!' })).toThrow('base64');
        expect(() => validateAsset({ ...asset, execute: 'arbitrary' })).toThrow('unknown field');
        expect(() => validateAsset({ ...asset, kind: 'model' })).toThrow('kind');
        expect(() => validateAsset({ ...asset, id: 'constructor' })).toThrow('Asset ID');
        expect(() =>
            validateAsset({
                ...asset,
                source: { ...asset.source, importedAt: '2026-02-31T00:00:00.000Z' }
            })
        ).toThrow('timestamp');
    });

    it('memoizes immutable payloads without trusting mutable asset metadata or object identity', async () => {
        const asset = await importAsset(await texture());
        const original = structuredClone(asset);
        expect(validateAsset(asset)).toEqual(original);
        expect(validateAsset({ ...asset, name: 'Renamed safely' }).name).toBe('Renamed safely');
        asset.data = `AAAA${asset.data.slice(4)}`;
        expect(() => validateAsset(asset)).toThrow('checksum');
        expect(validateAsset(original)).toEqual(original);
        expect(() => validateAsset({ ...original, mimeType: 'image/jpeg' })).toThrow('JPEG');
        expect(() => validateAsset({ ...original, size: 0 })).toThrow('size mismatch');
        expect(() =>
            validateAsset({
                ...original,
                source: { ...original.source, url: 'https://example.com' }
            })
        ).toThrow('unknown field');
    });

    it('rejects PNG CRC errors, duplicate critical chunks, missing data and invalid chunk order', () => {
        const header = { kind: 'IHDR', data: pngHeader() };
        const image = { kind: 'IDAT', data: Uint8Array.from([120, 1, 7, 0, 0, 0, 0, 0]) };
        const end = { kind: 'IEND', data: new Uint8Array() };
        const crcFailure = fixturePNG([header, image, end]);
        crcFailure[29] = (crcFailure[29] ?? 0) ^ 255;
        expect(() => validateAsset(bundled(crcFailure))).toThrow('CRC');
        expect(() => validateAsset(bundled(fixturePNG([header, header, image, end])))).toThrow(
            'exactly once'
        );
        expect(() => validateAsset(bundled(fixturePNG([header, end])))).toThrow('Incomplete PNG');
        expect(() =>
            validateAsset(
                bundled(
                    fixturePNG([
                        header,
                        image,
                        { kind: 'tEXt', data: new Uint8Array() },
                        image,
                        end
                    ])
                )
            )
        ).toThrow('consecutive');
        expect(() =>
            validateAsset(
                bundled(fixturePNG([header, { kind: 'acTL', data: new Uint8Array(8) }, image, end]))
            )
        ).toThrow('Animated PNG');
    });

    it('stages real image decoding for checksummed corrupt entropy including embedded GLB images', async () => {
        const broken = fixturePNG([
            { kind: 'IHDR', data: pngHeader() },
            { kind: 'IDAT', data: Uint8Array.from([120, 1, 7, 0, 0, 0, 0, 0]) },
            { kind: 'IEND', data: new Uint8Array() }
        ]);
        const image = validateAsset(bundled(broken));
        await expect(validateProjectAssetDecoding({ [image.id]: image })).rejects.toThrow(
            'Unable to decode asset "Broken fixture"'
        );
        const model = validateAsset(
            bundled(
                makeGLB(
                    {
                        asset: { version: '2.0' },
                        buffers: [{ byteLength: broken.length }],
                        bufferViews: [{ buffer: 0, byteLength: broken.length }],
                        images: [{ bufferView: 0, mimeType: 'image/png' }]
                    },
                    broken
                ),
                'model/gltf-binary'
            )
        );
        await expect(validateProjectAssetDecoding({ [model.id]: model })).rejects.toThrow(
            'Unable to decode asset "Broken fixture"'
        );
        // The failed decode queue cannot poison a subsequent, different valid source.
        const file = await texture('image/png', 7);
        const healthy = bundled(new Uint8Array(await file.arrayBuffer()));
        await expect(
            validateProjectAssetDecoding({ [healthy.id]: healthy })
        ).resolves.toBeUndefined();
    });

    it('reuses successful decode verification while detecting mutations before trusting the cache', async () => {
        const asset = await importAsset(await texture('image/png', 9));
        const decoder = vi.spyOn(globalThis, 'createImageBitmap');
        try {
            await validateProjectAssetDecoding({ [asset.id]: asset });
            expect(decoder).not.toHaveBeenCalled();
            asset.data = `AAAA${asset.data.slice(4)}`;
            await expect(validateProjectAssetDecoding({ [asset.id]: asset })).rejects.toThrow(
                'checksum'
            );
            expect(decoder).not.toHaveBeenCalled();
        } finally {
            decoder.mockRestore();
        }
    });

    it('bounds file size and supported formats before reading file data', async () => {
        await expect(importAsset(new File([], 'empty.glb'))).rejects.toThrow('1 byte');
        await expect(
            importAsset(new File([new Uint8Array(MAX_ASSET_BYTES + 1)], 'large.glb'))
        ).rejects.toThrow('16 MiB');
        await expect(importAsset(new File(['<svg/>'], 'script.svg'))).rejects.toThrow(
            'GLB, PNG, JPEG, or WebP'
        );
    });
});
