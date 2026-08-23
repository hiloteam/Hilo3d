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
            hilo_FragColor = hiloMaterialAttributes(
                normal,
                materialRoughness,
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
