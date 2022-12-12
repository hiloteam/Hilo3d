#ifndef HILO_IS_WEBGL2
    #ifdef HILO_USE_SHADER_TEXTURE_LOD
        #extension GL_EXT_shader_texture_lod: enable
    #endif

    #ifdef HILO_USE_FRAG_DEPTH
        #extension GL_EXT_frag_depth: enable
    #endif
#endif