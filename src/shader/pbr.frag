#include "./chunk/extensions.frag"
#include "./chunk/baseDefine.glsl"
#include "./chunk/precision.frag"
#include "./chunk/uniformBlocks.glsl"

#include "./chunk/color.frag"
#include "./chunk/uv.frag"
#include "./chunk/normal.frag"
#include "./chunk/lightFog.frag"
#include "./chunk/pbr.frag"
#include "./chunk/light.frag"
#include "./chunk/clusteredForward.frag"
#include "./chunk/transparency.frag"
#include "./chunk/fog.frag"
#include "./chunk/logDepth.frag"
#include "./chunk/motionVector.frag"
#include "./chunk/materialAttributes.frag"

void main(void) {
    #ifdef HILO_MOTION_VECTOR_PASS
        {
            vec4 baseColorSample = vec4(1.0);
            #ifdef HILO_BASE_COLOR_MAP
                baseColorSample = HILO_TEXTURE_2D(u_baseColorMap, HILO_BASE_COLOR_MAP);
            #endif
            vec4 color = hiloEvaluatePBRBaseColor(u_baseColor, baseColorSample);
            #ifdef HILO_HAS_COLOR
                color *= v_color;
            #endif
            #include "./chunk/transparency_main.frag"
            hilo_FragColor = hiloMotionData();
            hiloWriteTemporalReactiveMask();
            #include "./chunk/logDepth_main.frag"
        }
    #elif defined(HILO_MATERIAL_ATTRIBUTES_PASS)
        {
            vec4 baseColorSample = vec4(1.0);
            #ifdef HILO_BASE_COLOR_MAP
                baseColorSample = HILO_TEXTURE_2D(u_baseColorMap, HILO_BASE_COLOR_MAP);
            #endif
            vec4 color = hiloEvaluatePBRBaseColor(u_baseColor, baseColorSample);
            #ifdef HILO_HAS_COLOR
                color *= v_color;
            #endif
            #include "./chunk/transparency_main.frag"
            #include "./chunk/normal_main.frag"

            #ifdef HILO_PBR_SPECULAR_GLOSSINESS
                float materialRoughness = 1.0 - u_glossiness;
                #ifdef HILO_SPECULAR_GLOSSINESS_MAP
                    materialRoughness = 1.0 - u_glossiness * HILO_TEXTURE_2D(
                        u_specularGlossinessMap,
                        HILO_SPECULAR_GLOSSINESS_MAP
                    ).a;
                #endif
                float materialMetallic = 0.0;
            #else
                float materialRoughness = u_roughness;
                float materialMetallic = u_metallic;
                #ifdef HILO_METALLIC_MAP
                    materialMetallic *= HILO_TEXTURE_2D(
                        u_metallicMap,
                        HILO_METALLIC_MAP
                    ).r;
                #endif
                #ifdef HILO_ROUGHNESS_MAP
                    materialRoughness *= HILO_TEXTURE_2D(
                        u_roughnessMap,
                        HILO_ROUGHNESS_MAP
                    ).r;
                #endif
                #ifdef HILO_METALLIC_ROUGHNESS_MAP
                    vec4 materialMetallicRoughness = HILO_TEXTURE_2D(
                        u_metallicRoughnessMap,
                        HILO_METALLIC_ROUGHNESS_MAP
                    );
                    materialRoughness *= materialMetallicRoughness.g;
                    materialMetallic *= materialMetallicRoughness.b;
                #endif
            #endif
            vec3 reflectionTraceNormal = normal;
            float reflectionTraceRoughness = materialRoughness;
            #ifdef HILO_SSR_MATERIAL_DATA
                vec3 reflectionResponse = vec3(0.0);
                vec3 fallbackSpecular = vec3(0.0);
                vec3 reflectionAnisotropyT = normal;
                float reflectionAnisotropyStrength = 0.0;
                float reflectionClearcoatFactor = 0.0;
                float reflectionClearcoatRoughness = materialRoughness;
                #ifdef HILO_HAS_LIGHT
                    vec3 reflectionView = normalize(-v_fragPos);
                    #ifdef HILO_HAS_ANISOTROPY
                        vec2 reflectionAnisotropyDirection = vec2(
                            cos(u_anisotropyRotation),
                            sin(u_anisotropyRotation)
                        );
                        reflectionAnisotropyStrength = clamp(
                            u_anisotropyStrength,
                            0.0,
                            1.0
                        );
                        #ifdef HILO_ANISOTROPY_MAP
                            vec3 reflectionAnisotropySample = HILO_TEXTURE_2D(
                                u_anisotropyMap,
                                HILO_ANISOTROPY_MAP
                            ).rgb;
                            vec2 reflectionTextureDirection =
                                reflectionAnisotropySample.rg * 2.0 - 1.0;
                            float reflectionTextureDirectionLength =
                                length(reflectionTextureDirection);
                            if (reflectionTextureDirectionLength > 1e-4) {
                                reflectionTextureDirection /=
                                    reflectionTextureDirectionLength;
                                reflectionAnisotropyDirection = vec2(
                                    reflectionAnisotropyDirection.x *
                                        reflectionTextureDirection.x -
                                        reflectionAnisotropyDirection.y *
                                        reflectionTextureDirection.y,
                                    reflectionAnisotropyDirection.x *
                                        reflectionTextureDirection.y +
                                        reflectionAnisotropyDirection.y *
                                        reflectionTextureDirection.x
                                );
                            }
                            reflectionAnisotropyStrength *=
                                reflectionAnisotropySample.b;
                        #endif
                        reflectionAnisotropyT = normalize(
                            v_TBN * vec3(reflectionAnisotropyDirection, 0.0)
                        );
                        reflectionAnisotropyT = normalize(
                            reflectionAnisotropyT - normal *
                                dot(reflectionAnisotropyT, normal)
                        );
                        vec3 reflectionAnisotropicNormal = cross(
                            reflectionAnisotropyT,
                            reflectionView
                        );
                        reflectionAnisotropicNormal = normalize(cross(
                            reflectionAnisotropicNormal,
                            reflectionAnisotropyT
                        ));
                        float reflectionAnisotropyBend =
                            reflectionAnisotropyStrength *
                            (1.0 - materialRoughness);
                        reflectionTraceNormal = normalize(mix(
                            normal,
                            reflectionAnisotropicNormal,
                            reflectionAnisotropyBend
                        ));
                    #endif
                    #ifdef HILO_HAS_CLEARCOAT
                        reflectionClearcoatFactor = clamp(
                            u_clearcoatFactor,
                            0.0,
                            1.0
                        );
                        #ifdef HILO_CLEARCOAT_MAP
                            reflectionClearcoatFactor *= HILO_TEXTURE_2D(
                                u_clearcoatMap,
                                HILO_CLEARCOAT_MAP
                            ).r;
                        #endif
                        reflectionClearcoatRoughness = clamp(
                            u_clearcoatRoughnessFactor,
                            0.045,
                            1.0
                        );
                        #ifdef HILO_CLEARCOAT_ROUGHNESS_MAP
                            reflectionClearcoatRoughness *= HILO_TEXTURE_2D(
                                u_clearcoatRoughnessMap,
                                HILO_CLEARCOAT_ROUGHNESS_MAP
                            ).g;
                        #endif
                        float reflectionTraceClearcoatFresnel =
                            hiloFresnelSchlickScalar(
                                0.04,
                                max(abs(dot(clearcoatNormal, reflectionView)), 1e-4)
                            );
                        float reflectionClearcoatDominance = clamp(
                            reflectionClearcoatFactor *
                                reflectionTraceClearcoatFresnel,
                            0.0,
                            1.0
                        );
                        reflectionTraceNormal = normalize(mix(
                            reflectionTraceNormal,
                            clearcoatNormal,
                            reflectionClearcoatDominance
                        ));
                        reflectionTraceRoughness = mix(
                            materialRoughness,
                            reflectionClearcoatRoughness,
                            reflectionClearcoatDominance
                        );
                    #endif
                    float reflectionNdotV = max(abs(dot(normal, reflectionView)), 1e-4);
                    float reflectionAO = 1.0;
                    #ifdef HILO_OCCLUSION_MAP
                        reflectionAO = HILO_TEXTURE_2D(
                            u_occlusionMap,
                            HILO_OCCLUSION_MAP
                        ).r;
                    #endif
                    #ifdef HILO_OCCLUSION_STRENGTH
                        reflectionAO = hiloEvaluatePBROcclusion(
                            reflectionAO,
                            u_occlusionStrength
                        );
                    #endif
                    #ifdef HILO_GTAO
                        vec2 reflectionGTAOUV =
                            (gl_FragCoord.xy - u_viewport.xy) /
                            max(u_viewport.zw, vec2(1.0));
                        reflectionAO *= clamp(
                            texture(u_gtaoTexture, reflectionGTAOUV).b,
                            0.0,
                            1.0
                        );
                    #endif
                    #ifdef HILO_PBR_SPECULAR_GLOSSINESS
                        vec3 reflectionF0 = u_specularColor.rgb;
                        #ifdef HILO_SPECULAR_GLOSSINESS_MAP
                            reflectionF0 *= HILO_TEXTURE_2D(
                                u_specularGlossinessMap,
                                HILO_SPECULAR_GLOSSINESS_MAP
                            ).rgb;
                        #endif
                    #else
                        HiloMetallicRoughnessSurface reflectionSurface =
                            hiloEvaluateMetallicRoughnessSurface(
                                color,
                                u_emissionFactor.rgb,
                                materialMetallic,
                                materialRoughness,
                                reflectionAO,
                                0.0,
                                u_ior
                            );
                        vec3 reflectionF0 = reflectionSurface.specularColor;
                    #endif
                    #ifdef HILO_SPECULAR_ENV_MAP
                        vec2 reflectionDFG = texture(
                            u_brdfLUT,
                            hiloTextureUV(vec2(
                                reflectionNdotV,
                                1.0 - materialRoughness
                            ))
                        ).rg;
                        vec3 reflectionEnergyCompensation = vec3(1.0) +
                            reflectionF0 *
                            (1.0 / max(reflectionDFG.y, 0.04) - 1.0);
                        reflectionResponse =
                            (reflectionF0 * reflectionDFG.x + reflectionDFG.y) *
                            reflectionEnergyCompensation;
                    #else
                        reflectionResponse = hiloFresnelSchlick(
                            reflectionF0,
                            reflectionNdotV
                        );
                    #endif
                    float reflectionIridescenceFactor = 0.0;
                    float reflectionIridescenceIor = 1.3;
                    float reflectionIridescenceThickness = 0.0;
                    #ifdef HILO_HAS_IRIDESCENCE
                        reflectionIridescenceFactor = clamp(
                            u_iridescenceFactor,
                            0.0,
                            1.0
                        );
                        reflectionIridescenceIor = max(u_iridescenceIor, 1.0);
                        #ifdef HILO_IRIDESCENCE_MAP
                            reflectionIridescenceFactor *= HILO_TEXTURE_2D(
                                u_iridescenceMap,
                                HILO_IRIDESCENCE_MAP
                            ).r;
                        #endif
                        reflectionIridescenceThickness = max(
                            u_iridescenceThicknessMaximum,
                            0.0
                        );
                        #ifdef HILO_IRIDESCENCE_THICKNESS_MAP
                            float reflectionIridescenceThicknessSample =
                                HILO_TEXTURE_2D(
                                    u_iridescenceThicknessMap,
                                    HILO_IRIDESCENCE_THICKNESS_MAP
                                ).g;
                            reflectionIridescenceThickness = mix(
                                u_iridescenceThicknessMinimum,
                                u_iridescenceThicknessMaximum,
                                reflectionIridescenceThicknessSample
                            );
                        #endif
                        if (reflectionIridescenceThickness <= 0.0) {
                            reflectionIridescenceFactor = 0.0;
                        }
                        reflectionResponse = mix(
                            reflectionResponse,
                            hiloEvaluateIridescence(
                                1.0,
                                reflectionIridescenceIor,
                                reflectionNdotV,
                                reflectionIridescenceThickness,
                                reflectionF0
                            ),
                            reflectionIridescenceFactor
                        );
                    #endif
                    float reflectionSpecularAO = clamp(
                        pow(
                            reflectionNdotV + reflectionAO,
                            exp2(-16.0 * materialRoughness - 1.0)
                        ) - 1.0 + reflectionAO,
                        0.0,
                        1.0
                    );
                    vec3 reflectionRay = -normalize(reflect(
                        reflectionView,
                        normal
                    ));
                    float reflectionHorizon = min(
                        1.0 + dot(reflectionRay, normal),
                        1.0
                    );
                    reflectionResponse *= reflectionSpecularAO *
                        reflectionHorizon * reflectionHorizon;
                    fallbackSpecular = hiloGetIBLSpecular(
                        normal,
                        reflectionView,
                        reflectionAnisotropyT,
                        reflectionF0,
                        materialRoughness,
                        reflectionAnisotropyStrength,
                        reflectionIridescenceFactor,
                        reflectionIridescenceIor,
                        reflectionIridescenceThickness,
                        reflectionAO
                    );
                    #ifdef HILO_HAS_CLEARCOAT
                        float reflectionClearcoatFresnel =
                            hiloFresnelSchlickScalar(
                                0.04,
                                max(abs(dot(clearcoatNormal, reflectionView)), 1e-4)
                            );
                        reflectionResponse = reflectionResponse *
                            (1.0 - reflectionClearcoatFactor * reflectionClearcoatFresnel) +
                            vec3(reflectionClearcoatFactor * reflectionClearcoatFresnel);
                        fallbackSpecular = fallbackSpecular *
                            (1.0 - reflectionClearcoatFactor * reflectionClearcoatFresnel) +
                            reflectionClearcoatFactor * hiloGetIBLClearcoat(
                                clearcoatNormal,
                                reflectionView,
                                reflectionClearcoatRoughness
                            );
                    #endif
                #endif
                hiloWriteMaterialReflectionData(reflectionResponse, fallbackSpecular);
            #endif
            hilo_FragColor = hiloMaterialAttributes(
                reflectionTraceNormal,
                reflectionTraceRoughness,
                materialMetallic,
                1.0
            );
            #include "./chunk/logDepth_main.frag"
        }
    #else
        vec4 color = vec4(0., 0., 0., 1.);

        #include "./chunk/normal_main.frag"
        #include "./chunk/lightFog_main.frag"
        #include "./chunk/pbr_main.frag"
        #include "./chunk/frag_color.frag"
        #include "./chunk/logDepth_main.frag"
    #endif
}
