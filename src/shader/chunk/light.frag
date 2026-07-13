#ifdef HILO_DIRECTIONAL_LIGHTS
    #ifdef HILO_DIRECTIONAL_LIGHTS_SMC
        uniform sampler2D u_directionalLightsShadowMap[HILO_DIRECTIONAL_LIGHTS_SMC];
    #endif
#endif

#ifdef HILO_SPOT_LIGHTS
    #ifdef HILO_SPOT_LIGHTS_SMC
        uniform sampler2D u_spotLightsShadowMap[HILO_SPOT_LIGHTS_SMC];
    #endif
#endif

#ifdef HILO_POINT_LIGHTS
    #ifdef HILO_POINT_LIGHTS_SMC
        uniform samplerCube u_pointLightsShadowMap[HILO_POINT_LIGHTS_SMC];
    #endif
#endif

#ifdef HILO_AREA_LIGHTS
    uniform sampler2D u_areaLightsLtcTexture1;
    uniform sampler2D u_areaLightsLtcTexture2;

    #include "../method/getAreaLight.glsl"
#endif

#ifdef HILO_AMBIENT_LIGHTS
#endif

#include "../method/getDiffuse.glsl"
#include "../method/getSpecular.glsl"
#include "../method/getLightAttenuation.glsl"
#include "../method/unpackFloat.glsl"
#include "../method/getShadow.glsl"
#include "./shadowSamplerDispatch.frag"
