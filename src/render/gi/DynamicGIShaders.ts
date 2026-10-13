import { RAY_TRIANGLE_FLOATS } from './scene/SceneGeometry';
import { RAY_MATERIAL_FLOATS, RAY_MATERIAL_BYTES, RAY_DECAL_OFFSET } from './scene/SceneMaterials';
import ComputeShader from '../compute/ComputeShader';
import ddgiRasterSource from '../../shader/chunk/dynamicGlobalIllumination.frag';
import type { DynamicGlobalIlluminationSettings } from './DynamicGlobalIllumination';

/** @internal Probe ABI: four volume vec4s, then position/state, metadata and two 8x8 octahedral maps. */
export const DDGI_HEADER_VEC4S = 4;
/** @internal Number of vec4 records per DDGI probe. */
export const DDGI_PROBE_VEC4S = 130;
/** @internal Byte stride of one persistent probe. */
export const DDGI_PROBE_BYTES = DDGI_PROBE_VEC4S * 16;

/** @internal Canonical readonly storage-raster lookup and probe binding declaration. */
export const DDGI_GLSL_SAMPLING_SOURCE: string = ddgiRasterSource;

const WGSL_LOOKUP = `
fn octUV(direction: vec3<f32>) -> vec2<f32> {
    let n = direction / max(dot(abs(direction), vec3<f32>(1.0)), 0.000001);
    var p = n.xy;
    if (n.z < 0.0) { p = (vec2<f32>(1.0) - abs(p.yx)) * select(vec2<f32>(-1.0), vec2<f32>(1.0), p >= vec2<f32>(0.0)); }
    return p * 0.5 + vec2<f32>(0.5);
}
fn octDirection(index: u32) -> vec3<f32> {
    let p = (vec2<f32>(f32(index % 8u), f32(index / 8u)) + vec2<f32>(0.5)) * 0.25 - vec2<f32>(1.0);
    var n = vec3<f32>(p, 1.0 - abs(p.x) - abs(p.y));
    let t = max(-n.z, 0.0);
    n.x += select(t, -t, n.x >= 0.0);
    n.y += select(t, -t, n.y >= 0.0);
    return normalize(n);
}
fn octIndex(coordinate: vec2<i32>) -> u32 {
    var p = coordinate;
    if (p.x < 0) { p.x = 0; p.y = 7 - p.y; }
    else if (p.x > 7) { p.x = 7; p.y = 7 - p.y; }
    if (p.y < 0) { p.y = 0; p.x = 7 - p.x; }
    else if (p.y > 7) { p.y = 7; p.x = 7 - p.x; }
    return u32(p.y * 8 + p.x);
}
fn historyBin(base: u32, direction: vec3<f32>) -> vec4<f32> {
    let p = octUV(direction) * 8.0 - vec2<f32>(0.5);
    let lo = vec2<i32>(floor(p));
    let fraction = fract(p);
    return mix(mix(previous[base + octIndex(lo)], previous[base + octIndex(lo + vec2<i32>(1, 0))], fraction.x),
        mix(previous[base + octIndex(lo + vec2<i32>(0, 1))], previous[base + octIndex(lo + vec2<i32>(1, 1))], fraction.x), fraction.y);
}
fn historyIrradiance(worldPosition: vec3<f32>, normal: vec3<f32>) -> vec3<f32> {
    if (params[5].w < 0.5) { return vec3<f32>(0.0); }
    let origin = params[0].xyz;
    let spacing = params[1].xyz;
    let counts = params[2].xyz;
    var coordinate = (worldPosition - origin) / spacing;
    if (any(coordinate < vec3<f32>(-0.5)) || any(coordinate > counts - vec3<f32>(0.5))) { return vec3<f32>(0.0); }
    coordinate = clamp(coordinate, vec3<f32>(0.0), counts - vec3<f32>(1.0));
    let cell = vec3<u32>(min(floor(coordinate), counts - vec3<f32>(2.0)));
    let fraction = coordinate - vec3<f32>(cell);
    let biased = worldPosition + normal * params[1].w;
    var radiance = vec3<f32>(0.0);
    var total = 0.0;
    for (var corner = 0u; corner < 8u; corner++) {
        let bit = vec3<u32>(corner & 1u, (corner >> 1u) & 1u, (corner >> 2u) & 1u);
        let index = cell + bit;
        let probe = index.x + u32(counts.x) * (index.y + u32(counts.y) * index.z);
        let base = 4u + probe * 130u;
        let state = previous[base];
        if (state.w < 0.5) { continue; }
        let position = origin + vec3<f32>(index) * spacing + state.xyz;
        let delta = biased - position;
        let distanceToProbe = max(length(delta), 0.000001);
        let direction = delta / distanceToProbe;
        let tri = mix(vec3<f32>(1.0) - fraction, fraction, vec3<f32>(bit));
        let facing = pow(clamp(dot(normal, -direction) * 0.5 + 0.5, 0.0, 1.0), 2.0) + 0.05;
        let moments = historyBin(base + 66u, direction).xy;
        let variance = max(moments.y - moments.x * moments.x, 0.00001);
        let excess = max(distanceToProbe - moments.x - params[3].x, 0.0);
        let visibility = pow(variance / (variance + excess * excess), 3.0);
        var weight = tri.x * tri.y * tri.z * facing * visibility;
        if (weight < 0.2) { weight *= weight * weight / 0.04; }
        radiance += historyBin(base + 2u, normal).rgb * weight;
        total += weight;
    }
    return radiance / max(total, 0.000001);
}
`;

