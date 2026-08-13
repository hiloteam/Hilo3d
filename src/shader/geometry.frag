#include "./chunk/extensions.frag"
#include "./chunk/baseDefine.glsl"
#include "./chunk/precision.frag"
#include "./chunk/uniformBlocks.glsl"

#if defined(HILO_VERTEX_TYPE_POSITION)
    in vec3 v_fragPos;
#elif defined(HILO_VERTEX_TYPE_NORMAL)
    in vec3 v_normal;
#elif defined(HILO_VERTEX_TYPE_DEPTH)
    #include "./method/packFloat.glsl"

#elif defined(HILO_VERTEX_TYPE_DISTANCE)
    #include "./method/packFloat.glsl"

    in vec3 v_fragPos;
#endif

vec4 transformDataToColor(vec3 data){
    #ifdef HILO_WRITE_ORIGIN_DATA
        return vec4(data, 1.0);
    #else
        return vec4(data * 0.5 + 0.5, 1.0);
    #endif
}

#include "./chunk/logDepth.frag"
#include "./chunk/motionVector.frag"
#include "./chunk/materialAttributes.frag"

void main(void) {
    #ifdef HILO_MOTION_VECTOR_PASS
        hilo_FragColor = hiloMotionData();
        hiloWriteTemporalReactiveMask();
        #include "./chunk/logDepth_main.frag"
    #elif defined(HILO_MATERIAL_ATTRIBUTES_PASS)
        #if defined(HILO_VERTEX_TYPE_NORMAL)
            hilo_FragColor = hiloMaterialAttributes(normalize(v_normal), 1.0, 0.0, 0.0);
        #else
            hilo_FragColor = hiloMaterialAttributes(vec3(0.0, 0.0, 1.0), 1.0, 0.0, 0.0);
        #endif
        #include "./chunk/logDepth_main.frag"
    #else
        #if defined(HILO_VERTEX_TYPE_POSITION)
            hilo_FragColor = transformDataToColor(v_fragPos);
        #elif defined(HILO_VERTEX_TYPE_NORMAL)
            hilo_FragColor = transformDataToColor(v_normal);
        #elif defined(HILO_VERTEX_TYPE_DEPTH)
            #ifdef HILO_WRITE_ORIGIN_DATA
                hilo_FragColor = vec4(gl_FragCoord.z, gl_FragCoord.z, gl_FragCoord.z, 1.0);
            #else
                hilo_FragColor = packFloat(gl_FragCoord.z);
            #endif
        #elif defined(HILO_VERTEX_TYPE_DISTANCE)
            float distance = length(v_fragPos);
            #ifdef HILO_WRITE_ORIGIN_DATA
                hilo_FragColor = vec4(distance, distance, distance, 1.0);
            #else
                hilo_FragColor = packFloat((distance - u_cameraNear)/(u_cameraFar - u_cameraNear));
            #endif
        #endif
        #include "./chunk/logDepth_main.frag"
    #endif
}
