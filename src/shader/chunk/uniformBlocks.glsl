#define HILO_MAX_DIRECTIONAL_LIGHTS 8
#define HILO_MAX_SPOT_LIGHTS 8
#define HILO_MAX_POINT_LIGHTS 16
#define HILO_MAX_AREA_LIGHTS 8
#define HILO_MAX_SKIN_JOINTS 128

layout(std140) uniform FrameBlock {
    vec2 u_rendererSize;
    float u_time;
    float u_frameIndex;
};

layout(std140) uniform CameraBlock {
    mat4 u_viewMatrix;
    mat4 u_projectionMatrix;
    mat4 u_viewProjectionMatrix;
    mat4 u_viewInverseMatrix;
    mat4 u_projectionInverseMatrix;
    mat3 u_viewInverseNormalMatrix;
    vec4 u_cameraPositionNear;
    vec4 u_cameraParams;
};

#define u_cameraPosition u_cameraPositionNear.xyz
#define u_cameraNear u_cameraPositionNear.w
#define u_cameraFar u_cameraParams.x
#define u_cameraType u_cameraParams.y
#define u_logDepth u_cameraParams.z

layout(std140) uniform SceneBlock {
    vec4 u_fogColor;
    vec4 u_fogInfo;
};

layout(std140) uniform LightBlock {
    vec3 u_ambientLightsColor;
    vec3 u_directionalLightsColor[HILO_MAX_DIRECTIONAL_LIGHTS];
    vec3 u_directionalLightsInfo[HILO_MAX_DIRECTIONAL_LIGHTS];
    vec2 u_directionalLightsShadowMapSize[HILO_MAX_DIRECTIONAL_LIGHTS];
    vec2 u_directionalLightsShadowBias[HILO_MAX_DIRECTIONAL_LIGHTS];
    mat4 u_directionalLightSpaceMatrix[HILO_MAX_DIRECTIONAL_LIGHTS];
    vec3 u_spotLightsPos[HILO_MAX_SPOT_LIGHTS];
    vec3 u_spotLightsDir[HILO_MAX_SPOT_LIGHTS];
    vec3 u_spotLightsColor[HILO_MAX_SPOT_LIGHTS];
    vec2 u_spotLightsCutoffs[HILO_MAX_SPOT_LIGHTS];
    vec3 u_spotLightsInfo[HILO_MAX_SPOT_LIGHTS];
    float u_spotLightsRange[HILO_MAX_SPOT_LIGHTS];
    vec2 u_spotLightsShadowMapSize[HILO_MAX_SPOT_LIGHTS];
    vec2 u_spotLightsShadowBias[HILO_MAX_SPOT_LIGHTS];
    mat4 u_spotLightSpaceMatrix[HILO_MAX_SPOT_LIGHTS];
    vec3 u_pointLightsPos[HILO_MAX_POINT_LIGHTS];
    vec3 u_pointLightsColor[HILO_MAX_POINT_LIGHTS];
    vec3 u_pointLightsInfo[HILO_MAX_POINT_LIGHTS];
    float u_pointLightsRange[HILO_MAX_POINT_LIGHTS];
    vec2 u_pointLightsShadowBias[HILO_MAX_POINT_LIGHTS];
    mat4 u_pointLightSpaceMatrix[HILO_MAX_POINT_LIGHTS];
    vec2 u_pointLightCamera[HILO_MAX_POINT_LIGHTS];
    vec3 u_areaLightsPos[HILO_MAX_AREA_LIGHTS];
    vec3 u_areaLightsColor[HILO_MAX_AREA_LIGHTS];
    vec3 u_areaLightsWidth[HILO_MAX_AREA_LIGHTS];
    vec3 u_areaLightsHeight[HILO_MAX_AREA_LIGHTS];
};

layout(std140) uniform MaterialBlock {
    vec4 u_diffuseColor;
    vec4 u_specularColor;
    vec4 u_ambientColor;
    vec4 u_emissionColor;
    vec4 u_baseColor;
    vec4 u_emissionFactor;
    vec3 u_diffuseEnvSphereHarmonics3[9];
    mat4 u_specularEnvMatrix;
    mat3 u_uvMatrix;
    mat3 u_uvMatrix1;
    float u_normalMapScale;
    float u_transparencyFactor;
    float u_alphaCutoff;
    float u_exposure;
    float u_gammaFactor;
    float u_shininess;
    float u_reflectivity;
    float u_refractRatio;
    float u_refractivity;
    float u_metallic;
    float u_roughness;
    float u_occlusionStrength;
    float u_diffuseEnvIntensity;
    float u_specularEnvIntensity;
    float u_specularEnvMapMipCount;
    float u_glossiness;
    float u_clearcoatFactor;
    float u_clearcoatRoughnessFactor;
    float u_materialPadding;
};

#ifdef HILO_VERTEX_SHADER
#ifdef HILO_INSTANCED
    in mat4 u_modelMatrix;
    in mat3 u_normalWorldMatrix;
#else
    layout(std140) uniform ModelBlock {
        mat4 u_modelMatrix;
        mat3 u_normalWorldMatrix;
    };
#endif

layout(std140) uniform GeometryBlock {
        mat4 u_positionDecodeMat;
        mat4 u_normalDecodeMat;
        mat3 u_uvDecodeMat;
        mat3 u_uv1DecodeMat;
};

#ifdef HILO_JOINT_COUNT
    layout(std140) uniform SkinningBlock {
        mat4 u_jointMat[HILO_MAX_SKIN_JOINTS];
    };
#endif

#ifdef HILO_MORPH_TARGET_COUNT
    layout(std140) uniform MorphBlock {
        vec4 u_morphWeights0;
        vec4 u_morphWeights1;
    };

    float hiloMorphWeight(int index) {
        return index < 4 ? u_morphWeights0[index] : u_morphWeights1[index - 4];
    }
#endif
#endif
