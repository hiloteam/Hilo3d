const portableCoordinateShader = '';

const shaderToyCode = `
vec4 render(vec2 uv) {
    return texture(iChannel0, uv) * 0.4 +
        texture(iChannel1, uv) * 0.3 +
        texture(iChannel2, uv) * 0.2 +
        texture(iChannel3, uv) * 0.1;
}
`;

export const shaderToyMaterial = {
    fs: `#version 300 es
    precision highp float;
    layout(std140) uniform ShaderToyBlock {
        vec4 iResolutionTime;
    };
    uniform sampler2D iChannel0;
    uniform sampler2D iChannel1;
    uniform sampler2D iChannel2;
    uniform sampler2D iChannel3;
    layout(location = 0) out vec4 fragmentColor;
    ${portableCoordinateShader}
    ${shaderToyCode}
    void main(void) {
        fragmentColor = render(gl_FragCoord.xy / iResolutionTime.xy);
    }
    `,
    primitiveMode: 'triangles'
} as const;

export const fragmentShader = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_diffuse;
layout(location = 0) out vec4 fragmentColor;
void main(void) {
    vec4 color = texture(u_diffuse, v_uv);
    if (color.a < 0.01) discard;
    fragmentColor = color;
}
`;

export const vertexShader = `#version 300 es
precision highp float;
in vec2 a_corner;
in vec2 a_uv;
in vec4 u_particleData;
in vec3 u_particleMotion;
out vec2 v_uv;

layout(std140) uniform FrameBlock {
    vec2 u_rendererSize;
    float u_time;
    float u_frameIndex;
};

layout(std140) uniform CameraBlock {
    mat4 u_viewMatrix;
    mat4 u_projectionMatrix;
    mat4 u_viewProjectionMatrix;
};

void main(void) {
    float angle = u_particleMotion.y + u_time * u_particleMotion.x;
    float sine = sin(angle);
    float cosine = cos(angle);
    vec2 rotatedXZ = mat2(cosine, sine, -sine, cosine) * u_particleData.xz;
    vec3 center = vec3(rotatedXZ.x, u_particleData.y, rotatedXZ.y);
    vec4 clipPosition = u_viewProjectionMatrix * vec4(center, 1.0);
    float pixelSize = clamp(u_particleData.w * 400.0 / max(abs(clipPosition.z), 1.0), 1.0, 128.0);
    clipPosition.xy += a_corner * pixelSize * (2.0 * clipPosition.w / u_rendererSize);
    v_uv = a_uv;
    gl_Position = clipPosition;
}
`;
