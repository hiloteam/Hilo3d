#include "./chunk/extensions.frag"
#include "./chunk/baseDefine.glsl"
#include "./chunk/precision.frag"

#if defined(HILO_VERTEX_TYPE_POSITION)
    varying vec3 v_fragPos;
#elif defined(HILO_VERTEX_TYPE_NORMAL)
    varying vec3 v_normal;
#elif defined(HILO_VERTEX_TYPE_DEPTH)
    #include "./method/packFloat.glsl"

    uniform float u_cameraFar;
    uniform float u_cameraNear;
    uniform float u_cameraType;
#elif defined(HILO_VERTEX_TYPE_DISTANCE)
    #include "./method/packFloat.glsl"

    uniform float u_cameraFar;
    uniform float u_cameraNear;
    varying vec3 v_fragPos;
#endif

vec4 transformDataToColor(vec3 data){
    #ifdef HILO_WRITE_ORIGIN_DATA
        return vec4(data, 1.0);
    #else
        return vec4(data * 0.5 + 0.5, 1.0);
    #endif
}

#include "./chunk/logDepth.frag"

void main(void) {
    #if defined(HILO_VERTEX_TYPE_POSITION)
        gl_FragColor = transformDataToColor(v_fragPos);
    #elif defined(HILO_VERTEX_TYPE_NORMAL)
        gl_FragColor = transformDataToColor(v_normal);
    #elif defined(HILO_VERTEX_TYPE_DEPTH)
        #ifdef HILO_WRITE_ORIGIN_DATA
            gl_FragColor = vec4(gl_FragCoord.z, gl_FragCoord.z, gl_FragCoord.z, 1.0);
        #else
            gl_FragColor = packFloat(gl_FragCoord.z);
        #endif
    #elif defined(HILO_VERTEX_TYPE_DISTANCE)
        float distance = length(v_fragPos);
        #ifdef HILO_WRITE_ORIGIN_DATA
            gl_FragColor = vec4(distance, distance, distance, 1.0);
        #else
            gl_FragColor = packFloat((distance - u_cameraNear)/(u_cameraFar - u_cameraNear));
        #endif
    #endif
    #include "./chunk/logDepth_main.frag"
}