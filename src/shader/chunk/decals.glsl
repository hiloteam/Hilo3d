#ifdef HILO_DECALS
layout(std140) uniform DecalBlock {
    mat4 u_decalWorldToLocal[8];
    vec4 u_decalAtlasRect[8];
    vec4 u_decalColor[8];
    vec4 u_decalNormal[8];
    vec4 u_decalTangent[8];
    vec4 u_decalSurface[8];
    vec4 u_decalRange[8];
};
uniform sampler2D u_decalBaseColorAtlas;
#ifdef HILO_DECAL_NORMAL
uniform sampler2D u_decalNormalAtlas;
#endif
#ifdef HILO_DECAL_ROUGHNESS
uniform sampler2D u_decalRoughnessAtlas;
#endif

// All atlases have top-left logical coordinates. The center and both explicit gradients cross
// the image normalization boundary here, exactly once; derivatives are evaluated before branching.
vec4 hiloDecalSample(sampler2D source, vec2 localUV, vec4 rect, vec2 dx, vec2 dy) {
    vec2 halfTexel = 0.5 / vec2(textureSize(source, 0));
    vec2 inset = min(halfTexel, rect.zw * 0.5);
    vec2 logicalUV = clamp(rect.xy + localUV * rect.zw, rect.xy + inset, rect.xy + rect.zw - inset);
    vec2 uv = hiloTextureUV(logicalUV);
    vec2 nativeDX = hiloTextureUV(logicalUV + dx * rect.zw) - uv;
    vec2 nativeDY = hiloTextureUV(logicalUV + dy * rect.zw) - uv;
    return textureGrad(source, uv, nativeDX, nativeDY);
}

void hiloApplyDecals(inout vec4 baseColor, inout vec3 viewNormal, inout float roughness) {
    vec3 worldPosition = (u_viewInverseMatrix * vec4(v_fragPos, 1.0)).xyz + u_renderOrigin.xyz;
    vec3 worldNormal = normalize(mat3(u_viewInverseMatrix) * viewNormal);
    vec3 receiverNormal = worldNormal;
    vec3 worldDX = dFdx(worldPosition);
    vec3 worldDY = dFdy(worldPosition);
    float viewDistance = length(v_fragPos);
    for (int index = 0; index < HILO_DECALS; index++) {
        vec3 local = (u_decalWorldToLocal[index] * vec4(worldPosition, 1.0)).xyz;
        float facing = dot(receiverNormal, u_decalNormal[index].xyz);
        float alpha = u_decalColor[index].a;
        if (alpha <= 0.0 || any(greaterThan(abs(local), vec3(0.5))) ||
            facing <= u_decalNormal[index].w || viewDistance >= u_decalRange[index].x) continue;
        vec2 localUV = vec2(local.x + 0.5, 0.5 - local.y);
        vec2 dx = (mat3(u_decalWorldToLocal[index]) * worldDX).xy * vec2(1.0, -1.0);
        vec2 dy = (mat3(u_decalWorldToLocal[index]) * worldDY).xy * vec2(1.0, -1.0);
        vec4 sampled = hiloDecalSample(u_decalBaseColorAtlas, localUV, u_decalAtlasRect[index], dx, dy);
        #ifdef HILO_DECAL_SRGB
            sampled.rgb = mix(sampled.rgb / 12.92,
                pow((sampled.rgb + 0.055) / 1.055, vec3(2.4)),
                greaterThan(sampled.rgb, vec3(0.04045)));
        #endif
        alpha *= sampled.a;
        float edgeDistance = min(0.5 - abs(local.x), 0.5 - abs(local.y));
        alpha *= smoothstep(0.0, max(u_decalSurface[index].w, 1e-6), edgeDistance);
        alpha *= smoothstep(0.0, max(u_decalTangent[index].w, 1e-6), facing - u_decalNormal[index].w);
        alpha *= smoothstep(0.0, max(u_decalRange[index].y, 1e-6), u_decalRange[index].x - viewDistance);
        baseColor.rgb = mix(baseColor.rgb, sampled.rgb * u_decalColor[index].rgb, alpha);
        if (u_decalSurface[index].z > 0.5) {
            float decalRoughness = u_decalSurface[index].y;
            #ifdef HILO_DECAL_ROUGHNESS
                decalRoughness *= hiloDecalSample(u_decalRoughnessAtlas, localUV,
                    u_decalAtlasRect[index], dx, dy).r;
            #endif
            roughness = mix(roughness, decalRoughness, alpha);
        }
        #ifdef HILO_DECAL_NORMAL
            vec3 tangent = u_decalTangent[index].xyz - worldNormal * dot(worldNormal, u_decalTangent[index].xyz);
            float tangentLength = length(tangent);
            if (tangentLength > 1e-5) {
                tangent /= tangentLength;
                vec3 bitangent = normalize(cross(worldNormal, tangent)) * u_decalRange[index].z;
                vec3 mapped = hiloDecalSample(u_decalNormalAtlas, localUV,
                    u_decalAtlasRect[index], dx, dy).xyz * 2.0 - 1.0;
                mapped.xy *= u_decalSurface[index].x;
                mapped.z = max(mapped.z, 1e-4);
                vec3 mappedWorld = normalize(tangent * mapped.x + bitangent * mapped.y + worldNormal * mapped.z);
                worldNormal = normalize(mix(worldNormal, mappedWorld, alpha));
            }
        #endif
    }
    roughness = clamp(roughness, 0.045, 1.0);
    viewNormal = normalize(mat3(u_viewMatrix) * worldNormal);
}
#endif
