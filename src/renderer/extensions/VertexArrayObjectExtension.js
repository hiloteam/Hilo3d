export class WebGL1VertexArrayObjectExtension {
    constructor(vaoExtension) {
        this._vaoExtension = vaoExtension;
    }

    createVertexArray(vertexArray) {
        return this._vaoExtension.createVertexArrayOES(vertexArray);
    }

    deleteVertexArray(vertexArray) {
        this._vaoExtension.deleteVertexArrayOES(vertexArray);
    }

    isVertexArray(vertexArray) {
        return this._vaoExtension.isVertexArrayOES(vertexArray);
    }

    bindVertexArray(vertexArray) {
        this._vaoExtension.bindVertexArrayOES(vertexArray);
    }
}

export class WebGL2VertexArrayObjectExtension {
    constructor(gl) {
        this._gl = gl;
    }

    createVertexArray(vertexArray) {
        return this._gl.createVertexArray(vertexArray);
    }

    deleteVertexArray(vertexArray) {
        this._gl.deleteVertexArray(vertexArray);
    }

    isVertexArray(vertexArray) {
        return this._gl.isVertexArray(vertexArray);
    }

    bindVertexArray(vertexArray) {
        this._gl.bindVertexArray(vertexArray);
    }
}
