export class WebGL1InstancedArraysExtension {
    constructor(instancedArraysExtension) {
        this._ext = instancedArraysExtension;
    }

    drawArraysInstanced(mode, first, count, instanceCount) {
        this._ext.drawArraysInstancedANGLE(mode, first, count, instanceCount);
    }

    drawElementsInstanced(mode, count, type, offset, instanceCount) {
        this._ext.drawElementsInstancedANGLE(mode, count, type, offset, instanceCount);
    }

    vertexAttribDivisor(index, divisor) {
        this._ext.vertexAttribDivisorANGLE(index, divisor);
    }
}

export class WebGL2InstancedArraysExtension {
    constructor(gl) {
        this._gl = gl;
    }

    drawArraysInstanced(mode, first, count, instanceCount) {
        this._gl.drawArraysInstanced(mode, first, count, instanceCount);
    }

    drawElementsInstanced(mode, count, type, offset, instanceCount) {
        this._gl.drawElementsInstanced(mode, count, type, offset, instanceCount);
    }

    vertexAttribDivisor(index, divisor) {
        this._gl.vertexAttribDivisor(index, divisor);
    }
}
