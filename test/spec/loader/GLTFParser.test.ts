import { describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import type { GLTFResourceLoader } from '../../../src/loader/GLTFLoader';
import LazyTexture from '../../../src/texture/LazyTexture';

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

    it('loads glTF images with the standard browser color-management path', async () => {
        const load = vi.spyOn(LazyTexture.prototype, 'load').mockResolvedValue(undefined);
        try {
            const parser = new GLTFParser('', { isLoadAllTextures: true });
            parser.json = {
                asset: { version: '2.0' },
                images: [{ uri: 'base-color.png' }],
                textures: [{ source: 0 }]
            };

            await parser.loadTextures();

            const texture = parser.textures['0'];
            expect(texture).toBeInstanceOf(LazyTexture);
            expect(texture).not.toHaveProperty('colorSpaceConversion');
            expect(load).toHaveBeenCalledOnce();
        } finally {
            load.mockRestore();
        }
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

        expect(model.prefab.roots).toEqual([]);
        expect(model.meshCount).toBe(0);
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

    it('parses the modern layered PBR material extensions and their textures', () => {
        const parser = new GLTFParser();
        parser.isGLTF2 = true;
        parser.json = {
            asset: { version: '2.0' },
            textures: Array.from({ length: 8 }, () => ({ source: 0 })),
            materials: [
                {
                    extensions: {
                        KHR_materials_clearcoat: {
                            clearcoatFactor: 0.85,
                            clearcoatTexture: { index: 0 },
                            clearcoatRoughnessFactor: 0.22,
                            clearcoatRoughnessTexture: { index: 1 },
                            clearcoatNormalTexture: { index: 2, texCoord: 1, scale: 0.65 }
                        },
                        KHR_materials_anisotropy: {
                            anisotropyStrength: 0.72,
                            anisotropyRotation: 0.3,
                            anisotropyTexture: { index: 3, texCoord: 1 }
                        },
                        KHR_materials_transmission: {
                            transmissionFactor: 0.9,
                            transmissionTexture: { index: 4 }
                        },
                        KHR_materials_volume: {
                            thicknessFactor: 0.4,
                            thicknessTexture: { index: 5, texCoord: 1 },
                            attenuationDistance: 2.5,
                            attenuationColor: [0.8, 0.9, 1]
                        },
                        KHR_materials_ior: {
                            ior: 1.42
                        },
                        KHR_materials_iridescence: {
                            iridescenceFactor: 0.93,
                            iridescenceTexture: { index: 6, texCoord: 1 },
                            iridescenceIor: 1.33,
                            iridescenceThicknessMinimum: 180,
                            iridescenceThicknessMaximum: 620,
                            iridescenceThicknessTexture: { index: 7 }
                        }
                    }
                }
            ]
        };
        for (let index = 0; index < 8; index += 1) {
            parser.textures[String(index)] = new Hilo3d.Texture();
        }

        expect(parser.getUsedTextureNameMap()).toEqual({
            '0': true,
            '1': true,
            '2': true,
            '3': true,
            '4': true,
            '5': true,
            '6': true,
            '7': true
        });
        parser.parseMaterials();

        const material = parser.materials['0'];
        expect(material).toBeInstanceOf(Hilo3d.PBRMaterial);
        if (!(material instanceof Hilo3d.PBRMaterial)) {
            throw new TypeError('Expected a PBR material');
        }
        expect(material).toMatchObject({
            clearcoatFactor: 0.85,
            clearcoatRoughnessFactor: 0.22,
            clearcoatNormalScale: 0.65,
            anisotropyStrength: 0.72,
            anisotropyRotation: 0.3,
            transmissionFactor: 0.9,
            thicknessFactor: 0.4,
            attenuationDistance: 2.5,
            ior: 1.42,
            iridescenceFactor: 0.93,
            iridescenceIor: 1.33,
            iridescenceThicknessMinimum: 180,
            iridescenceThicknessMaximum: 620
        });
        expect(material.isTransparent).toBe(false);
        expect(material.forwardQueue).toBe('transparent');
        expect(material.attenuationColor.r).toBeCloseTo(0.8);
        expect(material.attenuationColor.g).toBeCloseTo(0.9);
        expect(material.attenuationColor.b).toBe(1);
        expect(material.clearcoatNormalMap?.uv).toBe(1);
        expect(material.anisotropyMap?.uv).toBe(1);
        expect(material.thicknessMap?.uv).toBe(1);
        expect(material.iridescenceMap?.uv).toBe(1);
        expect(material.iridescenceThicknessMap).toBe(parser.textures['7']);
    });

    it('rejects out-of-range modern PBR extension factors', () => {
        const parser = new GLTFParser();
        parser.isGLTF2 = true;
        parser.json = {
            asset: { version: '2.0' },
            materials: [
                {
                    extensions: {
                        KHR_materials_transmission: {
                            transmissionFactor: 1.1
                        }
                    }
                }
            ]
        };

        expect(() => {
            parser.parseMaterials();
        }).toThrow('KHR_materials_transmission.transmissionFactor must be in [0, 1].');
    });

    it('rejects an invalid iridescence thin-film IOR', () => {
        const parser = new GLTFParser();
        parser.isGLTF2 = true;
        parser.json = {
            asset: { version: '2.0' },
            materials: [
                {
                    extensions: {
                        KHR_materials_iridescence: {
                            iridescenceIor: 0.9
                        }
                    }
                }
            ]
        };

        expect(() => {
            parser.parseMaterials();
        }).toThrow('KHR_materials_iridescence.iridescenceIor must be in [1, Infinity].');
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

    it('normalizes indexed glTF TRIANGLE_FAN primitives before exposing geometry', () => {
        const buffer = new ArrayBuffer(52);
        new Float32Array(buffer, 0, 12).set([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
        new Uint8Array(buffer, 48, 4).set([0, 1, 2, 3]);
        const parser = new GLTFParser();
        parser.isUnQuantizeInShader = false;
        parser.json = {
            asset: { version: '2.0' },
            buffers: [{ byteLength: buffer.byteLength }],
            bufferViews: [
                { buffer: 0, byteLength: 48 },
                { buffer: 0, byteOffset: 48, byteLength: 4 }
            ],
            accessors: [
                { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' },
                { bufferView: 1, componentType: 5121, count: 4, type: 'SCALAR' }
            ]
        };
        parser.buffers = { '0': buffer };
        parser.parseBufferViews();

        const geometry = parser.handlerGeometry(undefined, {
            mode: Hilo3d.constants.TRIANGLE_FAN,
            indices: 1,
            attributes: { POSITION: 0 }
        });

        expect(geometry).not.toBeInstanceOf(Promise);
        if (geometry instanceof Promise)
            throw new Error('Fixture unexpectedly parsed asynchronously');
        expect(geometry.mode).toBe(Hilo3d.constants.TRIANGLES);
        expect(geometry.indices?.data).toBeInstanceOf(Uint8Array);
        expect(Array.from(geometry.indices?.data ?? [])).toEqual([0, 1, 2, 0, 2, 3]);
        expect(geometry.vertices?.count).toBe(4);
        expect(geometry.getLocalBounds()).toMatchObject({
            xMin: -1,
            xMax: 1,
            yMin: -1,
            yMax: 1
        });
    });

    it('normalizes non-indexed glTF LINE_LOOP primitives into explicit line indices', () => {
        const buffer = new Float32Array([-1, 0, 0, 0, 1, 0, 1, 0, 0]).buffer;
        const parser = new GLTFParser();
        parser.isUnQuantizeInShader = false;
        parser.json = {
            asset: { version: '2.0' },
            buffers: [{ byteLength: buffer.byteLength }],
            bufferViews: [{ buffer: 0, byteLength: buffer.byteLength }],
            accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }]
        };
        parser.buffers = { '0': buffer };
        parser.parseBufferViews();

        const geometry = parser.handlerGeometry(undefined, {
            mode: Hilo3d.constants.LINE_LOOP,
            attributes: { POSITION: 0 }
        });

        expect(geometry).not.toBeInstanceOf(Promise);
        if (geometry instanceof Promise)
            throw new Error('Fixture unexpectedly parsed asynchronously');
        expect(geometry.mode).toBe(Hilo3d.constants.LINES);
        expect(geometry.indices?.data).toBeInstanceOf(Uint8Array);
        expect(Array.from(geometry.indices?.data ?? [])).toEqual([0, 1, 1, 2, 2, 0]);
        expect(geometry.vertices?.count).toBe(3);
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
