export interface VertexArrayObjectExtension {
    createVertexArray(): WebGLVertexArrayObject | WebGLVertexArrayObjectOES | null;
    deleteVertexArray(vertexArray: WebGLVertexArrayObject | WebGLVertexArrayObjectOES | null): void;
    isVertexArray(vertexArray: WebGLVertexArrayObject | WebGLVertexArrayObjectOES | null): boolean;
    bindVertexArray(vertexArray: WebGLVertexArrayObject | WebGLVertexArrayObjectOES | null): void;
}

export class WebGL1VertexArrayObjectExtension implements VertexArrayObjectExtension {
    constructor(private readonly extension: OES_vertex_array_object) {}

    createVertexArray(): WebGLVertexArrayObjectOES | null {
        return this.extension.createVertexArrayOES();
    }

    deleteVertexArray(
        vertexArray: WebGLVertexArrayObject | WebGLVertexArrayObjectOES | null
    ): void {
        this.extension.deleteVertexArrayOES(vertexArray);
    }

    isVertexArray(vertexArray: WebGLVertexArrayObject | WebGLVertexArrayObjectOES | null): boolean {
        return this.extension.isVertexArrayOES(vertexArray);
    }

    bindVertexArray(vertexArray: WebGLVertexArrayObject | WebGLVertexArrayObjectOES | null): void {
        this.extension.bindVertexArrayOES(vertexArray);
    }
}

export class WebGL2VertexArrayObjectExtension implements VertexArrayObjectExtension {
    constructor(private readonly gl: WebGL2RenderingContext) {}

    createVertexArray(): WebGLVertexArrayObject | null {
        return this.gl.createVertexArray();
    }

    deleteVertexArray(
        vertexArray: WebGLVertexArrayObject | WebGLVertexArrayObjectOES | null
    ): void {
        this.gl.deleteVertexArray(vertexArray);
    }

    isVertexArray(vertexArray: WebGLVertexArrayObject | WebGLVertexArrayObjectOES | null): boolean {
        return this.gl.isVertexArray(vertexArray);
    }

    bindVertexArray(vertexArray: WebGLVertexArrayObject | WebGLVertexArrayObjectOES | null): void {
        this.gl.bindVertexArray(vertexArray);
    }
}
