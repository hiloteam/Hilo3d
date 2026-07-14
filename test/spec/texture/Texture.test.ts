import { describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import {
    BROWSER_DEFAULT_WEBGL,
    CLAMP_TO_EDGE,
    DEPTH_COMPONENT,
    DEPTH_COMPONENT16,
    NEAREST,
    NEAREST_MIPMAP_NEAREST,
    RGB,
    RGBA,
    TEXTURE_2D,
    TEXTURE_CUBE_MAP,
    UNPACK_ALIGNMENT,
    UNPACK_COLORSPACE_CONVERSION_WEBGL,
    UNPACK_FLIP_Y_WEBGL,
    UNSIGNED_BYTE,
    UNSIGNED_SHORT
} from '../../../src/constants/webgl';
import {
    R8I,
    RED_INTEGER,
    RGBA8,
    TEXTURE_2D_ARRAY,
    TEXTURE_3D
} from '../../../src/constants/webgl2';
import { COMPRESSED_RGB_S3TC_DXT1_EXT } from '../../../src/constants/webglExtensions';
import { getTextureRecoveryBacking } from '../../../src/texture/Texture';
import { WebGLTextureManager } from '../../../src/render/internal/webgl2/WebGLTextureManager';
import {
    updateWebGLTexture,
    type WebGLTextureState
} from '../../../src/render/internal/webgl2/WebGLTextureUploader';

const Texture = Hilo3d.Texture;

interface MockTextureContext {
    readonly gl: WebGL2RenderingContext;
    readonly createTexture: ReturnType<typeof vi.fn>;
    readonly deleteTexture: ReturnType<typeof vi.fn>;
    readonly texImage2D: ReturnType<typeof vi.fn>;
    readonly texImage3D: ReturnType<typeof vi.fn>;
    readonly texSubImage2D: ReturnType<typeof vi.fn>;
    readonly texSubImage3D: ReturnType<typeof vi.fn>;
    readonly compressedTexImage3D: ReturnType<typeof vi.fn>;
    readonly compressedTexSubImage2D: ReturnType<typeof vi.fn>;
    readonly compressedTexSubImage3D: ReturnType<typeof vi.fn>;
    readonly generateMipmap: ReturnType<typeof vi.fn>;
}

function createMockTextureContext(): MockTextureContext {
    const createTexture = vi.fn(() => ({}));
    const deleteTexture = vi.fn();
    const texImage2D = vi.fn();
    const texImage3D = vi.fn();
    const texSubImage2D = vi.fn();
    const texSubImage3D = vi.fn();
    const compressedTexImage3D = vi.fn();
    const compressedTexSubImage2D = vi.fn();
    const compressedTexSubImage3D = vi.fn();
    const generateMipmap = vi.fn();
    return {
        gl: {
            TEXTURE0: 0x84c0,
            TEXTURE_MAG_FILTER: 0x2800,
            TEXTURE_MIN_FILTER: 0x2801,
            TEXTURE_WRAP_S: 0x2802,
            TEXTURE_WRAP_T: 0x2803,
            activeTexture: vi.fn(),
            bindTexture: vi.fn(),
            pixelStorei: vi.fn(),
            createTexture,
            deleteTexture,
            texImage2D,
            texImage3D,
            texSubImage2D,
            texSubImage3D,
            compressedTexImage2D: vi.fn(),
            compressedTexImage3D,
            compressedTexSubImage2D,
            compressedTexSubImage3D,
            texParameterf: vi.fn(),
            generateMipmap
        } as unknown as WebGL2RenderingContext,
        createTexture,
        deleteTexture,
        texImage2D,
        texImage3D,
        texSubImage2D,
        texSubImage3D,
        compressedTexImage3D,
        compressedTexSubImage2D,
        compressedTexSubImage3D,
        generateMipmap
    };
}

function createTextureState(
    gl: WebGL2RenderingContext,
    limits: {
        readonly maxTextureSize?: number;
        readonly max3DTextureSize?: number;
        readonly maxArrayTextureLayers?: number;
    } = {}
): WebGLTextureState {
    return {
        gl,
        capabilities: {
            MAX_TEXTURE_SIZE: limits.maxTextureSize ?? 4096,
            MAX_3D_TEXTURE_SIZE: limits.max3DTextureSize ?? 256,
            MAX_ARRAY_TEXTURE_LAYERS: limits.maxArrayTextureLayers ?? 256,
            MAX_TEXTURE_INDEX: 0
        },
        activeTexture: texture => {
            gl.activeTexture(texture);
        },
        bindTexture: (target, texture) => {
            gl.bindTexture(target, texture);
        },
        pixelStorei: (pname, param) => {
            gl.pixelStorei(pname, param);
        }
    };
}

function createRealWebGL2Context(): WebGL2RenderingContext {
    const gl = document.createElement('canvas').getContext('webgl2', {
        antialias: false,
        depth: false,
        stencil: false
    });
    if (!gl) throw new Error('WebGL 2 is required by the Texture browser tests');
    return gl;
}

function createRealTextureState(gl: WebGL2RenderingContext): WebGLTextureState {
    return createTextureState(gl, {
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
        max3DTextureSize: gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) as number,
        maxArrayTextureLayers: gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number
    });
}

