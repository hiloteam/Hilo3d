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
#include "./chunk/transparency.frag"
#include "./chunk/fog.frag"
#include "./chunk/logDepth.frag"
#include "./chunk/motionVector.frag"

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
