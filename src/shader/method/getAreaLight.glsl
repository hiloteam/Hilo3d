// modified from https://github.com/mrdoob/three.js/blob/dev/src/renderers/shaders/ShaderChunk/lights_physical_pars_fragment.glsl#L26

#pragma glslify: import('../method/transpose.glsl');

vec2 LTC_Uv(const in vec3 N, const in vec3 V, const in float roughness) {
    const float LUT_SIZE = 64.0;
    const float LUT_SCALE = (LUT_SIZE - 1.0) / LUT_SIZE;
    const float LUT_BIAS = 0.5 / LUT_SIZE;
    float dotNV = clamp(dot(N, V), 0.0, 1.0);
    vec2 uv = vec2(roughness, sqrt(1.0 - dotNV));
    uv = (uv * LUT_SCALE) + LUT_BIAS;
    return uv;
}

float LTC_ClippedSphereFormFactor(const in vec3 f) {
    float l = length(f);
    return max(((l * l) + f.z) / (l + 1.0), 0.0);
}

vec3 LTC_EdgeVectorFormFactor(const in vec3 v1, const in vec3 v2) {
    float x = dot(v1, v2);
    float y = abs(x);
    float a = 0.8543985 + ((0.4965155 + (0.0145206 * y)) * y);
    float b = 3.4175940 + ((4.1616724 + y) * y);
    float v = a / b;
    float theta_sintheta = x > 0.0 ? v : (0.5 * inversesqrt(max(1.0 - (x * x), 1e-7))) - v;
    return cross(v1, v2) * theta_sintheta;
}

vec3 LTC_Evaluate(const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[4]) {
    vec3 v1 = rectCoords[1] - rectCoords[0];
    vec3 v2 = rectCoords[3] - rectCoords[0];
    vec3 lightNormal = cross(v1, v2);
    if (dot(lightNormal, P - rectCoords[0]) < 0.0)
        return vec3(0.0);
    vec3 T1, T2;
    T1 = normalize(V - (N * dot(V, N)));
    T2 = -cross(N, T1);
    mat3 mat = mInv * transpose(mat3(T1, T2, N));
    vec3 coords[4];
    coords[0] = mat * (rectCoords[0] - P);
    coords[1] = mat * (rectCoords[1] - P);
    coords[2] = mat * (rectCoords[2] - P);
    coords[3] = mat * (rectCoords[3] - P);
    coords[0] = normalize(coords[0]);
    coords[1] = normalize(coords[1]);
    coords[2] = normalize(coords[2]);
    coords[3] = normalize(coords[3]);
    vec3 vectorFormFactor = vec3(0.0);
    vectorFormFactor += LTC_EdgeVectorFormFactor(coords[0], coords[1]);
    vectorFormFactor += LTC_EdgeVectorFormFactor(coords[1], coords[2]);
    vectorFormFactor += LTC_EdgeVectorFormFactor(coords[2], coords[3]);
    vectorFormFactor += LTC_EdgeVectorFormFactor(coords[3], coords[0]);
    float result = LTC_ClippedSphereFormFactor(vectorFormFactor);
    return vec3(result);
}

vec3 getAreaLight(const in vec3 diffuseColor, const in vec3 specularColor, const in float roughness, const in vec3 normal, const in vec3 viewDir, const in vec3 position, const in vec3 lightPos, const in vec3 lightColor, const in vec3 halfWidth, const in vec3 halfHeight, const in sampler2D areaLightsLtcTexture1, const in sampler2D areaLightsLtcTexture2){
    vec3 rectCoords[4];
    rectCoords[0] = (lightPos - halfWidth) - halfHeight;
    rectCoords[1] = (lightPos + halfWidth) - halfHeight;
    rectCoords[2] = (lightPos + halfWidth) + halfHeight;
    rectCoords[3] = (lightPos - halfWidth) + halfHeight;
    
    vec2 uv = LTC_Uv(normal, viewDir, roughness);
    vec4 t1 = texture2D(areaLightsLtcTexture1, uv);
    vec4 t2 = texture2D(areaLightsLtcTexture2, uv);

    mat3 mInv = mat3(vec3(t1.x, 0, t1.y), vec3(0, 1, 0), vec3(t1.z, 0, t1.w));
    vec3 fresnel = (specularColor * t2.x) + ((vec3(1.0) - specularColor) * t2.y);
    
    vec3 color = vec3(0.0, 0.0, 0.0);
    color += ((lightColor * fresnel) * LTC_Evaluate(normal, viewDir, position, mInv, rectCoords));
    color += ((lightColor * diffuseColor) * LTC_Evaluate(normal, viewDir, position, mat3(1.0), rectCoords));
    return color;
}

#pragma glslify: export(getAreaLight)