interface WebGLSupportDetector {
    _isWebGLSupport?: boolean;
    get(): boolean;
}

const WebGLSupport: WebGLSupportDetector = {
    get() {
        if (this._isWebGLSupport !== undefined) return this._isWebGLSupport;

        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl');
            if (!gl) return (this._isWebGLSupport = false);

            gl.clearColor(0, 1, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);

            const pixels = new Uint8Array(4);
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            this._isWebGLSupport = pixels[0] === 0
                && pixels[1] === 255
                && pixels[2] === 0
                && pixels[3] === 255;
        } catch {
            this._isWebGLSupport = false;
        }

        return this._isWebGLSupport;
    }
};

export default WebGLSupport;
