#ifdef HILO_HAS_LIGHT
    vec3 lightDiffuse = vec3(0, 0, 0);
    vec3 lightAmbient = vec3(0, 0, 0);
    vec3 viewPos = vec3(0, 0, 0);

    #ifdef HILO_AMBIENT_MAP
        lightAmbient = HILO_TEXTURE_2D(u_ambient).rgb;
    #else
        lightAmbient = diffuse.rgb;
    #endif

    #ifdef HILO_HAS_SPECULAR
        vec3 lightSpecular = vec3(0, 0, 0);
        #ifdef HILO_SPECULAR_MAP
            vec4 specular = HILO_TEXTURE_2D(u_specular);
        #else
            vec4 specular = u_specular;
        #endif
    #endif
    
    #ifdef HILO_EMISSION_MAP
        vec4 emission = HILO_TEXTURE_2D(u_emission);
    #else
        vec4 emission = u_emission;
    #endif

    #ifdef HILO_DIRECTIONAL_LIGHTS
        for(int i = 0;i < HILO_DIRECTIONAL_LIGHTS;i++){
            vec3 lightDir = -u_directionalLightsInfo[i];

            float shadow = 1.0;
            #ifdef HILO_DIRECTIONAL_LIGHTS_SMC
                if (i < HILO_DIRECTIONAL_LIGHTS_SMC) {
                    float bias = HILO_MAX(u_directionalLightsShadowBias[i][1] * (1.0 - dot(normal, lightDir)), u_directionalLightsShadowBias[i][0]);
                    shadow = getShadow(u_directionalLightsShadowMap[i], u_directionalLightsShadowMapSize[i], bias, v_fragPos, u_directionalLightSpaceMatrix[i]);
                }
            #endif

            float diff = getDiffuse(normal, lightDir);
            lightDiffuse += diff * u_directionalLightsColor[i] * shadow;

            #ifdef HILO_HAS_SPECULAR
                float spec = getSpecular(viewPos, v_fragPos, lightDir, normal, u_shininess);
                lightSpecular += spec * u_directionalLightsColor[i] * shadow;
            #endif
        }
    #endif

    #ifdef HILO_SPOT_LIGHTS
        for(int i = 0; i < HILO_SPOT_LIGHTS; i++){
            vec3 lightDir = -u_spotLightsDir[i];
            vec3 distanceVec = u_spotLightsPos[i] - v_fragPos;

            float shadow = 1.0;
            #ifdef HILO_SPOT_LIGHTS_SMC
                if (i < HILO_SPOT_LIGHTS_SMC) {
                    float bias = HILO_MAX(u_spotLightsShadowBias[i][1] * (1.0 - dot(normal, lightDir)), u_spotLightsShadowBias[i][0]);
                    shadow = getShadow(u_spotLightsShadowMap[i], u_spotLightsShadowMapSize[i], bias, v_fragPos, u_spotLightSpaceMatrix[i]);
                }
            #endif
            
            float diff = getDiffuse(normal, normalize(distanceVec));
            float theta = dot(normalize(distanceVec), lightDir);
            float epsilon = u_spotLightsCutoffs[i][0] - u_spotLightsCutoffs[i][1];
            float intensity = clamp((theta - u_spotLightsCutoffs[i][1]) / epsilon, 0.0, 1.0);
            float attenuation = getLightAttenuation(distanceVec, u_spotLightsInfo[i], u_spotLightsRange[i]);

            lightDiffuse += intensity * attenuation * shadow * diff * u_spotLightsColor[i];

            #ifdef HILO_HAS_SPECULAR
                float spec = getSpecular(viewPos, v_fragPos, lightDir, normal, u_shininess);
                lightSpecular += intensity * attenuation * shadow * spec * u_spotLightsColor[i];
            #endif
        }
    #endif

    #ifdef HILO_POINT_LIGHTS
        for(int i = 0;i < HILO_POINT_LIGHTS;i++){
            vec3 distanceVec = u_pointLightsPos[i] - v_fragPos;
            vec3 lightDir = normalize(distanceVec);

            float shadow = 1.0;
            #ifdef HILO_POINT_LIGHTS_SMC
                if (i < HILO_POINT_LIGHTS_SMC) {
                    float bias = HILO_MAX(u_pointLightsShadowBias[i][1] * (1.0 - dot(normal, lightDir)), u_pointLightsShadowBias[i][0]);
                    shadow = getShadow(u_pointLightsShadowMap[i], bias, u_pointLightsPos[i], v_fragPos, u_pointLightCamera[i], u_pointLightSpaceMatrix[i]);
                }
            #endif
            
            float diff = getDiffuse(normal, lightDir);
            float attenuation = getLightAttenuation(distanceVec, u_pointLightsInfo[i], u_pointLightsRange[i]);
            lightDiffuse += diff * attenuation * u_pointLightsColor[i] * shadow;

            #ifdef HILO_HAS_SPECULAR
                float spec = getSpecular(viewPos, v_fragPos, lightDir, normal, u_shininess);
                lightSpecular += spec * attenuation * u_pointLightsColor[i] * shadow;
            #endif
        }
    #endif

    #ifdef HILO_AREA_LIGHTS
        #ifndef HILO_HAS_SPECULAR
            vec4 specular = vec4(0.0, 0.0, 0.0, 0.0);
        #endif
        vec3 viewDir = normalize(vec3(0, 0, 0) - v_fragPos);
        for(int i = 0; i < HILO_AREA_LIGHTS; i++){
            color.rgb += getAreaLight(diffuse.rgb, specular.rgb, sqrt(2.0/(u_shininess+2.0)), normal, viewDir, v_fragPos, u_areaLightsPos[i], u_areaLightsColor[i], u_areaLightsWidth[i], u_areaLightsHeight[i], u_areaLightsLtcTexture1, u_areaLightsLtcTexture2);
        }
    #endif

    #ifdef HILO_AMBIENT_LIGHTS
        color.rgb += u_ambientLightsColor * lightAmbient;
    #endif

    #if defined(HILO_SPECULAR_ENV_MAP) && defined(HILO_HAS_SPECULAR)
        vec3 I = normalize(v_fragPos - viewPos);
        if (u_reflectivity > 0.0) {
            vec3 R = reflect(I, normal);
            R = normalize(vec3(u_specularEnvMatrix * vec4(R, 1.0)));
            lightSpecular += textureEnvMap(u_specularEnvMap, R).rgb * u_reflectivity;
        }
        if (u_refractivity > 0.0) {
            vec3 R = refract(I, normal, u_refractRatio);
            R = normalize(vec3(u_specularEnvMatrix * vec4(R, 1.0)));
            lightSpecular += textureEnvMap(u_specularEnvMap, R).rgb * u_refractivity;
        }
    #endif

    color.rgb += lightDiffuse * diffuse.rgb;
    #ifdef HILO_HAS_SPECULAR
        color.rgb += lightSpecular * specular.rgb;
    #endif

    color.rgb += emission.rgb;
#else
    color = diffuse;
#endif