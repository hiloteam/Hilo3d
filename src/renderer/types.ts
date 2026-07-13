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

export interface TypedArrayConstructor {
    readonly BYTES_PER_ELEMENT: number;
    new (values: number | ArrayLike<number>): TypedArray;
}

export type GLContext = WebGLRenderingContext | WebGL2RenderingContext;

export type ShaderPrecision = 'highp' | 'mediump' | 'lowp';

export type ShaderDefineValue = string | number | boolean | undefined;
export type ShaderOptions = Record<string, ShaderDefineValue>;

export type TextureSource = TexImageSource | TypedArray;

export interface TextureSubImage {
    xOffset: number;
    yOffset: number;
    image: TextureSource;
}

export interface Size {
    width: number;
    height: number;
}

export type UniformScalar = number | boolean;
export type UniformArray = Float32List | Int32List | Uint32List;
export type UniformValue = UniformScalar | UniformArray;

export interface GLTypeInfo {
    readonly name: string;
    readonly byteSize: number;
    readonly uniformFuncName: string;
    readonly type: 'Scalar' | 'Vector' | 'Matrix';
    readonly size: number;
    glValue: GLenum;
    uniform(location: WebGLUniformLocation | null, value: UniformScalar | undefined): void;
    uniformArray(location: WebGLUniformLocation | null, value: UniformArray): void;
}

export interface VertexAttributeInfo {
    name: string;
    type: GLenum;
    size: number;
    location: GLint;
}

export interface UniformInfo {
    name: string;
    type: GLenum;
    size: number;
    location: WebGLUniformLocation | null;
    glTypeInfo: GLTypeInfo;
}

export interface UniformBlockInfo {
    name: string;
    index: GLuint;
}

export interface Resource {
    destroy(): unknown;
    destroyIfNoRef?(renderer: object): unknown;
}
