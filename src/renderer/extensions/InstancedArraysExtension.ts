export interface InstancedArraysExtension {
    drawArraysInstanced(mode: GLenum, first: GLint, count: GLsizei, instanceCount: GLsizei): void;
    drawElementsInstanced(
        mode: GLenum,
        count: GLsizei,
        type: GLenum,
        offset: GLintptr,
        instanceCount: GLsizei
    ): void;
    vertexAttribDivisor(index: GLuint, divisor: GLuint): void;
}

export class WebGL1InstancedArraysExtension implements InstancedArraysExtension {
    constructor(private readonly extension: ANGLE_instanced_arrays) {}

    drawArraysInstanced(mode: GLenum, first: GLint, count: GLsizei, instanceCount: GLsizei): void {
        this.extension.drawArraysInstancedANGLE(mode, first, count, instanceCount);
    }

    drawElementsInstanced(
        mode: GLenum,
        count: GLsizei,
        type: GLenum,
        offset: GLintptr,
        instanceCount: GLsizei
    ): void {
        this.extension.drawElementsInstancedANGLE(mode, count, type, offset, instanceCount);
    }

    vertexAttribDivisor(index: GLuint, divisor: GLuint): void {
        this.extension.vertexAttribDivisorANGLE(index, divisor);
    }
}

export class WebGL2InstancedArraysExtension implements InstancedArraysExtension {
    constructor(private readonly gl: WebGL2RenderingContext) {}

    drawArraysInstanced(mode: GLenum, first: GLint, count: GLsizei, instanceCount: GLsizei): void {
        this.gl.drawArraysInstanced(mode, first, count, instanceCount);
    }

    drawElementsInstanced(
        mode: GLenum,
        count: GLsizei,
        type: GLenum,
        offset: GLintptr,
        instanceCount: GLsizei
    ): void {
        this.gl.drawElementsInstanced(mode, count, type, offset, instanceCount);
    }

    vertexAttribDivisor(index: GLuint, divisor: GLuint): void {
        this.gl.vertexAttribDivisor(index, divisor);
    }
}