/** @internal Create the immutable compute shader, also consumed by compiler contract tests. */
export function createDynamicGlobalIlluminationShader(
    settings: Readonly<DynamicGlobalIlluminationSettings>
): ComputeShader {
    const raysPerProbe = settings.raysPerProbe;
    return new ComputeShader({
        label: 'DDGI BVH ray queries and probe integration',
        source: `
@group(0) @binding(0) var<storage, read> params: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> triangles: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> nodes: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> lights: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> previous: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> current: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read> materials: array<vec4<f32>>;
@group(0) @binding(8) var<storage, read> texels: array<vec4<f32>>;
@group(0) @binding(6) var historyMarker: texture_storage_2d<r32float, write>;
const RAY_COUNT: u32 = ${String(raysPerProbe)}u;
const TRIANGLE_STRIDE: u32 = ${String(RAY_TRIANGLE_FLOATS / 4)}u;
const DECAL_OFFSET: u32 = ${String(RAY_DECAL_OFFSET / 4)}u;
const MATERIAL_STRIDE: u32 = ${String(RAY_MATERIAL_FLOATS / 4)}u;
const PI: f32 = 3.14159265359;
var<workgroup> raySamples: array<vec4<f32>, ${String(raysPerProbe)}>;
var<workgroup> rayDirections: array<vec4<f32>, ${String(raysPerProbe)}>;
var<workgroup> probeState: vec4<f32>;
var<workgroup> probeMetadata: vec4<f32>;
${WGSL_LOOKUP}

fn rayUV(base: u32, bary: vec3<f32>, uvSet: f32) -> vec2<f32> {
    let uv = triangles[base + 8u] * bary.x + triangles[base + 9u] * bary.y + triangles[base + 10u] * bary.z;
    return select(uv.xy, uv.zw, uvSet > 0.5);
}
fn atlasAddress(value: i32, size: i32, mode: u32) -> u32 {
    if (mode == 0u) { return u32(clamp(value, 0, size - 1)); }
    if (mode == 1u) { return u32(((value % size) + size) % size); }
    let repeatSize = size * 2;
    let wrapped = ((value % repeatSize) + repeatSize) % repeatSize;
    return u32(select(wrapped, repeatSize - 1 - wrapped, wrapped >= size));
}
fn atlasTexel(descriptor: vec4<f32>, samplerInfo: vec4<f32>, coordinate: vec2<i32>) -> vec4<f32> {
    let x = atlasAddress(coordinate.x, i32(descriptor.y), u32(samplerInfo.x));
    let y = atlasAddress(coordinate.y, i32(descriptor.z), u32(samplerInfo.y));
    return texels[u32(descriptor.x) + y * u32(descriptor.y) + x];
}
fn materialChannel(value: vec4<f32>, channel: f32) -> f32 {
    if (channel < 4.0) { return value[u32(channel)]; }
    return select(0.0, 1.0, channel > 4.5);
}
fn sampleTexture(record: u32, logicalUV: vec2<f32>) -> vec4<f32> {
    let descriptor = materials[record];
    if (descriptor.w < 0.5) { return vec4<f32>(1.0); }
    let row0 = materials[record + 1u];
    let row1 = materials[record + 2u];
    let uv = vec3<f32>(logicalUV, 1.0);
    let coordinate = vec2<f32>(dot(row0.xyz, uv), dot(row1.xyz, uv)) * descriptor.yz;
    let samplerInfo = materials[record + 4u];
    var value = vec4<f32>(0.0);
    if (samplerInfo.z < 0.5) { value = atlasTexel(descriptor, samplerInfo, vec2<i32>(floor(coordinate))); }
    else {
        let pixel = coordinate - vec2<f32>(0.5);
        let lo = vec2<i32>(floor(pixel));
        let fraction = fract(pixel);
        value = mix(mix(atlasTexel(descriptor, samplerInfo, lo), atlasTexel(descriptor, samplerInfo, lo + vec2<i32>(1, 0)), fraction.x),
            mix(atlasTexel(descriptor, samplerInfo, lo + vec2<i32>(0, 1)), atlasTexel(descriptor, samplerInfo, lo + vec2<i32>(1, 1)), fraction.x), fraction.y);
    }
    if (row1.w > 0.5) {
        value = vec4<f32>(select(pow(max(value.rgb, vec3<f32>(0.0)) * 0.9478672986 + vec3<f32>(0.0521327014), vec3<f32>(2.4)), value.rgb * 0.0773993808, value.rgb <= vec3<f32>(0.04045)), value.a);
    }
    let channels = materials[record + 3u];
    return vec4<f32>(materialChannel(value, channels.x), materialChannel(value, channels.y), materialChannel(value, channels.z), materialChannel(value, channels.w));
}
fn materialSample(material: u32, slot: u32, base: u32, bary: vec3<f32>) -> vec4<f32> {
    let record = material + 4u + slot * 5u;
    return sampleTexture(record, rayUV(base, bary, materials[record + 1u].w));
}
fn decalSample(material: u32, slot: u32, localUV: vec2<f32>, rectangle: vec4<f32>) -> vec4<f32> {
    let record = material + 4u + slot * 5u;
    let inset = min(vec2<f32>(0.5) / materials[record].yz, rectangle.zw * 0.5);
    return sampleTexture(record, clamp(rectangle.xy + localUV * rectangle.zw, rectangle.xy + inset, rectangle.xy + rectangle.zw - inset));
}
struct DecalSurface { color: vec3<f32>, normal: vec3<f32>, }
fn applyRayDecals(material: u32, position: vec3<f32>, color: vec3<f32>, normal: vec3<f32>) -> DecalSurface {
    var result = DecalSurface(color, normal);
    for (var index = 0u; index < u32(materials[material + 3u].w); index++) {
        let record = material + DECAL_OFFSET + index * 10u;
        let worldToLocal = mat4x4<f32>(materials[record], materials[record + 1u], materials[record + 2u], materials[record + 3u]);
        let local = (worldToLocal * vec4<f32>(position, 1.0)).xyz;
        let outward = materials[record + 6u];
        let tangent = materials[record + 7u];
        let surface = materials[record + 8u];
        let facing = dot(normal, outward.xyz);
        let tint = materials[record + 5u];
        if (tint.a <= 0.0 || any(abs(local) > vec3<f32>(0.5)) || facing <= outward.w) { continue; }
        let uv = vec2<f32>(local.x + 0.5, 0.5 - local.y);
        let sampled = decalSample(material, 8u, uv, materials[record + 4u]);
        var alpha = tint.a * sampled.a;
        alpha *= smoothstep(0.0, max(surface.y, 0.000001), min(0.5 - abs(local.x), 0.5 - abs(local.y)));
        alpha *= smoothstep(0.0, max(tangent.w, 0.000001), facing - outward.w);
        result.color = mix(result.color, sampled.rgb * tint.rgb, alpha);
        if (materials[material + 49u].w > 0.5) {
            let projected = tangent.xyz - result.normal * dot(result.normal, tangent.xyz);
            if (dot(projected, projected) > 0.0000000001) {
                let t = normalize(projected);
                let b = normalize(cross(result.normal, t)) * surface.z;
                var mapped = decalSample(material, 9u, uv, materials[record + 4u]).xyz * 2.0 - vec3<f32>(1.0);
                mapped = vec3<f32>(mapped.xy * surface.x, max(mapped.z, 0.0001));
                result.normal = normalize(mix(result.normal, normalize(t * mapped.x + b * mapped.y + result.normal * mapped.z), alpha));
            }
        }
    }
    return result;
}
fn vertexColor(base: u32, bary: vec3<f32>) -> vec4<f32> {
    return triangles[base + 11u] * bary.x + triangles[base + 12u] * bary.y + triangles[base + 13u] * bary.z;
}
fn surfaceCovered(base: u32, bary: vec3<f32>) -> bool {
    let material = u32(triangles[base + 7u].w) * MATERIAL_STRIDE;
    let cutoff = materials[material + 3u].x;
    if (cutoff < 0.0) { return true; }
    let alpha = materials[material].a * materialSample(material, 0u, base, bary).a * vertexColor(base, bary).a;
    let opacity = select(materials[material + 1u].w, materialSample(material, 5u, base, bary).r, materials[material + 29u].w > 0.5);
    return alpha * opacity >= cutoff;
}

struct RayHit { distance: f32, triangle: u32, barycentric: vec2<f32>, backface: bool, }
fn intersectsBounds(origin: vec3<f32>, direction: vec3<f32>, minimum: vec3<f32>, maximum: vec3<f32>, limit: f32) -> bool {
    let safeDirection = select(select(vec3<f32>(-0.00000001), vec3<f32>(0.00000001), direction >= vec3<f32>(0.0)), direction, abs(direction) > vec3<f32>(0.00000001));
    let a = (minimum - origin) / safeDirection;
    let b = (maximum - origin) / safeDirection;
    let low = min(a, b);
    let high = max(a, b);
    return min(min(high.x, high.y), min(high.z, limit)) >= max(max(low.x, low.y), max(low.z, 0.0));
}
fn trace(origin: vec3<f32>, direction: vec3<f32>, limit: f32, anyHit: bool) -> RayHit {
    var hit = RayHit(limit, 0xffffffffu, vec2<f32>(0.0), false);
    if (params[6].x < 0.5) { return hit; }
    var stack: array<u32, 32>;
    stack[0] = 0u;
    var size = 1u;
    loop {
        if (size == 0u) { break; }
        size--;
        let node = stack[size] * 2u;
        let minimum = nodes[node];
        let maximum = nodes[node + 1u];
        if (!intersectsBounds(origin, direction, minimum.xyz, maximum.xyz, hit.distance)) { continue; }
        let left = bitcast<u32>(minimum.w);
        let right = bitcast<u32>(maximum.w);
        if ((right & 0x80000000u) == 0u) {
            if (size + 2u > 32u) { return RayHit(0.0, 0xffffffffu, vec2<f32>(0.0), true); }
            stack[size] = left; stack[size + 1u] = right; size += 2u;
            continue;
        }
        let count = right & 0x7fffffffu;
        for (var offset = 0u; offset < count; offset++) {
            let index = left + offset;
            let base = index * TRIANGLE_STRIDE;
            let p0 = triangles[base].xyz;
            let edge1 = triangles[base + 1u].xyz - p0;
            let edge2 = triangles[base + 2u].xyz - p0;
            let p = cross(direction, edge2);
            let determinant = dot(edge1, p);
            if (abs(determinant) < 0.00000001) { continue; }
            let inverse = 1.0 / determinant;
            let t = origin - p0;
            let u = dot(t, p) * inverse;
            if (u < 0.0 || u > 1.0) { continue; }
            let q = cross(t, edge1);
            let v = dot(direction, q) * inverse;
            if (v < 0.0 || u + v > 1.0) { continue; }
            let distance = dot(edge2, q) * inverse;
            if (distance <= 0.0001 || distance >= hit.distance) { continue; }
            if (!surfaceCovered(base, vec3<f32>(1.0 - u - v, u, v))) { continue; }
            hit = RayHit(distance, index, vec2<f32>(u, v), determinant < 0.0);
            if (anyHit) { return hit; }
        }
    }
    return hit;
}
fn radianceAtHit(origin: vec3<f32>, direction: vec3<f32>, hit: RayHit) -> vec3<f32> {
    if (hit.triangle == 0xffffffffu) { return params[7].rgb; }
    let base = hit.triangle * TRIANGLE_STRIDE;
    let doubleSided = (u32(triangles[base + 6u].w) & 1u) != 0u;
    if (hit.backface && !doubleSided) { return vec3<f32>(0.0); }
    let bary = vec3<f32>(1.0 - hit.barycentric.x - hit.barycentric.y, hit.barycentric);
    var geometric = normalize(cross(triangles[base + 1u].xyz - triangles[base].xyz, triangles[base + 2u].xyz - triangles[base].xyz));
    let interpolatedNormal = triangles[base + 3u].xyz * bary.x + triangles[base + 4u].xyz * bary.y + triangles[base + 5u].xyz * bary.z;
    var normal = geometric;
    if (dot(interpolatedNormal, interpolatedNormal) > 0.000000000001) { normal = normalize(interpolatedNormal); }
    let material = u32(triangles[base + 7u].w) * MATERIAL_STRIDE;
    if (materials[material + 34u].w > 0.5) {
        let uvSet = materials[material + 35u].w;
        let tangentBase = base + select(14u, 17u, uvSet > 0.5);
        let tangent = triangles[tangentBase] * bary.x + triangles[tangentBase + 1u] * bary.y + triangles[tangentBase + 2u] * bary.z;
        let orthogonal = tangent.xyz - normal * dot(normal, tangent.xyz);
        if (dot(orthogonal, orthogonal) > 0.000000000001) {
            let t = normalize(orthogonal);
            let b = cross(normal, t) * tangent.w;
            var sampled = materialSample(material, 6u, base, bary).rgb * 2.0 - vec3<f32>(1.0);
            sampled = vec3<f32>(sampled.xy * materials[material + 3u].z, sampled.z);
            let transformed = t * sampled.x + b * sampled.y + normal * sampled.z;
            if (dot(transformed, transformed) > 0.000000000001) { normal = normalize(transformed); }
        }
    }
    if (dot(normal, geometric) < 0.0) { normal = -normal; }
    if (hit.backface) { normal = -normal; geometric = -geometric; }
    let position = origin + direction * hit.distance;
    let baseColor = materials[material].rgb * materialSample(material, 0u, base, bary).rgb * vertexColor(base, bary).rgb;
    let painted = applyRayDecals(material, position, baseColor, normal);
    normal = painted.normal;
    let bias = max(0.0005, min(params[1].w * 0.05, 0.01));
    let shadowOrigin = position + geometric * bias;
    var irradiance = vec3<f32>(0.0);
    for (var light = 0u; light < u32(params[6].z); light++) {
        let offset = light * 5u;
        if ((bitcast<u32>(lights[offset + 4u].x) & bitcast<u32>(triangles[base].w)) == 0u) { continue; }
        let positionRange = lights[offset];
        let colorType = lights[offset + 1u];
        let directionOuter = lights[offset + 2u];
        let attenuationInner = lights[offset + 3u];
        var lightDirection = -directionOuter.xyz;
        var distance = params[4].z;
        var attenuation = 1.0;
        if (colorType.w < 1.5) {
            let delta = positionRange.xyz - position;
            distance = length(delta);
            if (distance <= 0.0001 || (positionRange.w > 0.0 && distance >= positionRange.w)) { continue; }
            lightDirection = delta / distance;
            attenuation = 1.0 / max(dot(attenuationInner.xyz, vec3<f32>(1.0, distance, distance * distance)), 0.0001);
            if (positionRange.w > 0.0) {
                let rangeFade = max(1.0 - pow(distance / positionRange.w, 4.0), 0.0);
                attenuation *= rangeFade * rangeFade;
            }
            if (colorType.w > 0.5) { attenuation *= smoothstep(directionOuter.w, attenuationInner.w, dot(lightDirection, -directionOuter.xyz)); }
        }
        let cosine = max(dot(normal, lightDirection), 0.0);
        if (cosine <= 0.0 || attenuation <= 0.00001) { continue; }
        let blocker = trace(shadowOrigin, lightDirection, max(distance - bias * 2.0, 0.0001), true);
        if (blocker.triangle == 0xffffffffu) { irradiance += colorType.rgb * (cosine * attenuation / PI); }
    }
    irradiance += historyIrradiance(position, normal) * params[7].w;
    var diffuseWeight = 1.0 - clamp(materials[material + 2u].x * materialSample(material, 2u, base, bary).r * materialSample(material, 3u, base, bary).b, 0.0, 1.0);
    if (materials[material + 3u].y > 0.5) {
        let specular = materials[material + 2u].yzw * materialSample(material, 4u, base, bary).rgb;
        diffuseWeight = 1.0 - max(max(specular.r, specular.g), specular.b);
    }
    let emission = materials[material + 1u].rgb * materialSample(material, 1u, base, bary).rgb;
    var baked = vec3<f32>(0.0);
    if (materials[material + 39u].w > 0.5) {
        let lightmap = materialSample(material, 7u, base, bary);
        baked = painted.color * lightmap.rgb / max(lightmap.a, 0.000001);
    }
    return emission + baked + painted.color * max(diffuseWeight, 0.0) * irradiance;
}
fn rayDirection(index: u32, phase: f32) -> vec3<f32> {
    let y = 1.0 - 2.0 * (f32(index) + 0.5) / f32(RAY_COUNT);
    let radius = sqrt(max(1.0 - y * y, 0.0));
    let angle = f32(index) * 2.39996322973 + phase;
    return vec3<f32>(cos(angle) * radius, y, sin(angle) * radius);
}
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) group: vec3<u32>, @builtin(local_invocation_index) lane: u32) {
    let probe = group.x;
    let counts = vec3<u32>(params[2].xyz);
    let probeCount = counts.x * counts.y * counts.z;
    let base = 4u + probe * 130u;
    let validHistory = params[5].w > 0.5;
    if (probe == 0u && lane < 4u) { current[lane] = params[lane]; }
    if (probe == 0u && lane == 0u) { textureStore(historyMarker, vec2<i32>(0), vec4<f32>(1.0)); }
    let scheduled = (probe + probeCount - u32(params[5].x)) % probeCount < u32(params[5].y);
    if (!scheduled) {
        for (var item = lane; item < 130u; item += 64u) {
            var value = vec4<f32>(0.0);
            if (validHistory) { value = previous[base + item]; }
            current[base + item] = value;
        }
        return;
    }
    let grid = vec3<u32>(probe % counts.x, (probe / counts.x) % counts.y, probe / (counts.x * counts.y));
    let nominal = params[0].xyz + vec3<f32>(grid) * params[1].xyz;
    var offset = vec3<f32>(0.0);
    if (validHistory) { offset = previous[base].xyz; }
    let origin = nominal + offset;
    // Stable, spatially decorrelated quadrature: changing all rays on each budgeted visit
    // made a static emitter/occluder look dynamic and moved probes between visits.
    let phase = f32((probe * 747796405u + 2891336453u) & 65535u) * (2.0 * PI / 65536.0);
    for (var ray = lane; ray < RAY_COUNT; ray += 64u) {
        let direction = rayDirection(ray, phase);
        let hit = trace(origin, direction, params[4].z, false);
        let color = max(radianceAtHit(origin, direction, hit), vec3<f32>(0.0));
        let peak = max(color.x, max(color.y, color.z));
        let limited = color * min(1.0, params[4].w / max(peak, 0.00001));
        var distance = hit.distance;
        if (hit.backface && hit.triangle != 0xffffffffu && (u32(triangles[hit.triangle * TRIANGLE_STRIDE + 6u].w) & 1u) == 0u) { distance = -distance; }
        raySamples[ray] = vec4<f32>(limited, distance);
        rayDirections[ray] = vec4<f32>(direction, 0.0);
    }
    workgroupBarrier();
    if (lane == 0u) {
        var backfaces = 0u;
        var nearestBack = params[4].z;
        var nearestFront = params[4].z;
        var backDirection = vec3<f32>(0.0);
        var frontDirection = vec3<f32>(0.0);
        for (var ray = 0u; ray < RAY_COUNT; ray++) {
            let distance = raySamples[ray].w;
            if (distance < 0.0) {
                backfaces++;
                if (-distance < nearestBack) { nearestBack = -distance; backDirection = rayDirections[ray].xyz; }
            } else if (distance < nearestFront) { nearestFront = distance; frontDirection = rayDirections[ray].xyz; }
        }
        let backRatio = f32(backfaces) / f32(RAY_COUNT);
        var newOffset = offset;
        let minimumSpacing = min(params[1].x, min(params[1].y, params[1].z));
        // Once a probe is valid, its position remains fixed until the ray scene changes.
        // Inactive probes may continue escaping a solid within their bounded cell offset.
        let geometryChanged = !validHistory || previous[base + 1u].y != params[6].w;
        if (params[3].y > 0.5 && (geometryChanged || previous[base].w < 0.5)) {
            if (backRatio > 0.25) { newOffset += backDirection * (nearestBack + minimumSpacing * 0.08); }
            else if (nearestFront < minimumSpacing * 0.12) { newOffset -= frontDirection * (minimumSpacing * 0.12 - nearestFront); }
            newOffset = clamp(newOffset, -params[1].xyz * 0.45, params[1].xyz * 0.45);
        }
        let relocated = length(newOffset - offset) > minimumSpacing * 0.01;
        probeState = vec4<f32>(newOffset, select(0.0, 1.0, backRatio <= 0.25 && !relocated));
        var updates = 1.0;
        if (validHistory) { updates += previous[base + 1u].w; }
        probeMetadata = vec4<f32>(params[3].z, params[6].w, backRatio, min(updates, 65535.0));
        current[base] = probeState;
        current[base + 1u] = probeMetadata;
    }
    workgroupBarrier();
    let direction = octDirection(lane);
    var irradiance = vec3<f32>(0.0);
    var moments = vec2<f32>(0.0);
    var momentWeight = 0.0;
    for (var ray = 0u; ray < RAY_COUNT; ray++) {
        let cosine = max(dot(direction, rayDirections[ray].xyz), 0.0);
        irradiance += raySamples[ray].rgb * cosine;
        let weight = pow(cosine, 32.0);
        let distance = abs(raySamples[ray].w);
        moments += vec2<f32>(distance, distance * distance) * weight;
        momentWeight += weight;
    }
    irradiance *= 4.0 / f32(RAY_COUNT);
    moments /= max(momentWeight, 0.000001);
    let geometryHistoryValid = validHistory && previous[base].w >= 0.5 && probeState.w >= 0.5 && previous[base + 1u].y == params[6].w;
    let radianceHistoryValid = geometryHistoryValid && previous[base + 1u].x == params[3].z;
    let historyWeight = select(0.0, params[4].x, radianceHistoryValid);
    let momentHistoryWeight = select(0.0, params[4].x, geometryHistoryValid);
    let oldIrradiance = previous[base + 2u + lane].rgb;
    current[base + 2u + lane] = vec4<f32>(mix(irradiance, oldIrradiance, historyWeight), 1.0);
    current[base + 66u + lane] = vec4<f32>(mix(moments, previous[base + 66u + lane].xy, momentHistoryWeight), 0.0, 0.0);
}
`,
        entryPoint: 'main',
        workgroupSize: [64],
        bindings: [
            {
                name: 'params',
                group: 0,
                binding: 0,
                kind: 'read-only-storage-buffer',
                minBindingSize: 128
            },
            {
                name: 'triangles',
                group: 0,
                binding: 1,
                kind: 'read-only-storage-buffer',
                minBindingSize: RAY_TRIANGLE_FLOATS * 4
            },
            {
                name: 'nodes',
                group: 0,
                binding: 2,
                kind: 'read-only-storage-buffer',
                minBindingSize: 32
            },
            {
                name: 'lights',
                group: 0,
                binding: 3,
                kind: 'read-only-storage-buffer',
                minBindingSize: 80
            },
            {
                name: 'previous',
                group: 0,
                binding: 4,
                kind: 'read-only-storage-buffer',
                minBindingSize: settings.probeBufferBytes
            },
            {
                name: 'current',
                group: 0,
                binding: 5,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: settings.probeBufferBytes
            },
            {
                name: 'historyMarker',
                group: 0,
                binding: 6,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'r32float'
            },
            {
                name: 'materials',
                group: 0,
                binding: 7,
                kind: 'read-only-storage-buffer',
                minBindingSize: RAY_MATERIAL_BYTES
            },
            {
                name: 'texels',
                group: 0,
                binding: 8,
                kind: 'read-only-storage-buffer',
                minBindingSize: 16
            }
        ]
    });
}
