#ifdef HILO_QUANTIZED
    #ifdef HILO_POSITION_QUANTIZED
        pos.xyz = unQuantize(pos.xyz, u_positionDecodeMat);
    #endif
    #if defined(HILO_HAS_TEXCOORD0) && defined(HILO_UV_QUANTIZED)
        uv = unQuantize(uv, u_uvDecodeMat);
    #endif
    #if defined(HILO_HAS_TEXCOORD1) && defined(HILO_UV1_QUANTIZED)
        uv1 = unQuantize(uv1, u_uv1DecodeMat);
    #endif
    #if defined(HILO_HAS_NORMAL) && defined(HILO_NORMAL_QUANTIZED)
        normal = unQuantize(normal, u_normalDecodeMat);
    #endif
#endif