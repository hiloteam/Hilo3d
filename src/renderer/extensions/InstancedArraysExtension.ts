import type { ANGLEInstancedArraysExtension } from '../../types/common';

export class WebGL1InstancedArraysExtension {
    private _ext: ANGLEInstancedArraysExtension;

    constructor(instancedArraysExtension: ANGLEInstancedArraysExtension) {
        this._ext = instancedArraysExtension;
    }

    drawArraysInstanced(mode: GLenum, first: GLint, count: GLsizei, instanceCount: GLsizei): void {
        this._ext.drawArraysInstancedANGLE(mode, first, count, instanceCount);
    }

    drawElementsInstanced(mode: GLenum, count: GLsizei, type: GLenum, offset: GLintptr, instanceCount: GLsizei): void {
        this._ext.drawElementsInstancedANGLE(mode, count, type, offset, instanceCount);
    }

    vertexAttribDivisor(index: GLuint, divisor: GLuint): void {
        this._ext.vertexAttribDivisorANGLE(index, divisor);
    }
}

export class WebGL2InstancedArraysExtension {
    private _gl: WebGL2RenderingContext;

    constructor(gl: WebGL2RenderingContext) {
        this._gl = gl;
    }

    drawArraysInstanced(mode: GLenum, first: GLint, count: GLsizei, instanceCount: GLsizei): void {
        this._gl.drawArraysInstanced(mode, first, count, instanceCount);
    }

    drawElementsInstanced(mode: GLenum, count: GLsizei, type: GLenum, offset: GLintptr, instanceCount: GLsizei): void {
        this._gl.drawElementsInstanced(mode, count, type, offset, instanceCount);
    }

    vertexAttribDivisor(index: GLuint, divisor: GLuint): void {
        this._gl.vertexAttribDivisor(index, divisor);
    }
}
