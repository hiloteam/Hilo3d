#include "./chunk/extensions.frag"
#include "./chunk/baseDefine.glsl"
#include "./chunk/precision.frag"
#include "./chunk/uniformBlocks.glsl"

#include "./chunk/color.frag"
#include "./chunk/uv.frag"
#include "./chunk/normal.frag"
#include "./chunk/lightFog.frag"
#include "./chunk/diffuse.frag"
#include "./chunk/light.frag"
#include "./chunk/phong.frag"
#include "./chunk/transparency.frag"
#include "./chunk/fog.frag"
#include "./chunk/logDepth.frag"
#include "./chunk/motionVector.frag"
#include "./chunk/materialAttributes.frag"
#ifdef HILO_PICKING_PASS
in vec4 v_objectIdColor;
#endif

void main(void) {
    #ifdef HILO_PICKING_PASS
        hilo_FragColor = v_objectIdColor;
    #elif defined(HILO_MOTION_VECTOR_PASS)
        {
            vec4 diffuse = vec4(0.0, 0.0, 0.0, 1.0);
            vec4 color = vec4(0.0, 0.0, 0.0, 1.0);
            #include "./chunk/diffuse_main.frag"
            #include "./chunk/transparency_main.frag"
            hilo_FragColor = hiloMotionData();
            #include "./chunk/logDepth_main.frag"
        }
    #elif defined(HILO_MATERIAL_ATTRIBUTES_PASS)
        {
            vec4 diffuse = vec4(0.0, 0.0, 0.0, 1.0);
            vec4 color = vec4(0.0, 0.0, 0.0, 1.0);
            #include "./chunk/normal_main.frag"
            #include "./chunk/diffuse_main.frag"
            #include "./chunk/transparency_main.frag"
            hilo_FragColor = hiloMaterialAttributes(normal, 1.0, 0.0, 0.0);
            #include "./chunk/logDepth_main.frag"
        }
    #else
        vec4 diffuse = vec4(0., 0., 0., 1.);
        vec4 color = vec4(0., 0., 0., 1.);

        #include "./chunk/normal_main.frag"
        #include "./chunk/lightFog_main.frag"
        #include "./chunk/diffuse_main.frag"
        #include "./chunk/phong_main.frag"
        #include "./chunk/transparency_main.frag"
        #include "./chunk/frag_color.frag"
        #include "./chunk/logDepth_main.frag"
    #endif
}