describe('Texture', () => {
    it('create', () => {
        const texture = new Texture();
        expect(texture.isTexture).toBe(true);
        expect(texture.className).toBe('Texture');
        expect(texture.mipmapCount).toBe(1);
        expect(() => texture.getTextureUpdatesSince(0)).not.toThrow();
        expect(texture.getTextureUpdatesSince(0)).toMatchObject({
            revision: texture.updateRevision,
            requiresFullUpload: true,
            subTextures: []
        });
    });

    it('getSupportSize', () => {
        const texture = new Texture();
        const img = new Image();
        img.width = 1_024_000;
        img.height = 2040;
        let size = texture.getSupportSize(img);
        expect(size.width).toBe(img.width);
        expect(size.height).toBe(img.height);

        size = texture.getSupportSize(img, 4096);
        expect(size.width).toBe(4096);
        expect(size.height).toBe(2040);

        img.width = 4097;
        img.height = 4097;
        size = texture.getSupportSize(img, 4096);
        expect(size.width).toBe(4096);
        expect(size.height).toBe(4096);

        img.width = 4097;
        img.height = 19_999;
        size = texture.getSupportSize(img, 20_000);
        expect(size.width).toBe(4097);
        expect(size.height).toBe(19_999);
    });

    it('accepts only the four WebGL 2 texture targets and records layered descriptors', () => {
        expect(() => new Texture({ target: 0xdead })).toThrow(/target.*unsupported/);
        expect(() => new Texture({ target: TEXTURE_2D, depth: 2 })).toThrow(/depth must be 1/);

        for (const target of [TEXTURE_3D, TEXTURE_2D_ARRAY]) {
            const texture = new Texture({
                target,
                width: 1,
                height: 1,
                depth: 2,
                image: new Uint8Array(8)
            });
            texture.updateSubTexture({
                mipLevel: 0,
                ...(target === TEXTURE_3D ? { z: 1 } : { layer: 1 }),
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                depth: 1,
                image: new Uint8Array(4)
            });
            expect(texture.getTextureUpdatesSince(1).subTextures[0]).toMatchObject({
                mipLevel: 0,
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                depth: 1
            });
        }
    });

    it('enforces the backend-neutral sub-texture contract before either renderer uploads', () => {
        const texture = new Texture({ width: 4, height: 4, image: new ImageData(4, 4) });
        const descriptor = {
            mipLevel: 0,
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            image: new ImageData(1, 1)
        } as const;
        expect(() => {
            texture.updateSubTexture({ ...descriptor, x: -1 });
        }).toThrow(/non-negative/);
        expect(() => {
            texture.updateSubTexture({ ...descriptor, x: 0.5 });
        }).toThrow(/safe integer/);
        expect(() => {
            texture.updateSubTexture({ ...descriptor, x: 4 });
        }).toThrow(/exceeds the destination/);
        expect(() => {
            texture.updateSubTexture({
                ...descriptor,
                x: 1,
                image: new Uint8Array(4)
            });
        }).not.toThrow();

        const cube = new Texture({ target: TEXTURE_CUBE_MAP, width: 1, height: 1 });
        expect(() => {
            cube.updateSubTexture(descriptor);
        }).toThrow(/require face/);
        expect(() => {
            cube.updateSubTexture({ ...descriptor, face: 5 });
        }).not.toThrow();

        const compressed = new Texture({
            width: 4,
            height: 4,
            image: new Uint8Array(8),
            compressed: true,
            internalFormat: COMPRESSED_RGB_S3TC_DXT1_EXT
        });
        expect(() => {
            compressed.updateSubTexture({
                ...descriptor,
                width: 4,
                height: 4,
                image: new Uint8Array(8)
            });
        }).not.toThrow();
    });

    it('uploads descriptor regions to WebGL2 cube, 3D, array, and compressed entry points', () => {
        const mock = createMockTextureContext();
        const state = createTextureState(mock.gl);

        const cube = new Hilo3d.CubeTexture({
            width: 2,
            height: 2,
            image: Array.from({ length: 6 }, () => new Uint8Array(12))
        });
        const cubeAllocation = {};
        updateWebGLTexture(state, cube, cubeAllocation);
        cube.updateSubTexture({
            mipLevel: 0,
            face: 4,
            x: 1,
            y: 1,
            width: 1,
            height: 1,
            image: new Uint8Array([1, 2, 3])
        });
        updateWebGLTexture(state, cube, cubeAllocation);
        expect(mock.texSubImage2D).toHaveBeenLastCalledWith(
            Hilo3d.constants.TEXTURE_CUBE_MAP_POSITIVE_X + 4,
            0,
            1,
            1,
            1,
            1,
            RGB,
            UNSIGNED_BYTE,
            expect.any(Uint8Array)
        );

        for (const target of [TEXTURE_3D, TEXTURE_2D_ARRAY]) {
            const texture = new Texture({
                target,
                width: 2,
                height: 2,
                depth: 2,
                image: new Uint8Array(32)
            });
            const allocation = {};
            updateWebGLTexture(state, texture, allocation);
            texture.updateSubTexture({
                mipLevel: 0,
                ...(target === TEXTURE_3D ? { z: 1 } : { layer: 1 }),
                x: 1,
                y: 0,
                width: 1,
                height: 2,
                depth: 1,
                image: new Uint8Array(8)
            });
            updateWebGLTexture(state, texture, allocation);
        }
        expect(mock.texSubImage3D).toHaveBeenNthCalledWith(
            1,
            TEXTURE_3D,
            0,
            1,
            0,
            1,
            1,
            2,
            1,
            RGBA,
            UNSIGNED_BYTE,
            expect.any(Uint8Array)
        );
        expect(mock.texSubImage3D).toHaveBeenNthCalledWith(
            2,
            TEXTURE_2D_ARRAY,
            0,
            1,
            0,
            1,
            1,
            2,
            1,
            RGBA,
            UNSIGNED_BYTE,
            expect.any(Uint8Array)
        );

        const compressed = new Texture({
            width: 8,
            height: 8,
            image: new Uint8Array(32),
            compressed: true,
            internalFormat: COMPRESSED_RGB_S3TC_DXT1_EXT,
            type: 0
        });
        const compressedAllocation = {};
        updateWebGLTexture(state, compressed, compressedAllocation);
        compressed.updateSubTexture({
            mipLevel: 0,
            x: 4,
            y: 0,
            width: 4,
            height: 4,
            image: new Uint8Array(8)
        });
        updateWebGLTexture(state, compressed, compressedAllocation);
        expect(mock.compressedTexSubImage2D).toHaveBeenCalledWith(
            TEXTURE_2D,
            0,
            4,
            0,
            4,
            4,
            COMPRESSED_RGB_S3TC_DXT1_EXT,
            expect.any(Uint8Array)
        );
    });

    it('bounds update history with an exact full-content checkpoint for slow backends', () => {
        const texture = new Texture({
            width: 2,
            height: 2,
            image: new Uint8Array(16)
        });
        const slowRevision = texture.updateRevision;
        let fastRevision = slowRevision;
        for (let index = 0; index < 200; index++) {
            texture.updateSubTexture({
                mipLevel: 0,
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                image: new Uint8Array([index, index + 1, index + 2, 255])
            });
            if (index === 31) fastRevision = texture.updateRevision;
        }

        const slow = texture.getTextureUpdatesSince(slowRevision);
        const fast = texture.getTextureUpdatesSince(fastRevision);
        expect(slow.requiresFullUpload).toBe(true);
        expect(fast.requiresFullUpload).toBe(true);
        expect(slow.subTextures.length).toBeLessThanOrEqual(64);
        expect(fast.subTextures.length).toBeLessThanOrEqual(64);
        const backing = getTextureRecoveryBacking(texture);
        expect(Array.from((backing?.image as Uint8Array).subarray(0, 4))).toEqual([
            199, 200, 201, 255
        ]);
    });

    it('rejects managed raw depth declarations that cannot be reconstructed on WebGPU', () => {
        expect(
            () =>
                new Texture({
                    width: 1,
                    height: 1,
                    internalFormat: Hilo3d.constants.DEPTH_COMPONENT24,
                    format: DEPTH_COMPONENT,
                    type: Hilo3d.constants.UNSIGNED_INT,
                    image: new Uint32Array([0xffffff])
                })
        ).toThrow(/no portable WebGPU byte representation/);
        expect(
            () =>
                new Texture({
                    width: 1,
                    height: 1,
                    internalFormat: DEPTH_COMPONENT16,
                    format: RGBA,
                    type: UNSIGNED_SHORT,
                    image: null
                })
        ).toThrow(/exact WebGL2 declaration/);
    });

    it('rejects depth mipmap filters consistently across WebGL2 and WebGPU', () => {
        expect(
            () =>
                new Texture({
                    width: 4,
                    height: 4,
                    image: null,
                    internalFormat: DEPTH_COMPONENT16,
                    format: DEPTH_COMPONENT,
                    type: UNSIGNED_SHORT,
                    minFilter: NEAREST_MIPMAP_NEAREST
                })
        ).toThrow(/Depth textures cannot use mipmap filters/);
    });

    it('derives 3D mip depth while preserving 2D-array layers', () => {
        const volume = new Texture({ target: TEXTURE_3D, width: 2, height: 2, depth: 8 });
        const array = new Texture({ target: TEXTURE_2D_ARRAY, width: 2, height: 2, depth: 8 });

        expect(volume.mipmapCount).toBe(4);
        expect(array.mipmapCount).toBe(2);
    });

    it('rejects compressed 3D textures while retaining compressed 2D-array support', () => {
        expect(
            () =>
                new Texture({
                    target: TEXTURE_3D,
                    width: 4,
                    height: 4,
                    depth: 2,
                    image: new Uint8Array(16),
                    compressed: true,
                    internalFormat: COMPRESSED_RGB_S3TC_DXT1_EXT
                })
        ).toThrow(/Compressed 3D textures are unsupported/);

        const mock = createMockTextureContext();
        const volume = new Texture({
            target: TEXTURE_3D,
            width: 1,
            height: 1,
            depth: 1,
            image: new Uint8Array(4)
        });
        volume.compressed = true;
        expect(() => updateWebGLTexture(createTextureState(mock.gl), volume, {})).toThrow(
            /Compressed 3D textures are unsupported/
        );
        expect(mock.compressedTexImage3D).not.toHaveBeenCalled();
    });

    it('requires a complete explicit mip chain for every mipmapped 3D texture', () => {
        expect(
            () =>
                new Texture({
                    target: TEXTURE_3D,
                    width: 2,
                    height: 2,
                    depth: 2,
                    image: new Uint8Array(32),
                    minFilter: NEAREST_MIPMAP_NEAREST
                })
        ).toThrow(/require a complete explicit mipmap chain/);

        const mock = createMockTextureContext();
        const volume = new Texture({
            target: TEXTURE_3D,
            width: 2,
            height: 2,
            depth: 2,
            image: new Uint8Array(32)
        });
        volume.minFilter = NEAREST_MIPMAP_NEAREST;
        expect(() => updateWebGLTexture(createTextureState(mock.gl), volume, {})).toThrow(
            /require a complete explicit mipmap chain/
        );
        expect(mock.texImage3D).not.toHaveBeenCalled();
        expect(mock.generateMipmap).not.toHaveBeenCalled();

        const incomplete = new Texture({
            target: TEXTURE_3D,
            width: 2,
            height: 2,
            depth: 2,
            image: null,
            minFilter: NEAREST_MIPMAP_NEAREST,
            mipmaps: [{ data: new Uint8Array(32), width: 2, height: 2, depth: 2 }]
        });
        expect(() => updateWebGLTexture(createTextureState(mock.gl), incomplete, {})).toThrow(
            /has 1 levels; 2 are required/
        );
        expect(mock.texImage3D).not.toHaveBeenCalled();
        expect(mock.generateMipmap).not.toHaveBeenCalled();
    });

    it('enforces the same non-filtering contract for integer textures on every backend', () => {
        expect(
            () =>
                new Texture({
                    width: 1,
                    height: 1,
                    internalFormat: R8I,
                    format: RED_INTEGER,
                    image: new Int8Array([1])
                })
        ).toThrow(/Integer textures require NEAREST/u);

        expect(
            () =>
                new Texture({
                    width: 1,
                    height: 1,
                    internalFormat: R8I,
                    format: RED_INTEGER,
                    magFilter: NEAREST,
                    minFilter: NEAREST,
                    anisotropic: 2,
                    image: new Int8Array([1])
                })
        ).toThrow(/do not support anisotropic/u);

        expect(
            () =>
                new Texture({
                    width: 2,
                    height: 2,
                    internalFormat: R8I,
                    format: RED_INTEGER,
                    magFilter: NEAREST,
                    minFilter: NEAREST_MIPMAP_NEAREST,
                    image: new Int8Array(4)
                })
        ).toThrow(/complete explicit mipmap chain/u);

        expect(
            () =>
                new Texture({
                    width: 1,
                    height: 1,
                    internalFormat: R8I,
                    format: RED_INTEGER,
                    magFilter: NEAREST,
                    minFilter: NEAREST,
                    image: new Int8Array([1])
                })
        ).not.toThrow();
    });

    it('validates layered dimensions, limits, source kinds, and exact pixel length', () => {
        const mock = createMockTextureContext();
        const state = createTextureState(mock.gl, {
            maxTextureSize: 8,
            max3DTextureSize: 4,
            maxArrayTextureLayers: 3
        });
        const nativeTexture: WebGLTexture = {};

        expect(() =>
            updateWebGLTexture(
                state,
                new Texture({
                    target: TEXTURE_3D,
                    width: 0,
                    height: 1,
                    depth: 1,
                    image: new Uint8Array(0)
                }),
                nativeTexture
            )
        ).toThrow(/width must be a positive safe integer/);
        expect(() =>
            updateWebGLTexture(
                state,
                new Texture({
                    target: TEXTURE_3D,
                    width: 5,
                    height: 1,
                    depth: 1,
                    image: new Uint8Array(20)
                }),
                nativeTexture
            )
        ).toThrow(/width 5 exceeds.*limit 4/);
        expect(() =>
            updateWebGLTexture(
                state,
                new Texture({
                    target: TEXTURE_2D_ARRAY,
                    width: 1,
                    height: 1,
                    depth: 4,
                    image: new Uint8Array(16)
                }),
                nativeTexture
            )
        ).toThrow(/layer count 4 exceeds.*limit 3/);

        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        expect(() =>
            updateWebGLTexture(
                state,
                new Texture({
                    target: TEXTURE_3D,
                    width: 1,
                    height: 1,
                    depth: 1,
                    image: canvas
                }),
                nativeTexture
            )
        ).toThrow(/require raw pixel data or null/);

        const incomplete = new Texture({
            target: TEXTURE_3D,
            width: 2,
            height: 2,
            depth: 2,
            image: new Uint8Array(31),
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE
        });
        expect(() => updateWebGLTexture(state, incomplete, nativeTexture)).toThrow(
            /contains 31 elements; 32 are required/
        );
        expect(mock.texImage3D).not.toHaveBeenCalled();
    });

    it('requires explicit depth on layered mipmaps with target-specific progression', () => {
        const mock = createMockTextureContext();
        const state = createTextureState(mock.gl);
        const volume = new Texture({
            target: TEXTURE_3D,
            width: 4,
            height: 2,
            depth: 4,
            image: null,
            minFilter: NEAREST_MIPMAP_NEAREST,
            mipmaps: [
                { data: new Uint8Array(128), width: 4, height: 2 },
                { data: new Uint8Array(16), width: 2, height: 1, depth: 2 },
                { data: new Uint8Array(4), width: 1, height: 1, depth: 1 }
            ]
        });
        expect(() => updateWebGLTexture(state, volume, {})).toThrow(
            /Mipmap 0 depth is undefined; expected 4/
        );

        const array = new Texture({
            target: TEXTURE_2D_ARRAY,
            width: 2,
            height: 2,
            depth: 3,
            image: null,
            minFilter: NEAREST_MIPMAP_NEAREST,
            mipmaps: [
                { data: new Uint8Array(48), width: 2, height: 2, depth: 3 },
                { data: new Uint8Array(4), width: 1, height: 1, depth: 1 }
            ]
        });
        expect(() => updateWebGLTexture(state, array, {})).toThrow(
            /Mipmap 1 depth is 1; expected 3/
        );
    });

    it('routes layered raw and compressed storage through the WebGL 2 3D entry points', () => {
        const mock = createMockTextureContext();
        const state = createTextureState(mock.gl);
        const raw = new Texture({
            target: TEXTURE_3D,
            width: 2,
            height: 1,
            depth: 2,
            image: new Uint8Array(16),
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE,
            wrapR: CLAMP_TO_EDGE
        });
        updateWebGLTexture(state, raw, {});
        expect(mock.texImage3D).toHaveBeenCalledWith(
            TEXTURE_3D,
            0,
            RGBA8,
            2,
            1,
            2,
            0,
            RGBA,
            UNSIGNED_BYTE,
            expect.any(Uint8Array)
        );

        const compressed = new Texture({
            target: TEXTURE_2D_ARRAY,
            width: 4,
            height: 4,
            depth: 2,
            image: new Uint8Array(16),
            compressed: true,
            internalFormat: COMPRESSED_RGB_S3TC_DXT1_EXT,
            format: RGB,
            type: 0
        });
        updateWebGLTexture(state, compressed, {});
        expect(mock.compressedTexImage3D).toHaveBeenCalledWith(
            TEXTURE_2D_ARRAY,
            0,
            COMPRESSED_RGB_S3TC_DXT1_EXT,
            4,
            4,
            2,
            0,
            expect.any(Uint8Array)
        );

        const invalid = new Texture({
            target: TEXTURE_2D_ARRAY,
            width: 4,
            height: 4,
            depth: 2,
            image: new Uint8Array(15),
            compressed: true,
            internalFormat: COMPRESSED_RGB_S3TC_DXT1_EXT,
            type: 0
        });
        expect(() => updateWebGLTexture(state, invalid, {})).toThrow(
            /contains 15 bytes; 16 are required/
        );
        expect(mock.compressedTexImage3D).toHaveBeenCalledTimes(1);
    });

    it('preserves layered dimension state in clone and immutable recovery backing', () => {
        const level0 = new Uint8Array(32);
        const level1 = new Uint8Array(4);
        const texture = new Texture({
            target: TEXTURE_3D,
            width: 2,
            height: 2,
            depth: 2,
            image: level0,
            mipmaps: [
                { data: level0, width: 2, height: 2, depth: 2 },
                { data: level1, width: 1, height: 1, depth: 1 }
            ],
            minFilter: NEAREST_MIPMAP_NEAREST,
            wrapR: CLAMP_TO_EDGE,
            isImageCanRelease: true
        });
        const clone = texture.clone();
        expect(clone.depth).toBe(2);
        expect(clone.wrapR).toBe(CLAMP_TO_EDGE);
        expect(clone.mipmaps?.map(level => level.depth)).toEqual([2, 1]);
        expect(clone.mipmaps?.[0]).not.toBe(texture.mipmaps?.[0]);

        expect(texture.releaseImageIfAllowed()).toBe(true);
        const backing = getTextureRecoveryBacking(texture);
        expect(backing?.mipmaps?.map(level => level.depth)).toEqual([2, 1]);
        expect(backing?.mipmaps?.[0]?.data).not.toBe(level0);

        const recoveredContext = createMockTextureContext();
        const recoveredManager = new WebGLTextureManager(createTextureState(recoveredContext.gl));
        try {
            recoveredManager.get(texture);
            expect(recoveredContext.texImage3D).toHaveBeenCalledTimes(2);
            expect(recoveredContext.texImage3D.mock.calls[0]?.[5]).toBe(2);
            expect(recoveredContext.texImage3D.mock.calls[1]?.[5]).toBe(1);
            expect(recoveredContext.generateMipmap).not.toHaveBeenCalled();
        } finally {
            recoveredManager.destroy();
        }
    });

    it('uploads real WebGL 2 volume and array textures without GL errors', () => {
        const gl = createRealWebGL2Context();
        const state = createRealTextureState(gl);
        const manager = new WebGLTextureManager(state);
        const volume = new Texture({
            target: TEXTURE_3D,
            width: 2,
            height: 2,
            depth: 2,
            image: new Uint8Array(32),
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE,
            magFilter: NEAREST,
            minFilter: NEAREST,
            wrapR: CLAMP_TO_EDGE
        });
        const array = new Texture({
            target: TEXTURE_2D_ARRAY,
            width: 2,
            height: 2,
            depth: 3,
            image: null,
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE,
            magFilter: NEAREST,
            minFilter: NEAREST_MIPMAP_NEAREST,
            mipmaps: [
                { data: new Uint8Array(48), width: 2, height: 2, depth: 3 },
                { data: new Uint8Array(12), width: 1, height: 1, depth: 3 }
            ]
        });

        expect(gl.getError()).toBe(gl.NO_ERROR);
        try {
            manager.get(volume);
            expect(gl.getError()).toBe(gl.NO_ERROR);

            manager.get(array);
            expect(gl.getError()).toBe(gl.NO_ERROR);
        } finally {
            volume.destroy();
            array.destroy();
            manager.destroy();
        }
        expect(gl.getError()).toBe(gl.NO_ERROR);
    });

    it('uploads DataView rows with deterministic flip and tight packing in WebGL 2', () => {
        const texImage2D = vi.fn();
        const pixelStorei = vi.fn();
        const gl = {
            TEXTURE0: 0x84c0,
            TEXTURE_MAG_FILTER: 0x2800,
            TEXTURE_MIN_FILTER: 0x2801,
            TEXTURE_WRAP_S: 0x2802,
            TEXTURE_WRAP_T: 0x2803,
            texImage2D,
            texParameterf: vi.fn(),
            generateMipmap: vi.fn()
        } as unknown as WebGL2RenderingContext;
        const storage = new Uint8Array(17);
        storage.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 1);
        const texture = new Texture<DataView>({
            width: 2,
            height: 2,
            flipY: true,
            image: new DataView(storage.buffer, 1, 16)
        });

        updateWebGLTexture(
            {
                gl,
                capabilities: {
                    MAX_TEXTURE_SIZE: 0,
                    MAX_3D_TEXTURE_SIZE: 0,
                    MAX_ARRAY_TEXTURE_LAYERS: 0,
                    MAX_TEXTURE_INDEX: 0
                },
                activeTexture: vi.fn(),
                bindTexture: vi.fn(),
                pixelStorei
            },
            texture,
            {}
        );

        const upload = texImage2D.mock.calls[0]?.[8] as Uint8Array;
        expect([...upload]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 1, 2, 3, 4, 5, 6, 7, 8]);
        expect(pixelStorei).toHaveBeenCalledWith(UNPACK_ALIGNMENT, 1);
        expect(pixelStorei).toHaveBeenCalledWith(
            UNPACK_COLORSPACE_CONVERSION_WEBGL,
            BROWSER_DEFAULT_WEBGL
        );
        expect(pixelStorei).toHaveBeenCalledWith(UNPACK_FLIP_Y_WEBGL, false);
    });

    it('replays released compressed mipmaps into a second WebGL2 context allocation', () => {
        const createFakeContext = (): {
            gl: WebGL2RenderingContext;
            compressedTexImage2D: ReturnType<typeof vi.fn>;
        } => {
            const compressedTexImage2D = vi.fn();
            const gl = {
                TEXTURE0: 0x84c0,
                TEXTURE_MAG_FILTER: 0x2800,
                TEXTURE_MIN_FILTER: 0x2801,
                TEXTURE_WRAP_S: 0x2802,
                TEXTURE_WRAP_T: 0x2803,
                createTexture: vi.fn(() => ({})),
                deleteTexture: vi.fn(),
                compressedTexImage2D,
                texParameterf: vi.fn(),
                generateMipmap: vi.fn()
            } as unknown as WebGL2RenderingContext;
            return { gl, compressedTexImage2D };
        };
        const createState = (gl: WebGL2RenderingContext): WebGLTextureState => ({
            gl,
            capabilities: {
                MAX_TEXTURE_SIZE: 4096,
                MAX_3D_TEXTURE_SIZE: 256,
                MAX_ARRAY_TEXTURE_LAYERS: 256,
                MAX_TEXTURE_INDEX: 0
            },
            activeTexture: vi.fn(),
            bindTexture: vi.fn(),
            pixelStorei: vi.fn()
        });
        const first = createFakeContext();
        const second = createFakeContext();
        const firstState = createState(first.gl);
        const secondState = createState(second.gl);
        const firstManager = new WebGLTextureManager(firstState);
        const secondManager = new WebGLTextureManager(secondState);
        const level0 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
        const level1 = new Uint8Array([9, 10, 11, 12]);
        const level2 = new Uint8Array([13, 14, 15, 16]);
        const texture = new Texture<Uint8Array | null>({
            width: 4,
            height: 4,
            image: null,
            compressed: true,
            internalFormat: 0x83f0,
            minFilter: Hilo3d.constants.LINEAR_MIPMAP_LINEAR,
            magFilter: Hilo3d.constants.LINEAR,
            mipmaps: [
                { data: level0, width: 4, height: 4 },
                { data: level1, width: 2, height: 2 },
                { data: level2, width: 1, height: 1 }
            ],
            isImageCanRelease: true
        });

        try {
            const firstAllocation = firstManager.get(texture);
            expect(firstAllocation).toBeDefined();
            expect(first.compressedTexImage2D).toHaveBeenCalledTimes(3);
            expect(texture.isImageReleased).toBe(true);
            expect(texture.mipmaps).toBeNull();

            const secondAllocation = secondManager.get(texture);
            expect(secondAllocation).not.toBe(firstAllocation);
            expect(second.compressedTexImage2D).toHaveBeenCalledTimes(3);
            expect(second.compressedTexImage2D.mock.calls[0]?.[6]).not.toBe(level0);
            expect(second.compressedTexImage2D.mock.calls[1]?.[6]).not.toBe(level1);
            expect(second.compressedTexImage2D.mock.calls[2]?.[6]).not.toBe(level2);
            expect(() => texture.image).toThrow(/has been released/);

            const incomplete = new Texture<Uint8Array | null>({
                width: 4,
                height: 4,
                image: null,
                compressed: true,
                internalFormat: 0x83f0,
                minFilter: Hilo3d.constants.LINEAR_MIPMAP_LINEAR,
                mipmaps: [
                    { data: level0, width: 4, height: 4 },
                    { data: level1, width: 2, height: 2 }
                ]
            });
            expect(() => updateWebGLTexture(firstState, incomplete, {})).toThrow(
                /has 2 levels; 3 are required/
            );
        } finally {
            firstManager.destroy();
            secondManager.destroy();
        }
    });

    it('refreshes stable native allocations when a shared descriptor changes', () => {
        const first = createMockTextureContext();
        const second = createMockTextureContext();
        const firstManager = new WebGLTextureManager(createTextureState(first.gl));
        const secondManager = new WebGLTextureManager(createTextureState(second.gl));
        const texture = new Texture<null>({
            width: 1,
            height: 1,
            image: null,
            minFilter: NEAREST,
            magFilter: NEAREST
        });

        try {
            const firstAllocation = firstManager.get(texture);
            const secondAllocation = secondManager.get(texture);
            texture.width = 2;
            texture.height = 3;

            expect(firstManager.get(texture)).toBe(firstAllocation);
            expect(secondManager.get(texture)).toBe(secondAllocation);
            expect(first.texImage2D).toHaveBeenCalledTimes(2);
            expect(second.texImage2D).toHaveBeenCalledTimes(2);
            expect(first.texImage2D.mock.calls[1]?.slice(3, 5)).toEqual([2, 3]);
            expect(second.texImage2D.mock.calls[1]?.slice(3, 5)).toEqual([2, 3]);
        } finally {
            firstManager.destroy();
            secondManager.destroy();
        }
    });

    it('recreates allocations only when the WebGL texture target changes', () => {
        const mock = createMockTextureContext();
        const manager = new WebGLTextureManager(createTextureState(mock.gl));
        const texture = new Texture<null>({ width: 1, height: 1, image: null });

        try {
            const firstAllocation = manager.get(texture);
            texture.target = TEXTURE_3D;
            texture.depth = 1;
            const secondAllocation = manager.get(texture);

            expect(secondAllocation).not.toBe(firstAllocation);
            expect(mock.deleteTexture).toHaveBeenCalledWith(firstAllocation);
            expect(mock.createTexture).toHaveBeenCalledTimes(2);
            expect(mock.texImage3D).toHaveBeenCalledOnce();
        } finally {
            manager.destroy();
        }
    });

    it('keeps sampler-only changes out of texture content uploads', () => {
        const mock = createMockTextureContext();
        const manager = new WebGLTextureManager(createTextureState(mock.gl));
        const texture = new Texture<null>({ width: 1, height: 1, image: null });

        try {
            const allocation = manager.get(texture);
            texture.wrapS = CLAMP_TO_EDGE;
            texture.anisotropic = 8;

            expect(manager.get(texture)).toBe(allocation);
            expect(mock.texImage2D).toHaveBeenCalledOnce();
        } finally {
            manager.destroy();
        }
    });

    it('does not re-upload released CPU content on a clean manager lookup', () => {
        const mock = createMockTextureContext();
        const manager = new WebGLTextureManager(createTextureState(mock.gl));
        const texture = new Texture({
            width: 1,
            height: 1,
            image: new Uint8Array(4),
            isImageCanRelease: true
        });

        try {
            const allocation = manager.get(texture);
            expect(texture.isImageReleased).toBe(true);
            expect(manager.get(texture)).toBe(allocation);
            expect(mock.texImage2D).toHaveBeenCalledOnce();
        } finally {
            manager.destroy();
        }
    });

    it('uploads a full recovery checkpoint without replaying its sub-updates', () => {
        const mock = createMockTextureContext();
        const manager = new WebGLTextureManager(createTextureState(mock.gl));
        const texture = new Texture({
            width: 2,
            height: 2,
            image: new Uint8Array(16),
            flipY: false
        });
        texture.updateSubTexture({
            mipLevel: 0,
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            image: new Uint8Array([1, 2, 3, 4])
        });

        try {
            manager.get(texture);
            expect(mock.texImage2D).toHaveBeenCalledOnce();
            expect(mock.texSubImage2D).not.toHaveBeenCalled();
            expect(mock.texImage2D.mock.calls[0]?.[8]).toEqual(
                new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
            );
        } finally {
            manager.destroy();
        }
    });

    it('keeps explicit-mipmap sub-updates incremental', () => {
        const mock = createMockTextureContext();
        const manager = new WebGLTextureManager(createTextureState(mock.gl));
        const texture = new Texture<null>({
            width: 2,
            height: 2,
            image: null,
            minFilter: NEAREST_MIPMAP_NEAREST,
            flipY: false,
            mipmaps: [
                { data: new Uint8Array(16), width: 2, height: 2 },
                { data: new Uint8Array(4), width: 1, height: 1 }
            ]
        });

        try {
            manager.get(texture);
            texture.updateSubTexture({
                mipLevel: 1,
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                image: new Uint8Array([5, 6, 7, 8])
            });
            manager.get(texture);

            expect(mock.texImage2D).toHaveBeenCalledTimes(2);
            expect(mock.texSubImage2D).toHaveBeenCalledOnce();
            expect(mock.generateMipmap).not.toHaveBeenCalled();
        } finally {
            manager.destroy();
        }
    });

    it('drops a partially updated native resource after an upload failure', () => {
        const mock = createMockTextureContext();
        const manager = new WebGLTextureManager(createTextureState(mock.gl));
        const texture = new Texture<null>({ width: 1, height: 1, image: null });

        try {
            const firstAllocation = manager.get(texture);
            texture.width = 2;
            mock.texImage2D.mockImplementationOnce(() => {
                throw new Error('upload failed');
            });

            expect(() => manager.get(texture)).toThrow('upload failed');
            expect(mock.deleteTexture).toHaveBeenCalledWith(firstAllocation);
            const recoveredAllocation = manager.get(texture);
            expect(recoveredAllocation).not.toBe(firstAllocation);
            expect(mock.createTexture).toHaveBeenCalledTimes(2);
        } finally {
            manager.destroy();
        }
    });

    it('downscales per context without mutating shared CPU texture dimensions', () => {
        const low = createMockTextureContext();
        const high = createMockTextureContext();
        const lowManager = new WebGLTextureManager(
            createTextureState(low.gl, { maxTextureSize: 2 })
        );
        const highManager = new WebGLTextureManager(
            createTextureState(high.gl, { maxTextureSize: 8 })
        );
        const source = document.createElement('canvas');
        source.width = 4;
        source.height = 4;
        const texture = new Texture({ image: source, flipY: false });

        try {
            lowManager.get(texture);
            highManager.get(texture);

            expect(low.texImage2D.mock.calls[0]?.[5]).toMatchObject({ width: 2, height: 2 });
            expect(high.texImage2D.mock.calls[0]?.[5]).toBe(source);
            expect(texture.image).toBe(source);
            expect(texture.width).toBe(4);
            expect(texture.height).toBe(4);

            texture.updateSubTexture({
                mipLevel: 0,
                x: 3,
                y: 3,
                width: 1,
                height: 1,
                image: new ImageData(1, 1)
            });
            lowManager.get(texture);
            expect(low.texImage2D).toHaveBeenCalledTimes(2);
            expect(low.texSubImage2D).not.toHaveBeenCalled();
        } finally {
            lowManager.destroy();
            highManager.destroy();
        }
    });

    it('releases every backend allocation before cancellable public destroy listeners', () => {
        const first = createMockTextureContext();
        const second = createMockTextureContext();
        const firstManager = new WebGLTextureManager(createTextureState(first.gl));
        const secondManager = new WebGLTextureManager(createTextureState(second.gl));
        const texture = new Texture<null>({ width: 1, height: 1, image: null });
        texture.on('destroy', event => {
            event.stopImmediatePropagation?.();
            throw new Error('public listener failed');
        });
        const firstAllocation = firstManager.get(texture);
        const secondAllocation = secondManager.get(texture);

        expect(() => texture.destroy()).toThrow('public listener failed');
        expect(first.deleteTexture).toHaveBeenCalledWith(firstAllocation);
        expect(second.deleteTexture).toHaveBeenCalledWith(secondAllocation);
        expect(firstManager.cache.get(texture.id)).toBeUndefined();
        expect(secondManager.cache.get(texture.id)).toBeUndefined();
        firstManager.destroy();
        secondManager.destroy();
    });
});
