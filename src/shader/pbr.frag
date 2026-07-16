#include "./chunk/extensions.frag"
#include "./chunk/baseDefine.glsl"
#include "./chunk/precision.frag"

#include "./chunk/color.frag"
#include "./chunk/uv.frag"
#include "./chunk/normal.frag"
#include "./chunk/lightFog.frag"
#include "./chunk/pbr.frag"
#include "./chunk/light.frag"
#include "./chunk/transparency.frag"
#include "./chunk/fog.frag"
#include "./chunk/logDepth.frag"

void main(void) {
    vec4 color = vec4(0., 0., 0., 1.);

    #include "./chunk/normal_main.frag"
    #include "./chunk/lightFog_main.frag"
    #include "./chunk/pbr_main.frag"
    #include "./chunk/frag_color.frag"
    #include "./chunk/logDepth_main.frag"
}