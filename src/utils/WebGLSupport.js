/**
 * WebGL支持检测
 * @namespace WebGLSupport
 * @type {Object}
 */
const WebGLSupport = {
    /**
     * 是否支持 WebGL
     * @return {Boolean}
     */
    get() {
        if (this._isWebGLSupport === undefined) {
            try {
                let canvas = document.createElement('canvas');
                let gl = canvas.getContext('webgl');
                gl.clearColor(0, 1, 0, 1);
                gl.clear(gl.COLOR_BUFFER_BIT);

                let pixels = new Uint8Array(4);
                gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                if (pixels[0] === 0 && pixels[1] === 255 && pixels[2] === 0 && pixels[3] === 255) {
                    this._isWebGLSupport = true;
                } else {
                    this._isWebGLSupport = false;
                }

                canvas = null;
                gl = null;
                pixels = null;
            } catch (e) {
                this._isWebGLSupport = false;
            }
        }
        return this._isWebGLSupport;
    }
};

export default WebGLSupport;
