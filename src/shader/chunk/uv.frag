#ifdef HILO_HAS_TEXCOORD0
    in vec2 v_texcoord0;
#endif

#ifdef HILO_HAS_TEXCOORD1
    in vec2 v_texcoord1;
#endif

#if defined(HILO_HAS_TEXCOORD0) || defined(HILO_HAS_TEXCOORD1)
    #if defined(HILO_HAS_TEXCOORD0) && defined(HILO_HAS_TEXCOORD1)
        #define HILO_TEXTURE_2D(SAMPLER, UV_SET) hiloTexture2D(SAMPLER, UV_SET)
        vec4 hiloTexture2D(sampler2D sourceTexture, int uvSet) {
            if (uvSet == 0) {
                return texture(sourceTexture, v_texcoord0);
            }
            return texture(sourceTexture, v_texcoord1);
        }
    #else
        #ifdef HILO_HAS_TEXCOORD1
            #define HILO_V_TEXCOORD v_texcoord1
        #else
            #define HILO_V_TEXCOORD v_texcoord0
        #endif
        #define HILO_TEXTURE_2D(SAMPLER, UV_SET) texture(SAMPLER, HILO_V_TEXCOORD)
    #endif
#endif


#ifdef HILO_DIFFUSE_CUBE_MAP
    in vec3 v_position;
#endif
