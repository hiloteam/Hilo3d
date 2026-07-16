let cachedSupport: boolean | undefined;

function detectWebGLSupport(): boolean {
    if (typeof document === 'undefined') return false;

    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl');
        if (!gl) return false;

        gl.clearColor(0, 1, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        const pixels = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels[0] === 0 && pixels[1] === 255 && pixels[2] === 0 && pixels[3] === 255;
    } catch {
        return false;
    }
}

/** Lazily detects whether the current runtime can create and read a WebGL context. */
const WebGLSupport = {
    get(): boolean {
        cachedSupport ??= detectWebGLSupport();
        return cachedSupport;
    }
} as const;

export { detectWebGLSupport };
export default WebGLSupport;
