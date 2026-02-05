export class WebGL1DrawBuffersExtension {
    constructor(drawBuffersExtension) {
        this._ext = drawBuffersExtension;
    }

    drawBuffers(buffers) {
        this._ext.drawBuffersWEBGL(buffers);
    }
}

export class WebGL2DrawBuffersExtension {
    constructor(gl) {
        this._gl = gl;
    }

    drawBuffers(buffers) {
        this._gl.drawBuffers(buffers);
    }
}
