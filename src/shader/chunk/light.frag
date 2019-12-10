#ifdef HILO_DIRECTIONAL_LIGHTS
    uniform vec3 u_directionalLightsColor[HILO_DIRECTIONAL_LIGHTS];
    uniform vec3 u_directionalLightsInfo[HILO_DIRECTIONAL_LIGHTS];
    #ifdef HILO_DIRECTIONAL_LIGHTS_SMC
        uniform sampler2D u_directionalLightsShadowMap[HILO_DIRECTIONAL_LIGHTS_SMC];
        uniform vec2 u_directionalLightsShadowMapSize[HILO_DIRECTIONAL_LIGHTS_SMC];
        uniform mat4 u_directionalLightSpaceMatrix[HILO_DIRECTIONAL_LIGHTS_SMC];
        uniform vec2 u_directionalLightsShadowBias[HILO_DIRECTIONAL_LIGHTS_SMC];
    #endif
#endif

#ifdef HILO_SPOT_LIGHTS
    uniform vec3 u_spotLightsPos[HILO_SPOT_LIGHTS];
    uniform vec3 u_spotLightsDir[HILO_SPOT_LIGHTS];
    uniform vec3 u_spotLightsColor[HILO_SPOT_LIGHTS];
    uniform vec2 u_spotLightsCutoffs[HILO_SPOT_LIGHTS];
    uniform vec3 u_spotLightsInfo[HILO_SPOT_LIGHTS];
    uniform float u_spotLightsRange[HILO_SPOT_LIGHTS];
    #ifdef HILO_SPOT_LIGHTS_SMC
        uniform sampler2D u_spotLightsShadowMap[HILO_SPOT_LIGHTS_SMC];
        uniform vec2 u_spotLightsShadowMapSize[HILO_SPOT_LIGHTS_SMC];
        uniform mat4 u_spotLightSpaceMatrix[HILO_SPOT_LIGHTS_SMC];
        uniform vec2 u_spotLightsShadowBias[HILO_SPOT_LIGHTS_SMC];
    #endif
#endif

#ifdef HILO_POINT_LIGHTS
    uniform vec3 u_pointLightsPos[HILO_POINT_LIGHTS];
    uniform vec3 u_pointLightsColor[HILO_POINT_LIGHTS];
    uniform vec3 u_pointLightsInfo[HILO_POINT_LIGHTS];
    uniform float u_pointLightsRange[HILO_POINT_LIGHTS];
    #ifdef HILO_POINT_LIGHTS_SMC
        uniform samplerCube u_pointLightsShadowMap[HILO_POINT_LIGHTS_SMC];
        uniform mat4 u_pointLightSpaceMatrix[HILO_POINT_LIGHTS_SMC];
        uniform vec2 u_pointLightsShadowBias[HILO_POINT_LIGHTS_SMC];
        uniform vec2 u_pointLightCamera[HILO_POINT_LIGHTS_SMC];
    #endif
#endif

#ifdef HILO_AREA_LIGHTS
    uniform vec3 u_areaLightsPos[HILO_AREA_LIGHTS];
    uniform vec3 u_areaLightsColor[HILO_AREA_LIGHTS];
    uniform vec3 u_areaLightsWidth[HILO_AREA_LIGHTS];
    uniform vec3 u_areaLightsHeight[HILO_AREA_LIGHTS];
    uniform sampler2D u_areaLightsLtcTexture1;
    uniform sampler2D u_areaLightsLtcTexture2;

    #pragma glslify: import('../method/getAreaLight.glsl');
#endif

#ifdef HILO_AMBIENT_LIGHTS
    uniform vec3 u_ambientLightsColor;
#endif

#pragma glslify: import('../method/getDiffuse.glsl');
#pragma glslify: import('../method/getSpecular.glsl');
#pragma glslify: import('../method/getLightAttenuation.glsl');
#pragma glslify: import('../method/unpackFloat.glsl');
#pragma glslify: import('../method/getShadow.glsl');