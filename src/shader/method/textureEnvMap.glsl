vec4 textureEnvMap(sampler2D texture, vec3 position){
    return texture2D(texture, vec2(atan(position.x, position.z) * HILO_INVERSE_PI * 0.5+0.5,  acos(position.y) * HILO_INVERSE_PI));
}

vec4 textureEnvMap(samplerCube texture, vec3 position){
    return textureCube(texture, position);
}

vec4 textureEnvMapIncludeMipmapsLod(sampler2D texture, vec3 position, float lod){
    lod = floor(lod);
    vec2 uv = vec2(atan(position.x, position.z) * HILO_INVERSE_PI * 0.5+0.5,  acos(position.y) * HILO_INVERSE_PI);

    float scale = pow(2.0, lod);

    return texture2D(texture, vec2(uv.x / scale, (uv.y / scale / 2.0) + 1.0 - 1.0/pow(2.0, lod)));
}

#ifdef HILO_USE_SHADER_TEXTURE_LOD
    vec4 textureEnvMapLod(sampler2D texture, vec3 position, float lod){
        return texture2DLodEXT(texture, vec2(atan(position.x, position.z) * HILO_INVERSE_PI * 0.5+0.5,  acos(position.y) * HILO_INVERSE_PI), lod);
    }

    vec4 textureEnvMapLod(samplerCube texture, vec3 position, float lod){
        return textureCubeLodEXT(texture, position, lod);
    }
#endif

#pragma glslify: export(textureSphere)