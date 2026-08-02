struct HiloMetallicRoughnessSurface {
    vec4 baseColor;
    vec3 emissionColor;
    float metallic;
    float roughness;
    float occlusion;
    vec3 diffuseColor;
    vec3 specularColor;
    vec3 iblDiffuseColor;
};

vec4 hiloEvaluatePBRBaseColor(vec4 factor, vec4 sampledColor) {
    return factor * sampledColor;
}

vec3 hiloEvaluatePBREmission(vec3 factor, vec3 sampledColor) {
    return factor * sampledColor;
}

float hiloEvaluatePBROcclusion(float sampledOcclusion, float strength) {
    return mix(1.0, sampledOcclusion, strength);
}

HiloMetallicRoughnessSurface hiloEvaluateMetallicRoughnessSurface(
    vec4 baseColor,
    vec3 emissionColor,
    float metallic,
    float roughness,
    float occlusion,
    float occlusionStrength,
    float ior
) {
    HiloMetallicRoughnessSurface surface;
    surface.baseColor = baseColor;
    surface.emissionColor = emissionColor;
    surface.metallic = clamp(metallic, 0.0, 1.0);
    surface.roughness = clamp(roughness, 0.045, 1.0);
    surface.occlusion = hiloEvaluatePBROcclusion(occlusion, occlusionStrength);
    float dielectricF0Value = (ior - 1.0) / max(ior + 1.0, 1e-4);
    vec3 dielectricF0 = vec3(dielectricF0Value * dielectricF0Value);
    surface.diffuseColor = baseColor.rgb * (1.0 - surface.metallic);
    surface.specularColor = mix(dielectricF0, baseColor.rgb, surface.metallic);
    surface.iblDiffuseColor = surface.diffuseColor * (vec3(1.0) - surface.specularColor);
    return surface;
}
