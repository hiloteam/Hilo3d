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
    return encoded;
}

vec4 hiloMaterialAttributes(
    vec3 viewNormal,
    float perceptualRoughness,
    float metallic,
    float reflectionReceiver
) {
    float receiverFlag = reflectionReceiver >= 0.5 ? 1.0 : 0.0;
    float metallicBits = floor(clamp(metallic, 0.0, 1.0) * 255.0 + 0.5);
    return vec4(
        hiloEncodeOctahedralNormal(viewNormal),
        clamp(perceptualRoughness, 0.045, 1.0),
        receiverFlag + metallicBits * 2.0
    );
}
