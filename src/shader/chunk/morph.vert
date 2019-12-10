#ifdef HILO_MORPH_TARGET_COUNT
    uniform float u_morphWeights[HILO_MORPH_TARGET_COUNT];

    #if HILO_MORPH_TARGET_COUNT > 0
        #ifdef HILO_MORPH_HAS_POSITION
            attribute vec3 a_morphPosition0;
        #endif
        #if defined(HILO_MORPH_HAS_NORMAL) && defined(HILO_HAS_NORMAL)
            attribute vec3 a_morphNormal0;
        #endif
        #if defined(HILO_MORPH_HAS_TANGENT) && defined(HILO_HAS_TANGENT)
            attribute vec3 a_morphTangent0;
        #endif
    #endif

    #if HILO_MORPH_TARGET_COUNT > 1
        #ifdef HILO_MORPH_HAS_POSITION
            attribute vec3 a_morphPosition1;
        #endif
        #if defined(HILO_MORPH_HAS_NORMAL) && defined(HILO_HAS_NORMAL)
            attribute vec3 a_morphNormal1;
        #endif
        #if defined(HILO_MORPH_HAS_TANGENT) && defined(HILO_HAS_TANGENT)
            attribute vec3 a_morphTangent1;
        #endif
    #endif

    #if HILO_MORPH_TARGET_COUNT > 2
        #ifdef HILO_MORPH_HAS_POSITION
            attribute vec3 a_morphPosition2;
        #endif
        #if defined(HILO_MORPH_HAS_NORMAL) && defined(HILO_HAS_NORMAL)
            attribute vec3 a_morphNormal2;
        #endif
        #if defined(HILO_MORPH_HAS_TANGENT) && defined(HILO_HAS_TANGENT)
            attribute vec3 a_morphTangent2;
        #endif
    #endif

    #if HILO_MORPH_TARGET_COUNT > 3
        #ifdef HILO_MORPH_HAS_POSITION
            attribute vec3 a_morphPosition3;
        #endif
        #if defined(HILO_MORPH_HAS_NORMAL) && defined(HILO_HAS_NORMAL)
            attribute vec3 a_morphNormal3;
        #endif
        #if defined(HILO_MORPH_HAS_TANGENT) && defined(HILO_HAS_TANGENT)
            attribute vec3 a_morphTangent3;
        #endif
    #endif

    #if HILO_MORPH_TARGET_COUNT > 4
        #ifdef HILO_MORPH_HAS_POSITION
            attribute vec3 a_morphPosition4;
        #endif
        #if defined(HILO_MORPH_HAS_NORMAL) && defined(HILO_HAS_NORMAL)
            attribute vec3 a_morphNormal4;
        #endif
        #if defined(HILO_MORPH_HAS_TANGENT) && defined(HILO_HAS_TANGENT)
            attribute vec3 a_morphTangent4;
        #endif
    #endif

    #if HILO_MORPH_TARGET_COUNT > 5
        #ifdef HILO_MORPH_HAS_POSITION
            attribute vec3 a_morphPosition5;
        #endif
        #if defined(HILO_MORPH_HAS_NORMAL) && defined(HILO_HAS_NORMAL)
            attribute vec3 a_morphNormal5;
        #endif
        #if defined(HILO_MORPH_HAS_TANGENT) && defined(HILO_HAS_TANGENT)
            attribute vec3 a_morphTangent5;
        #endif
    #endif

    #if HILO_MORPH_TARGET_COUNT > 6
        #ifdef HILO_MORPH_HAS_POSITION
            attribute vec3 a_morphPosition6;
        #endif
        #if defined(HILO_MORPH_HAS_NORMAL) && defined(HILO_HAS_NORMAL)
            attribute vec3 a_morphNormal6;
        #endif
        #if defined(HILO_MORPH_HAS_TANGENT) && defined(HILO_HAS_TANGENT)
            attribute vec3 a_morphTangent6;
        #endif
    #endif

    #if HILO_MORPH_TARGET_COUNT > 7
        #ifdef HILO_MORPH_HAS_POSITION
            attribute vec3 a_morphPosition7;
        #endif
        #if defined(HILO_MORPH_HAS_NORMAL) && defined(HILO_HAS_NORMAL)
            attribute vec3 a_morphNormal7;
        #endif
        #if defined(HILO_MORPH_HAS_TANGENT) && defined(HILO_HAS_TANGENT)
            attribute vec3 a_morphTangent7;
        #endif
    #endif
#endif