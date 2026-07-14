/** WebGL 2 is the only legacy graphics context supported by the engine. */
export type GLContext = WebGL2RenderingContext;

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
