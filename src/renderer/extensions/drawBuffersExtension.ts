export class WebGL1DrawBuffersExtension {
    private _ext: any;

    constructor(drawBuffersExtension: any) {
        this._ext = drawBuffersExtension;
    }

    drawBuffers(buffers: GLenum[]): void {
        this._ext.drawBuffersWEBGL(buffers);
    }
}

export class WebGL2DrawBuffersExtension {
    private _gl: WebGL2RenderingContext;

    constructor(gl: WebGL2RenderingContext) {
        this._gl = gl;
    }

    drawBuffers(buffers: GLenum[]): void {
        this._gl.drawBuffers(buffers);
    }
}
