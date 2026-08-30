vec2 hiloEncodeOctahedralNormal(vec3 value) {
    vec3 normal = normalize(value);
    normal /= max(abs(normal.x) + abs(normal.y) + abs(normal.z), 1e-6);
    vec2 encoded = normal.xy;
    if (normal.z < 0.0) {
        vec2 octahedralSign = vec2(
            encoded.x >= 0.0 ? 1.0 : -1.0,
            encoded.y >= 0.0 ? 1.0 : -1.0
        );
        encoded = (1.0 - abs(encoded.yx)) * octahedralSign;
    }
    return encoded * 0.5 + 0.5;
}

#ifdef HILO_SSR_MATERIAL_DATA
layout(location=1) out vec4 hilo_ReflectionResponse;
layout(location=2) out vec4 hilo_ReflectionFallbackSpecular;

void hiloWriteMaterialReflectionData(vec3 response, vec3 fallbackSpecular) {
    hilo_ReflectionResponse = vec4(max(response, vec3(0.0)), 1.0);
    hilo_ReflectionFallbackSpecular = vec4(max(fallbackSpecular, vec3(0.0)), 1.0);
}
#endif

vec4 hiloMaterialAttributes(
    vec3 viewNormal,
    float perceptualRoughness,
    float metallic,
    float reflectionReceiver
) {
    float receiverFlag = reflectionReceiver >= 0.5 ? 1.0 : 0.0;
    float metallicBits = floor(clamp(metallic, 0.0, 1.0) * 127.0 + 0.5);
    float packedMaterial = receiverFlag + metallicBits * 2.0;
    return vec4(
        hiloEncodeOctahedralNormal(viewNormal),
        clamp(perceptualRoughness, 0.045, 1.0),
        packedMaterial / 255.0
    );
}
