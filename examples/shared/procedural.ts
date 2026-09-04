import { MaterialAttributeSemantic, ShaderMaterial } from 'hilo3d';

export function createProceduralMaterial(
    mode: 'plasma' | 'rings' | 'grid' = 'plasma'
): ShaderMaterial {
    const expression =
        mode === 'rings'
            ? '0.5 + 0.5 * cos(24.0 * length(v_position.xy) - u_time * 2.4)'
            : mode === 'grid'
              ? 'step(0.72, max(abs(sin(v_position.x * 18.0)), abs(sin(v_position.y * 18.0))))'
              : '0.5 + 0.5 * sin(v_position.x * 8.0 + sin(v_position.y * 7.0 + u_time * 1.7) + u_time)';
    return new ShaderMaterial({
        sourceRevision: `ecs-procedural-${mode}`,
        attributes: { a_position: MaterialAttributeSemantic.POSITION },
        state: { depthTest: true, depthWrite: true, cullMode: 'back' },
        vs: `#version 300 es
precision highp float;
in vec3 a_position;
out vec3 v_position;
layout(std140) uniform CameraBlock {
    mat4 u_viewMatrix;
    mat4 u_projectionMatrix;
    mat4 u_viewProjectionMatrix;
    mat4 u_previousViewMatrix;
    mat4 u_previousProjectionMatrix;
    mat4 u_previousViewProjectionMatrix;
    mat4 u_viewInverseMatrix;
    mat4 u_previousViewInverseMatrix;
    mat4 u_projectionInverseMatrix;
    mat3 u_viewInverseNormalMatrix;
    vec4 u_cameraPositionNear;
    vec4 u_cameraParams;
    vec4 u_renderOrigin;
    vec4 u_previousRenderOrigin;
    vec4 u_historyParams;
    vec4 u_viewport;
    mat4 u_nonJitteredProjectionMatrix;
    mat4 u_nonJitteredViewProjectionMatrix;
};
layout(std140) uniform ModelBlock {
    mat4 u_modelMatrix;
    mat4 u_previousModelMatrix;
    mat3 u_normalWorldMatrix;
    vec4 u_objectIdColor;
    vec4 u_modelHistoryParams;
    uvec4 u_modelLayerParams;
};
void main() {
    v_position = a_position;
    gl_Position = u_viewProjectionMatrix * u_modelMatrix * vec4(a_position, 1.0);
}`,
        fs: `#version 300 es
precision highp float;
in vec3 v_position;
layout(std140) uniform FrameBlock {
    vec2 u_rendererSize;
    float u_time;
    float u_frameIndex;
};
layout(location = 0) out vec4 fragmentColor;
void main() {
    float value = ${expression};
    vec3 cool = vec3(0.02, 0.18, 0.75);
    vec3 hot = vec3(1.2, 0.12, 0.72);
    fragmentColor = vec4(mix(cool, hot, value), 1.0);
}`
    });
}
