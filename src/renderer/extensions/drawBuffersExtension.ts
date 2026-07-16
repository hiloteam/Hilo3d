export interface DrawBuffersExtension {
    drawBuffers(buffers: readonly GLenum[]): void;
}

export class WebGL1DrawBuffersExtension implements DrawBuffersExtension {
    constructor(private readonly extension: WEBGL_draw_buffers) {}

    drawBuffers(buffers: readonly GLenum[]): void {
        this.extension.drawBuffersWEBGL(buffers);
    }
}

export class WebGL2DrawBuffersExtension implements DrawBuffersExtension {
    constructor(private readonly gl: WebGL2RenderingContext) {}

    drawBuffers(buffers: readonly GLenum[]): void {
        this.gl.drawBuffers(buffers);
    }
}
