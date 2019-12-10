#ifdef HILO_HAS_TEXCOORD0
    varying vec2 v_texcoord0;
#endif

#ifdef HILO_HAS_TEXCOORD1
    varying vec2 v_texcoord1;
#endif

#if defined(HILO_HAS_TEXCOORD0) || defined(HILO_HAS_TEXCOORD1)
    #if defined(HILO_HAS_TEXCOORD0) && defined(HILO_HAS_TEXCOORD1)
        #define HILO_SAMPLER_2D hiloSampler2D
        // https://www.khronos.org/opengl/wiki/Data_Type_(GLSL)#Opaque_types
        #define HILO_TEXTURE_2D(HILO_SAMPLER_2D)  hiloTexture2D(HILO_SAMPLER_2D.texture, HILO_SAMPLER_2D.uv)
        struct hiloSampler2D{
            sampler2D texture;
            int uv; 
        };
        
        vec4 hiloTexture2D(sampler2D texture, int uv){
            if(uv == 0){
                return texture2D(texture, v_texcoord0);
            }
            else{
                return texture2D(texture, v_texcoord1);
            }
        }
    #else
        #ifdef HILO_HAS_TEXCOORD1
            #define HILO_V_TEXCOORD v_texcoord1
        #else
            #define HILO_V_TEXCOORD v_texcoord0
        #endif
        #define HILO_SAMPLER_2D sampler2D
        #define HILO_TEXTURE_2D(HILO_SAMPLER_2D)  texture2D(HILO_SAMPLER_2D, HILO_V_TEXCOORD)
    #endif
#endif


#ifdef HILO_DIFFUSE_CUBE_MAP
    varying vec3 v_position;
#endif