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

#define u_cameraPosition u_cameraPositionNear.xyz
#define u_cameraNear u_cameraPositionNear.w
#define u_cameraFar u_cameraParams.x
#define u_cameraType u_cameraParams.y
#define u_logDepth u_cameraParams.z
#define u_reversedDepth u_cameraParams.w
#define u_cameraHistoryValid u_historyParams.x
