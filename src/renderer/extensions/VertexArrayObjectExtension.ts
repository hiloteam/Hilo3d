export class WebGL1VertexArrayObjectExtension {
    private _ext: any;

    constructor(vaoExtension: any) {
        this._ext = vaoExtension;
    }

    createVertexArray(): WebGLVertexArrayObject | null {
        return this._ext.createVertexArrayOES();
    }

    deleteVertexArray(vertexArray: WebGLVertexArrayObject | null): void {
        this._ext.deleteVertexArrayOES(vertexArray);
    }

    isVertexArray(vertexArray: WebGLVertexArrayObject | null): GLboolean {
        return this._ext.isVertexArrayOES(vertexArray);
    }

    bindVertexArray(vertexArray: WebGLVertexArrayObject | null): void {
        this._ext.bindVertexArrayOES(vertexArray);
    }
}

export class WebGL2VertexArrayObjectExtension {
    private _gl: WebGL2RenderingContext;

    constructor(gl: WebGL2RenderingContext) {
        this._gl = gl;
    }

    createVertexArray(): WebGLVertexArrayObject | null {
        return this._gl.createVertexArray();
    }

    deleteVertexArray(vertexArray: WebGLVertexArrayObject | null): void {
        this._gl.deleteVertexArray(vertexArray);
    }

    isVertexArray(vertexArray: WebGLVertexArrayObject | null): GLboolean {
        return this._gl.isVertexArray(vertexArray);
    }

    bindVertexArray(vertexArray: WebGLVertexArrayObject | null): void {
        this._gl.bindVertexArray(vertexArray);
    }
}
