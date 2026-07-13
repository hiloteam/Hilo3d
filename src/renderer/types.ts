export type TypedArray =
    | Int8Array
    | Uint8Array
    | Uint8ClampedArray
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array
    | Float32Array
    | Float64Array;

/** Raw, tightly packed texture storage accepted by both rendering backends. */
export type TexturePixelData = TypedArray | DataView;

export interface TypedArrayConstructor {
    readonly BYTES_PER_ELEMENT: number;
    new (values: number | ArrayLike<number>): TypedArray;
}

/** The renderer targets WebGL 2 exclusively. */
export type GLContext = WebGL2RenderingContext;

export type ShaderPrecision = 'highp' | 'mediump' | 'lowp';

export type ShaderDefineValue = string | number | boolean | undefined;
export type ShaderOptions = Record<string, ShaderDefineValue>;

export type TextureSource = TexImageSource | TexturePixelData;

/** A cube-map face in the WebGL/WebGPU canonical +X, -X, +Y, -Y, +Z, -Z order. */
export type TextureCubeFace = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Complete destination and source description for one immutable texture content update.
 *
 * `face`, `layer`, and `z` are target-specific and mutually exclusive: cube maps require
 * `face`; 2D arrays require `layer` and `depth`, where `depth` is the number of consecutive
 * layers; and 3D textures require `z` and `depth`. These fields are omitted for 2D textures.
 */
export interface TextureSubImage {
    /** Destination mip level. Levels above zero require an explicit mipmap chain. */
    readonly mipLevel: number;
    /** Cube-map face in canonical order. Required only for cube textures. */
    readonly face?: TextureCubeFace;
    /** First destination layer. Required only for 2D-array textures. */
    readonly layer?: number;
    /** First destination slice. Required only for 3D textures. */
    readonly z?: number;
    /** Destination x offset in logical texels. */
    readonly x: number;
    /** Destination y offset in logical texels. */
    readonly y: number;
    /** Source and destination width in logical texels. */
    readonly width: number;
    /** Source and destination height in logical texels. */
    readonly height: number;
    /** Number of consecutive array layers or 3D slices. */
    readonly depth?: number;
    /** Exact raw pixel/block data or one external image matching `width` and `height`. */
    readonly image: TextureSource;
}

export interface Size {
    width: number;
    height: number;
}

export interface GLTypeInfo {
    readonly name: string;
    readonly byteSize: number;
    readonly type: 'Scalar' | 'Vector' | 'Matrix';
    readonly size: number;
    glValue: GLenum;
}

export interface VertexAttributeInfo {
    name: string;
    type: GLenum;
    size: number;
    location: GLint;
}

export interface Resource {
    destroy(): unknown;
    destroyIfNoRef?(renderer: object): unknown;
}
