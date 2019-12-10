#ifdef HILO_QUANTIZED
    #ifdef HILO_POSITION_QUANTIZED
        uniform mat4 u_positionDecodeMat;
    #endif
    #ifdef HILO_NORMAL_QUANTIZED
        uniform mat4 u_normalDecodeMat;
    #endif
    #ifdef HILO_UV_QUANTIZED
        uniform mat3 u_uvDecodeMat;
    #endif
    #ifdef HILO_UV1_QUANTIZED
        uniform mat3 u_uv1DecodeMat;
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