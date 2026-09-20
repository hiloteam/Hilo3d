// Constrained readonly storage raster; consumed through StorageGraphicsShader and GLSL -> Naga.
layout(std430) readonly buffer DDGIProbeBlock { vec4 values[]; } ddgiProbes;
vec2 hiloDDGIOctUV(vec3 direction) {
    direction /= max(abs(direction.x) + abs(direction.y) + abs(direction.z), 0.000001);
    vec2 uv = direction.xy;
    if (direction.z < 0.0) uv = (1.0 - abs(uv.yx)) * mix(vec2(-1.0), vec2(1.0), greaterThanEqual(uv, vec2(0.0)));
    return uv * 0.5 + 0.5;
}
uint hiloDDGIOctIndex(ivec2 p) {
    if (p.x < 0) { p.x = 0; p.y = 7 - p.y; }
    else if (p.x > 7) { p.x = 7; p.y = 7 - p.y; }
    if (p.y < 0) { p.y = 0; p.x = 7 - p.x; }
    else if (p.y > 7) { p.y = 7; p.x = 7 - p.x; }
    return uint(p.y * 8 + p.x);
}
vec4 hiloDDGIBin(uint base, vec3 direction) {
    vec2 p = hiloDDGIOctUV(direction) * 8.0 - 0.5;
    ivec2 lo = ivec2(floor(p));
    vec2 fraction = fract(p);
    return mix(mix(ddgiProbes.values[base + hiloDDGIOctIndex(lo)],
        ddgiProbes.values[base + hiloDDGIOctIndex(lo + ivec2(1, 0))], fraction.x),
        mix(ddgiProbes.values[base + hiloDDGIOctIndex(lo + ivec2(0, 1))],
        ddgiProbes.values[base + hiloDDGIOctIndex(lo + ivec2(1, 1))], fraction.x), fraction.y);
}
vec4 hiloDDGISample(vec3 worldPosition, vec3 worldNormal, vec3 viewDirection) {
    vec4 origin = ddgiProbes.values[0];
    vec4 spacing = ddgiProbes.values[1];
    vec4 counts = ddgiProbes.values[2];
    vec4 controls = ddgiProbes.values[3];
    vec3 coordinate = (worldPosition - origin.xyz) / spacing.xyz;
    vec3 edge = min(coordinate + 0.5, counts.xyz - 0.5 - coordinate);
    float fade = clamp(min(edge.x, min(edge.y, edge.z)) * 2.0, 0.0, 1.0);
    if (fade <= 0.0 || origin.w <= 0.0) return vec4(0.0);
    coordinate = clamp(coordinate, vec3(0.0), counts.xyz - 1.0);
    ivec3 cell = ivec3(min(floor(coordinate), counts.xyz - 2.0));
    vec3 fraction = coordinate - vec3(cell);
    vec3 biased = worldPosition + worldNormal * spacing.w + viewDirection * counts.w;
    vec3 irradiance = vec3(0.0);
    float weightSum = 0.0;
    for (int corner = 0; corner < 8; corner++) {
        ivec3 bit = ivec3(corner & 1, (corner >> 1) & 1, (corner >> 2) & 1);
        ivec3 index = cell + bit;
        uint probe = uint(index.x + int(counts.x) * (index.y + int(counts.y) * index.z));
        uint base = 4u + probe * 130u;
        vec4 state = ddgiProbes.values[base];
        if (state.w < 0.5) continue;
        vec3 position = origin.xyz + vec3(index) * spacing.xyz + state.xyz;
        vec3 delta = biased - position;
        float distanceToProbe = max(length(delta), 0.000001);
        vec3 direction = delta / distanceToProbe;
        vec3 trilinear = mix(1.0 - fraction, fraction, vec3(bit));
        float facing = pow(clamp(dot(worldNormal, -direction) * 0.5 + 0.5, 0.0, 1.0), 2.0) + 0.05;
        vec2 moments = hiloDDGIBin(base + 66u, direction).xy;
        float variance = max(moments.y - moments.x * moments.x, 0.00001);
        float excess = max(distanceToProbe - moments.x - controls.x, 0.0);
        float visibility = pow(variance / (variance + excess * excess), 3.0);
        float weight = trilinear.x * trilinear.y * trilinear.z * facing * visibility;
        if (weight < 0.2) weight *= weight * weight / 0.04;
        irradiance += hiloDDGIBin(base + 2u, worldNormal).rgb * weight;
        weightSum += weight;
    }
    return vec4(irradiance / max(weightSum, 0.000001) * origin.w * fade, weightSum > 0.000001 ? fade : 0.0);
}
vec3 hiloDDGIIrradiance(vec3 worldPosition, vec3 worldNormal, vec3 viewDirection) {
    return hiloDDGISample(worldPosition, worldNormal, viewDirection).rgb;
}
