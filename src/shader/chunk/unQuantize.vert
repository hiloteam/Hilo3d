#ifdef HILO_QUANTIZED
    #ifdef HILO_POSITION_QUANTIZED
    #endif
    #ifdef HILO_NORMAL_QUANTIZED
    #endif
    #ifdef HILO_UV_QUANTIZED
    #endif
    #ifdef HILO_UV1_QUANTIZED
    #endif

    vec2 unQuantize(vec2 data, mat3 decodeMat) {
        vec3 result = vec3(data, 1.0);
        result = decodeMat * result;
        return result.xy;
    }

    vec3 unQuantize(vec3 data, mat4 decodeMat) {
        vec4 result = vec4(data, 1.0);
        result = decodeMat * result;
        return result.xyz;
    }
#endif
