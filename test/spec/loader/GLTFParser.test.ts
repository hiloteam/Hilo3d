import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import type { GLTFResourceLoader } from '../../../src/loader/GLTFLoader';

const GLTFParser = Hilo3d.GLTFParser;
const unusedLoader: GLTFResourceLoader = {
    loadRes: () => Promise.reject(new Error('This fixture must not load external resources.'))
};

describe('GLTFParser', () => {
    it('create', () => {
        const parser = new GLTFParser('{}', {});
        expect(parser.isGLTFParser).toBe(true);
        expect(parser.className).toBe('GLTFParser');
    });

    it('register & unregister ExtensionHandler', () => {
        const parser = new GLTFParser('{}', {});
        expect(parser.getExtensionHandler('hello')).toBeUndefined();

        const handler = {
            parse: () => undefined
        };
        GLTFParser.registerExtensionHandler('hello', handler);
        expect(parser.getExtensionHandler('hello')).toBe(handler);
        expect(parser.getExtensionHandler('hello2')).toBeUndefined();

        GLTFParser.unregisterExtensionHandler('hello');
        expect(parser.getExtensionHandler('hello')).toBeUndefined();
    });

    it('getImageType', () => {
        const parser = new GLTFParser('{}', {});
        parser.json = {
            asset: { version: '2.0' },
            images: [
                {
                    mimeType: 'image/jpeg'
                },
                {
                    mimeType: 'image/ktx'
                },
                {
                    mimeType: 'image/hdr'
                },
                {}
            ]
        };
        expect(parser.getImageType(0)).toBe('');
        expect(parser.getImageType(1)).toBe('ktx');
        expect(parser.getImageType(2)).toBe('');
        expect(parser.getImageType(3)).toBe('');
        expect(parser.getImageType(4)).toBe('');
    });

    it('parses a minimal glTF scene with an explicit completion contract', async () => {
        const parser = new GLTFParser(
            JSON.stringify({
                asset: { version: '2.0' },
                scene: 0,
                scenes: [{ nodes: [] }]
            })
        );

        const model = await parser.parse(unusedLoader);

        expect(model.scene).toBe(model.node);
        expect(model.meshes).toEqual([]);
        expect(model.resourceErrors).toEqual([]);
        await expect(model.ready).resolves.toBeUndefined();
    });

    it('rejects an unsupported required extension', async () => {
        const parser = new GLTFParser(
            JSON.stringify({
                asset: { version: '2.0' },
                extensionsRequired: ['VENDOR_missing'],
                scenes: [{ nodes: [] }]
            })
        );

        await expect(parser.parse(unusedLoader)).rejects.toThrow(
            'Required glTF extension VENDOR_missing is unsupported.'
        );
    });

    it('decodes interleaved accessors without exposing padding as vertices', () => {
        const buffer = new ArrayBuffer(32);
        const values = new Float32Array(buffer);
        values.set([99, 1, 2, 88, 77, 3, 4, 66]);
        const parser = new GLTFParser();
        parser.json = {
            asset: { version: '2.0' },
            buffers: [{ byteLength: buffer.byteLength }],
            bufferViews: [{ buffer: 0, byteLength: buffer.byteLength, byteStride: 16 }],
            accessors: [
                {
                    bufferView: 0,
                    byteOffset: 4,
                    componentType: 5126,
                    count: 2,
                    type: 'VEC2'
                }
            ]
        };
        parser.buffers = { '0': buffer };
        parser.parseBufferViews();

        expect(parser.getArrayByAccessor(0)).toEqual([
            [1, 2],
            [3, 4]
        ]);
    });

    it('keeps quantized and decoded accessor caches independent', () => {
        const buffer = Uint8Array.from([1, 2, 3]).buffer;
        const parser = new GLTFParser();
        parser.json = {
            asset: { version: '2.0' },
            buffers: [{ byteLength: buffer.byteLength }],
            bufferViews: [{ buffer: 0, byteLength: buffer.byteLength }],
            accessors: [
                {
                    bufferView: 0,
                    componentType: 5121,
                    count: 1,
                    type: 'VEC3',
                    extensions: {
                        WEB3D_quantized_attributes: {
                            decodeMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1]
                        }
                    }
                }
            ]
        };
        parser.buffers = { '0': buffer };
        parser.parseBufferViews();

        expect(Array.from(parser.getAccessorData(0).data)).toEqual([1, 2, 3]);
        expect(Array.from(parser.getAccessorData(0, true).data)).toEqual([11, 22, 33]);
        expect(Array.from(parser.getAccessorData(0).data)).toEqual([1, 2, 3]);
    });

    it('rejects cyclic node graphs instead of recursing indefinitely', async () => {
        const parser = new GLTFParser(
            JSON.stringify({
                asset: { version: '2.0' },
                scene: 0,
                scenes: [{ nodes: [0] }],
                nodes: [{ children: [0] }]
            })
        );

        await expect(parser.parse(unusedLoader)).rejects.toThrow(
            'glTF node graph contains a cycle at 0.'
        );
    });
});
