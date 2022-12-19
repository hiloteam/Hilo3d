export class WebGL1VertexArrayObjectExtension {
    constructor(vaoExtension) {
        this._ext = vaoExtension;
    }

    createVertexArray(vertexArray) {
        return this._ext.createVertexArrayOES(vertexArray);
    }

    deleteVertexArray(vertexArray) {
        this._ext.deleteVertexArrayOES(vertexArray);
    }

    isVertexArray(vertexArray) {
        return this._ext.isVertexArrayOES(vertexArray);
    }

    bindVertexArray(vertexArray) {
        this._ext.bindVertexArrayOES(vertexArray);
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
