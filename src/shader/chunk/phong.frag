#pragma glslify: import('../method/textureEnvMap.glsl');
#pragma glslify: import('./fixMathCrash.glsl');

#ifdef HILO_HAS_LIGHT
    #ifdef HILO_HAS_SPECULAR
        uniform float u_shininess;
        #ifdef HILO_SPECULAR_MAP
            uniform HILO_SAMPLER_2D u_specular;
        #else
            uniform vec4 u_specular;
        #endif
    #endif
    #ifdef HILO_EMISSION_MAP
        uniform HILO_SAMPLER_2D u_emission;
    #else
        uniform vec4 u_emission;
    #endif
    #ifdef HILO_AMBIENT_MAP
        uniform HILO_SAMPLER_2D u_ambient;
    #endif
    #ifdef HILO_SPECULAR_ENV_MAP
        #ifdef HILO_SPECULAR_ENV_MAP_CUBE
            uniform samplerCube u_specularEnvMap;
        #else
            uniform sampler2D u_specularEnvMap;
        #endif
        uniform mat4 u_specularEnvMatrix;
        uniform float u_reflectivity;
        uniform float u_refractRatio;
        uniform float u_refractivity;
    #endif
#endif