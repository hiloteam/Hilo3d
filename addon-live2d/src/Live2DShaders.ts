import type { Live2DBlendMode } from './Live2DSource.js';
import { Shader, type MaterialCompositing } from 'hilo3d';

const coordinates: unknown = Shader.shaders['method/portableCoordinates.glsl'];
if (typeof coordinates !== 'string')
    throw new Error('Hilo3D portable coordinates are unavailable.');
const coordinateSource = coordinates;

export const live2DVertexSource = `#version 300 es
precision highp float;
in vec3 a_position;
in vec2 a_uv;
out vec2 v_uv;
out vec2 v_modelPosition;
layout(std140) uniform CameraBlock {
    mat4 u_viewMatrix;
    mat4 u_projectionMatrix;
    mat4 u_viewProjectionMatrix;
};
layout(std140) uniform ModelBlock { mat4 u_modelMatrix; };
void main() {
    gl_Position = u_viewProjectionMatrix * u_modelMatrix * vec4(a_position, 1.0);
    v_modelPosition = a_position.xy;
    // Cubism UVs are bottom-left. Convert to engine logical image UVs before sampling.
    v_uv = vec2(a_uv.x, 1.0 - a_uv.y);
}`;

const drawBlock = `layout(std140) uniform Live2DDrawBlock {
    vec4 u_multiplyColor;
    vec4 u_screenColor;
    vec4 u_drawParams;
    vec4 u_maskTransform;
};`;

export const live2DMaskVertexSource = `#version 300 es
precision highp float;
in vec3 a_position;
in vec2 a_uv;
out vec2 v_uv;
${drawBlock}
void main() {
    // Masks use model coordinates, so all cameras sample the same coverage in one frame.
    vec2 maskUV = a_position.xy * u_maskTransform.xy + u_maskTransform.zw;
    gl_Position = vec4(maskUV * 2.0 - 1.0, 0.0, 1.0);
    v_uv = vec2(a_uv.x, 1.0 - a_uv.y);
}`;

export const live2DMaskFragmentSource = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_image;
layout(location = 0) out vec4 color;
${coordinateSource}
void main() {
    float coverage = texture(u_image, hiloTextureUV(v_uv)).a;
    color = vec4(coverage);
}`;

export function live2DFragmentSource(masked: boolean): string {
    return `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_modelPosition;
uniform sampler2D u_image;
${masked ? 'uniform sampler2D u_mask;' : ''}
${drawBlock}
layout(location = 0) out vec4 color;
${coordinateSource}
vec3 srgbToLinear(vec3 value) {
    return mix(value / 12.92, pow((value + 0.055) / 1.055, vec3(2.4)),
        step(vec3(0.04045), value));
}
void main() {
    vec4 texel = texture(u_image, hiloTextureUV(v_uv));
    vec3 rgb = texel.rgb * u_multiplyColor.rgb;
    rgb = rgb + u_screenColor.rgb - rgb * u_screenColor.rgb;
    float opacity = texel.a * u_drawParams.x;
    ${
        masked
            ? `// Model-local XY maps to the documented bottom-left render-target input convention.
    vec2 maskUV = v_modelPosition * u_maskTransform.xy + u_maskTransform.zw;
    float coverage = texture(u_mask, hiloRenderTargetUV(maskUV)).a;
    opacity *= mix(coverage, 1.0 - coverage, u_drawParams.y);`
            : ''
    }
    color = vec4(srgbToLinear(rgb) * opacity, opacity);
}`;
}

export function live2DCompositing(mode: Live2DBlendMode): MaterialCompositing {
    if (mode === 'normal') return { mode: 'alpha-blend', premultiplied: true };
    return {
        mode: 'custom',
        depthWrite: false,
        blend: {
            color: {
                operation: 'add',
                srcFactor: mode === 'additive' ? 'one' : 'dst',
                dstFactor: mode === 'additive' ? 'one' : 'one-minus-src-alpha'
            },
            alpha: { operation: 'add', srcFactor: 'zero', dstFactor: 'one' }
        }
    };
}
