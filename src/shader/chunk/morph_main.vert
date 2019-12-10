#ifdef HILO_MORPH_TARGET_COUNT
    #if HILO_MORPH_TARGET_COUNT > 0
        #ifdef HILO_MORPH_HAS_POSITION
            pos.xyz += a_morphPosition0 * u_morphWeights[0];
        #endif
        #if defined(HILO_MORPH_HAS_NORMAL) && defined(HILO_HAS_NORMAL)
            normal += a_morphNormal0 * u_morphWeights[0];
        #endif
        #if defined(HILO_MORPH_HAS_TANGENT) && defined(HILO_HAS_TANGENT)
            tangent.xyz += a_morphTangent0 * u_morphWeights[0];
        #endif
    #endif

    #if HILO_MORPH_TARGET_COUNT > 1
        #ifdef HILO_MORPH_HAS_POSITION
            pos.xyz += a_morphPosition1 * u_morphWeights[1];
        #endif
        #if defined(HILO_MORPH_HAS_NORMAL) && defined(HILO_HAS_NORMAL)
            normal += a_morphNormal1 * u_morphWeights[1];
        #endif
        #if defined(HILO_MORPH_HAS_TANGENT) && defined(HILO_HAS_TANGENT)
            tangent.xyz += a_morphTangent1 * u_morphWeights[1];
        #endif
    #endif

    #if HILO_MORPH_TARGET_COUNT > 2
        #ifdef HILO_MORPH_HAS_POSITION
            pos.xyz += a_morphPosition2 * u_morphWeights[2];
        #endif
        #if defined(HILO_MORPH_HAS_NORMAL) && defined(HILO_HAS_NORMAL)
            normal += a_morphNormal2 * u_morphWeights[2];
        #endif
        #if defined(HILO_MORPH_HAS_TANGENT) && defined(HILO_HAS_TANGENT)
            tangent.xyz += a_morphTangent2 * u_morphWeights[2];
        #endif
    #endif

    #if HILO_MORPH_TARGET_COUNT > 3
        #ifdef HILO_MORPH_HAS_POSITION
            pos.xyz += a_morphPosition3 * u_morphWeights[3];
        #endif
        #if defined(HILO_MORPH_HAS_NORMAL) && defined(HILO_HAS_NORMAL)
            normal += a_morphNormal3 * u_morphWeights[3];
        #endif
        #if defined(HILO_MORPH_HAS_TANGENT) && defined(HILO_HAS_TANGENT)
            tangent.xyz += a_morphTangent3 * u_morphWeights[3];
        #endif
    #endif

    #if HILO_MORPH_TARGET_COUNT > 4
        #ifdef HILO_MORPH_HAS_POSITION
            pos.xyz += a_morphPosition4 * u_morphWeights[4];
        #endif
        #if defined(HILO_MORPH_HAS_NORMAL) && defined(HILO_HAS_NORMAL)
            normal += a_morphNormal4 * u_morphWeights[4];
        #endif
        #if defined(HILO_MORPH_HAS_TANGENT) && defined(HILO_HAS_TANGENT)
            tangent.xyz += a_morphTangent4 * u_morphWeights[4];
        #endif
    #endif

    #if HILO_MORPH_TARGET_COUNT > 5
        #ifdef HILO_MORPH_HAS_POSITION
            pos.xyz += a_morphPosition5 * u_morphWeights[5];
        #endif
        #if defined(HILO_MORPH_HAS_NORMAL) && defined(HILO_HAS_NORMAL)
            normal += a_morphNormal5 * u_morphWeights[5];
        #endif
        #if defined(HILO_MORPH_HAS_TANGENT) && defined(HILO_HAS_TANGENT)
            tangent.xyz += a_morphTangent5 * u_morphWeights[5];
        #endif
    #endif

    #if HILO_MORPH_TARGET_COUNT > 6
        #ifdef HILO_MORPH_HAS_POSITION
            pos.xyz += a_morphPosition6 * u_morphWeights[6];
        #endif
        #if defined(HILO_MORPH_HAS_NORMAL) && defined(HILO_HAS_NORMAL)
            normal += a_morphNormal6 * u_morphWeights[6];
        #endif
        #if defined(HILO_MORPH_HAS_TANGENT) && defined(HILO_HAS_TANGENT)
            tangent.xyz += a_morphTangent6 * u_morphWeights[6];
        #endif
    #endif

    #if HILO_MORPH_TARGET_COUNT > 7
        #ifdef HILO_MORPH_HAS_POSITION
            pos.xyz += a_morphPosition7 * u_morphWeights[7];
        #endif
        #if defined(HILO_MORPH_HAS_NORMAL) && defined(HILO_HAS_NORMAL)
            normal += a_morphNormal7 * u_morphWeights[7];
        #endif
        #if defined(HILO_MORPH_HAS_TANGENT) && defined(HILO_HAS_TANGENT)
            tangent.xyz += a_morphTangent7 * u_morphWeights[7];
        #endif
    #endif
#endif