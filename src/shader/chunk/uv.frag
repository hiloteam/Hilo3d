#include "../method/portableCoordinates.glsl"
#include "../method/encoding.glsl"

#ifdef HILO_HAS_TEXCOORD0
    in vec2 v_texcoord0;
#endif

#ifdef HILO_HAS_TEXCOORD1
    in vec2 v_texcoord1;
#endif

float hiloMaterialChannel(vec4 value, int channel) {
    if (channel == 0) return value.r;
    if (channel == 1) return value.g;
    if (channel == 2) return value.b;
    if (channel == 3) return value.a;
    return channel == 5 ? 1.0 : 0.0;
}

#if defined(HILO_HAS_TEXCOORD0) || defined(HILO_HAS_TEXCOORD1)
    vec2 hiloMaterialUV(int slot) {
        int uvSet = int(u_materialTextureInfo[slot].x);
        #if defined(HILO_HAS_TEXCOORD0) && defined(HILO_HAS_TEXCOORD1)
            vec2 uv = uvSet == 0 ? v_texcoord0 : v_texcoord1;
        #elif defined(HILO_HAS_TEXCOORD1)
            vec2 uv = v_texcoord1;
        #else
            vec2 uv = v_texcoord0;
        #endif
        return (u_materialTextureTransforms[slot] * vec3(uv, 1.0)).xy;
    }

    vec4 hiloTexture2D(sampler2D sourceTexture, int slot) {
        vec4 sampled = texture(sourceTexture, hiloTextureUV(hiloMaterialUV(slot)));
        if (int(u_materialTextureInfo[slot].y) == 1) sampled = sRGBToLinear(sampled);
        ivec4 channels = u_materialTextureChannels[slot];
        return vec4(
            hiloMaterialChannel(sampled, channels.x),
            hiloMaterialChannel(sampled, channels.y),
            hiloMaterialChannel(sampled, channels.z),
            hiloMaterialChannel(sampled, channels.w)
        );
    }

    #define HILO_TEXTURE_2D(SAMPLER, SLOT) hiloTexture2D(SAMPLER, SLOT)
#endif

#ifdef HILO_DIFFUSE_CUBE_MAP
    in vec3 v_position;
#endif
