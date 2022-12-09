export class WebGL1InstancedArraysExtension {
    constructor(instancedArraysExtension) {
        this._instancedArraysExtension = instancedArraysExtension;
    }

    drawArraysInstanced(mode, first, count, instanceCount) {
        this._instancedArraysExtension.drawArraysInstancedANGLE(mode, first, count, instanceCount);
    }

    drawElementsInstanced(mode, count, type, offset, instanceCount) {
        this._instancedArraysExtension.drawElementsInstancedANGLE(mode, count, type, offset, instanceCount);
    }

    vertexAttribDivisor(index, divisor) {
        this._instancedArraysExtension.vertexAttribDivisorANGLE(index, divisor);
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
