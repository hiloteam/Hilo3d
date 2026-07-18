const canvas = document.querySelector('canvas');
if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('WebGL render-health fixture requires a canvas.');
}

function requireWebGL2(element: HTMLCanvasElement): WebGL2RenderingContext {
    const context = element.getContext('webgl2');
    if (!context) throw new Error('WebGL 2 is unavailable in the render-health fixture.');
    return context;
}

const gl = requireWebGL2(canvas);

function compileShader(type: GLenum, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Unable to allocate a WebGL shader.');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
        const message = gl.getShaderInfoLog(shader) ?? 'unknown shader error';
        gl.deleteShader(shader);
        throw new Error(`WebGL fixture shader compilation failed: ${message}`);
    }
    return shader;
}

function drawValidTriangle(): void {
    const vertex = compileShader(
        gl.VERTEX_SHADER,
        `#version 300 es
        void main() {
            const vec2 positions[3] = vec2[3](
                vec2(-1.0, -1.0),
                vec2(3.0, -1.0),
                vec2(-1.0, 3.0)
            );
            gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
        }`
    );
    const fragment = compileShader(
        gl.FRAGMENT_SHADER,
        `#version 300 es
        precision highp float;
        layout(location = 0) out vec4 fragmentColor;
        void main() {
            fragmentColor = vec4(0.2, 0.4, 0.8, 1.0);
        }`
    );
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
        const message = gl.getProgramInfoLog(program) ?? 'unknown link error';
        gl.deleteProgram(program);
        throw new Error(`WebGL fixture program link failed: ${message}`);
    }
    const vertexArray = gl.createVertexArray();
    gl.useProgram(program);
    gl.bindVertexArray(vertexArray);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.useProgram(null);
    gl.deleteVertexArray(vertexArray);
    gl.deleteProgram(program);
}

const mode = new URL(location.href).searchParams.get('mode');
if (mode === 'invalid') {
    // WebGL reports this through getError rather than a JavaScript exception.
    gl.drawArrays(gl.TRIANGLES, 0, 3);
} else if (mode === 'valid') {
    drawValidTriangle();
} else if (mode === 'invalid-after-draw') {
    drawValidTriangle();
    // This error occurs outside every wrapped clear/draw call and must survive until final health.
    gl.enable(0xdead);
} else {
    throw new TypeError(
        'WebGL render-health fixture requires mode=valid, mode=invalid, or mode=invalid-after-draw.'
    );
}

document.body.dataset['renderHealthComplete'] = mode;
