#include "../method/textureEnvMap.glsl"
#include "./fixMathCrash.glsl"

#ifdef HILO_HAS_LIGHT
    #ifdef HILO_HAS_SPECULAR
        #ifdef HILO_SPECULAR_MAP
            uniform sampler2D u_specular;
        #else
        #endif
    #endif
    #ifdef HILO_EMISSION_MAP
        uniform sampler2D u_emission;
    #else
    #endif
    #ifdef HILO_AMBIENT_MAP
        uniform sampler2D u_ambient;
    #endif
    #ifdef HILO_SPECULAR_ENV_MAP
        #ifdef HILO_SPECULAR_ENV_MAP_CUBE
            uniform samplerCube u_specularEnvMap;
        #else
            uniform sampler2D u_specularEnvMap;
        #endif
    #endif
#endif
