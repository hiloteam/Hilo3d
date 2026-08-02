import * as Hilo3d from '../src/Hilo3d';

const TARGET_WIDTH = 960;
const TARGET_HEIGHT = 540;
const TARGET_ASPECT = TARGET_WIDTH / TARGET_HEIGHT;
const WORKGROUP_SIZE = 8;
const PIXEL_RECORD_VEC4S = 2;
const ACCUMULATION_BYTE_LENGTH = TARGET_WIDTH * TARGET_HEIGHT * PIXEL_RECORD_VEC4S * 16;
const FULL_VIEWPORT = Object.freeze([0, 0, TARGET_WIDTH, TARGET_HEIGHT] as const);
const CLEAR_COLOR = Object.freeze({ r: 0.003, g: 0.005, b: 0.012, a: 1 });
const REQUIRED_CAPABILITIES: readonly Hilo3d.RenderPipelineCapabilityName[] = Object.freeze([
    'storage-buffer',
    'compute-pass'
]);
const portableCoordinateShader = Hilo3d.Shader.shaders['method/portableCoordinates.glsl'];
if (portableCoordinateShader === undefined) {
    throw new Error('Portable coordinate shader helpers are unavailable');
}

const frameLayout = Hilo3d.createStd140Layout({
    u_resolution: 'vec4',
    u_camera: 'vec4',
    u_target: 'vec4',
    u_render: 'vec4'
});

const frameBlock = Hilo3d.UniformBuffer.fromSchema(frameLayout, {
    u_resolution: [TARGET_WIDTH, TARGET_HEIGHT, 1 / TARGET_WIDTH, 1 / TARGET_HEIGHT],
    u_camera: [0.06, 0.23, 5.35, 0],
    u_target: [0, 0.9, -0.12, 1.14],
    u_render: [0, 0.012, 5.45, 0]
});

const RAYTRACE_PASS = new Hilo3d.ComputeRenderPass(
    new Hilo3d.ComputeKernel({
        label: 'Hilo3D progressive crystal path tracer',
        shader: new Hilo3d.ComputeShader({
            label: 'Hilo3D progressive crystal path tracer',
            source: `
struct FrameBlock {
    resolution: vec4<f32>,
    camera: vec4<f32>,
    lookAt: vec4<f32>,
    render: vec4<f32>,
};

struct Hit {
    distance: f32,
    position: vec3<f32>,
    normal: vec3<f32>,
    material: u32,
};

struct TraceResult {
    radiance: vec3<f32>,
    guide: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: FrameBlock;
@group(0) @binding(1) var<storage, read_write> accumulation: array<vec4<f32>>;

const PI: f32 = 3.141592653589793;
const EPSILON: f32 = 0.0025;
const FAR_DISTANCE: f32 = 1.0e20;

fn random(state: ptr<function, u32>) -> f32 {
    var value = *state;
    value = value ^ (value << 13u);
    value = value ^ (value >> 17u);
    value = value ^ (value << 5u);
    *state = value;
    return f32(value) * (1.0 / 4294967296.0);
}

fn hashPixel(pixel: vec2<u32>, sampleIndex: u32) -> u32 {
    var value = pixel.x * 1973u + pixel.y * 9277u + sampleIndex * 26699u + 0x68bc21ebu;
    value = (value ^ (value >> 16u)) * 0x7feb352du;
    value = (value ^ (value >> 15u)) * 0x846ca68bu;
    return (value ^ (value >> 16u)) | 1u;
}

fn missHit() -> Hit {
    return Hit(FAR_DISTANCE, vec3<f32>(0.0), vec3<f32>(0.0, 1.0, 0.0), 0u);
}

fn sdBox2(point: vec2<f32>, halfSize: vec2<f32>) -> f32 {
    let q = abs(point) - halfSize;
    return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0);
}

fn sdRoundBox2(point: vec2<f32>, halfSize: vec2<f32>, radius: f32) -> f32 {
    let q = abs(point) - halfSize + vec2<f32>(radius);
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - radius;
}

fn glyphH(point: vec2<f32>) -> f32 {
    let left = sdBox2(point - vec2<f32>(-0.205, 0.0), vec2<f32>(0.062, 0.34));
    let right = sdBox2(point - vec2<f32>(0.205, 0.0), vec2<f32>(0.062, 0.34));
    let bridge = sdBox2(point, vec2<f32>(0.21, 0.058));
    return min(min(left, right), bridge);
}

fn glyphI(point: vec2<f32>) -> f32 {
    let stem = sdBox2(point - vec2<f32>(0.0, -0.075), vec2<f32>(0.066, 0.255));
    let dot = sdRoundBox2(point - vec2<f32>(0.0, 0.285), vec2<f32>(0.075), 0.035);
    return min(stem, dot);
}

fn glyphL(point: vec2<f32>) -> f32 {
    let stem = sdBox2(point - vec2<f32>(-0.14, 0.0), vec2<f32>(0.064, 0.34));
    let foot = sdBox2(point - vec2<f32>(0.025, -0.28), vec2<f32>(0.225, 0.06));
    return min(stem, foot);
}

fn glyphO(point: vec2<f32>) -> f32 {
    return abs(sdRoundBox2(point, vec2<f32>(0.23, 0.315), 0.155)) - 0.058;
}

fn glyphThree(point: vec2<f32>) -> f32 {
    let top = sdBox2(point - vec2<f32>(-0.015, 0.28), vec2<f32>(0.22, 0.057));
    let middle = sdBox2(point, vec2<f32>(0.19, 0.057));
    let bottom = sdBox2(point - vec2<f32>(-0.015, -0.28), vec2<f32>(0.22, 0.057));
    let upper = sdBox2(point - vec2<f32>(0.175, 0.145), vec2<f32>(0.057, 0.145));
    let lower = sdBox2(point - vec2<f32>(0.175, -0.145), vec2<f32>(0.057, 0.145));
    return min(min(min(top, middle), min(bottom, upper)), lower);
}

fn glyphD(point: vec2<f32>) -> f32 {
    let stem = sdBox2(point - vec2<f32>(-0.19, 0.0), vec2<f32>(0.062, 0.34));
    let shell = abs(sdRoundBox2(point - vec2<f32>(-0.04, 0.0), vec2<f32>(0.255, 0.315), 0.18))
        - 0.056;
    let crop = sdBox2(point - vec2<f32>(0.035, 0.0), vec2<f32>(0.28, 0.36));
    return min(stem, max(shell, crop));
}

fn textDistance(worldPoint: vec3<f32>) -> f32 {
    let point = worldPoint - vec3<f32>(0.0, 1.48, -0.62);
    var distance2 = glyphH(point.xy - vec2<f32>(-1.72, 0.0));
    distance2 = min(distance2, glyphI(point.xy - vec2<f32>(-1.08, 0.0)));
    distance2 = min(distance2, glyphL(point.xy - vec2<f32>(-0.51, 0.0)));
    distance2 = min(distance2, glyphO(point.xy - vec2<f32>(0.13, 0.0)));
    distance2 = min(distance2, glyphThree(point.xy - vec2<f32>(0.83, 0.0)));
    distance2 = min(distance2, glyphD(point.xy - vec2<f32>(1.55, 0.0)));
    let extrusion = abs(point.z) - 0.115;
    let bevel = vec2<f32>(distance2, extrusion);
    return min(max(bevel.x, bevel.y), 0.0)
        + length(max(bevel, vec2<f32>(0.0)))
        - 0.022;
}

fn textNormal(point: vec3<f32>) -> vec3<f32> {
    let offset = 0.0018;
    return normalize(vec3<f32>(
        textDistance(point + vec3<f32>(offset, 0.0, 0.0))
            - textDistance(point - vec3<f32>(offset, 0.0, 0.0)),
        textDistance(point + vec3<f32>(0.0, offset, 0.0))
            - textDistance(point - vec3<f32>(0.0, offset, 0.0)),
        textDistance(point + vec3<f32>(0.0, 0.0, offset))
            - textDistance(point - vec3<f32>(0.0, 0.0, offset))
    ));
}

fn boxInterval(
    rayOrigin: vec3<f32>,
    rayDirection: vec3<f32>,
    center: vec3<f32>,
    halfSize: vec3<f32>
) -> vec2<f32> {
    let inverseDirection = 1.0 / rayDirection;
    let first = (center - halfSize - rayOrigin) * inverseDirection;
    let second = (center + halfSize - rayOrigin) * inverseDirection;
    let nearPlane = min(first, second);
    let farPlane = max(first, second);
    return vec2<f32>(
        max(max(nearPlane.x, nearPlane.y), nearPlane.z),
        min(min(farPlane.x, farPlane.y), farPlane.z)
    );
}

fn intersectText(rayOrigin: vec3<f32>, rayDirection: vec3<f32>) -> Hit {
    let interval = boxInterval(
        rayOrigin,
        rayDirection,
        vec3<f32>(0.0, 1.48, -0.62),
        vec3<f32>(2.12, 0.45, 0.19)
    );
    if (interval.y < max(interval.x, EPSILON)) {
        return missHit();
    }
    var distance = max(interval.x, EPSILON);
    for (var step = 0u; step < 48u; step += 1u) {
        if (distance > interval.y) {
            break;
        }
        let point = rayOrigin + rayDirection * distance;
        let surfaceDistance = textDistance(point);
        if (abs(surfaceDistance) < 0.0015) {
            return Hit(distance, point, textNormal(point), 1u);
        }
        distance += max(abs(surfaceDistance) * 0.78, 0.0035);
    }
    return missHit();
}

fn intersectSphere(
    rayOrigin: vec3<f32>,
    rayDirection: vec3<f32>,
    center: vec3<f32>,
    radius: f32,
    material: u32
) -> Hit {
    let offset = rayOrigin - center;
    let halfB = dot(offset, rayDirection);
    let c = dot(offset, offset) - radius * radius;
    let discriminant = halfB * halfB - c;
    if (discriminant < 0.0) {
        return missHit();
    }
    let root = sqrt(discriminant);
    var distance = -halfB - root;
    if (distance <= EPSILON) {
        distance = -halfB + root;
    }
    if (distance <= EPSILON) {
        return missHit();
    }
    let position = rayOrigin + rayDirection * distance;
    return Hit(distance, position, normalize(position - center), material);
}

fn intersectBox(
    rayOrigin: vec3<f32>,
    rayDirection: vec3<f32>,
    center: vec3<f32>,
    halfSize: vec3<f32>,
    material: u32
) -> Hit {
    let interval = boxInterval(rayOrigin, rayDirection, center, halfSize);
    if (interval.y <= EPSILON || interval.x > interval.y) {
        return missHit();
    }
    let distance = select(interval.x, interval.y, interval.x <= EPSILON);
    let position = rayOrigin + rayDirection * distance;
    let local = (position - center) / halfSize;
    let absoluteLocal = abs(local);
    var normal = vec3<f32>(0.0, 0.0, sign(local.z));
    if (absoluteLocal.x > absoluteLocal.y && absoluteLocal.x > absoluteLocal.z) {
        normal = vec3<f32>(sign(local.x), 0.0, 0.0);
    } else if (absoluteLocal.y > absoluteLocal.z) {
        normal = vec3<f32>(0.0, sign(local.y), 0.0);
    }
    return Hit(distance, position, normal, material);
}

fn rotateY(point: vec3<f32>, angle: f32) -> vec3<f32> {
    let cosine = cos(angle);
    let sine = sin(angle);
    return vec3<f32>(
        cosine * point.x - sine * point.z,
        point.y,
        sine * point.x + cosine * point.z
    );
}

fn sdRoundBox3(point: vec3<f32>, halfSize: vec3<f32>, radius: f32) -> f32 {
    let q = abs(point) - halfSize + vec3<f32>(radius);
    return min(max(q.x, max(q.y, q.z)), 0.0)
        + length(max(q, vec3<f32>(0.0)))
        - radius;
}

fn roundedBoxNormal(
    point: vec3<f32>,
    halfSize: vec3<f32>,
    radius: f32
) -> vec3<f32> {
    let offset = 0.0015;
    return normalize(vec3<f32>(
        sdRoundBox3(point + vec3<f32>(offset, 0.0, 0.0), halfSize, radius)
            - sdRoundBox3(point - vec3<f32>(offset, 0.0, 0.0), halfSize, radius),
        sdRoundBox3(point + vec3<f32>(0.0, offset, 0.0), halfSize, radius)
            - sdRoundBox3(point - vec3<f32>(0.0, offset, 0.0), halfSize, radius),
        sdRoundBox3(point + vec3<f32>(0.0, 0.0, offset), halfSize, radius)
            - sdRoundBox3(point - vec3<f32>(0.0, 0.0, offset), halfSize, radius)
    ));
}

fn intersectRoundedBox(
    rayOrigin: vec3<f32>,
    rayDirection: vec3<f32>,
    center: vec3<f32>,
    halfSize: vec3<f32>,
    radius: f32,
    angle: f32,
    material: u32
) -> Hit {
    let localOrigin = rotateY(rayOrigin - center, -angle);
    let localDirection = rotateY(rayDirection, -angle);
    let interval = boxInterval(
        localOrigin,
        localDirection,
        vec3<f32>(0.0),
        halfSize
    );
    if (interval.y <= EPSILON || interval.x > interval.y) {
        return missHit();
    }
    var distance = max(interval.x, EPSILON);
    for (var step = 0u; step < 32u; step += 1u) {
        if (distance > interval.y) {
            break;
        }
        let point = localOrigin + localDirection * distance;
        let surfaceDistance = sdRoundBox3(point, halfSize, radius);
        if (abs(surfaceDistance) < 0.0015) {
            return Hit(
                distance,
                rayOrigin + rayDirection * distance,
                normalize(rotateY(roundedBoxNormal(point, halfSize, radius), angle)),
                material
            );
        }
        distance += max(abs(surfaceDistance) * 0.8, 0.0025);
    }
    return missHit();
}

fn waterNormal(position: vec3<f32>) -> vec3<f32> {
    let phaseA = position.x * 1.45 + position.z * 1.1;
    let phaseB = position.x * -2.25 + position.z * 1.7 + 1.3;
    let phaseC = position.x * 4.4 + position.z * -3.1 + 0.6;
    let derivativeX = 0.034 * 1.45 * cos(phaseA)
        + 0.018 * -2.25 * cos(phaseB)
        + 0.006 * 4.4 * cos(phaseC);
    let derivativeZ = 0.034 * 1.1 * cos(phaseA)
        + 0.018 * 1.7 * cos(phaseB)
        + 0.006 * -3.1 * cos(phaseC);
    return normalize(vec3<f32>(-derivativeX, 1.0, -derivativeZ));
}

fn traceScene(rayOrigin: vec3<f32>, rayDirection: vec3<f32>) -> Hit {
    var closest = missHit();

    if (abs(rayDirection.y) > 0.00001) {
        let floorDistance = -rayOrigin.y / rayDirection.y;
        if (floorDistance > EPSILON && floorDistance < closest.distance) {
            let position = rayOrigin + rayDirection * floorDistance;
            closest = Hit(
                floorDistance,
                position,
                waterNormal(position),
                5u
            );
        }
    }

    let crystalSphere = intersectSphere(
        rayOrigin,
        rayDirection,
        vec3<f32>(-1.27, 0.53, 0.24),
        0.53,
        2u
    );
    if (crystalSphere.distance < closest.distance) {
        closest = crystalSphere;
    }

    let metalCube = intersectRoundedBox(
        rayOrigin,
        rayDirection,
        vec3<f32>(1.26, 0.405, 0.02),
        vec3<f32>(0.405),
        0.065,
        -0.31,
        3u
    );
    if (metalCube.distance < closest.distance) {
        closest = metalCube;
    }

    let moon = intersectSphere(
        rayOrigin,
        rayDirection,
        vec3<f32>(0.18, 0.34, -1.24),
        0.16,
        4u
    );
    if (moon.distance < closest.distance) {
        closest = moon;
    }

    let crystalCore = intersectSphere(
        rayOrigin,
        rayDirection,
        vec3<f32>(-1.27, 0.53, 0.24),
        0.115,
        6u
    );
    if (crystalCore.distance < closest.distance) {
        closest = crystalCore;
    }

    let text = intersectText(rayOrigin, rayDirection);
    if (text.distance < closest.distance) {
        closest = text;
    }
    return closest;
}

fn environment(direction: vec3<f32>) -> vec3<f32> {
    let vertical = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
    var color = mix(
        vec3<f32>(0.003, 0.004, 0.016),
        vec3<f32>(0.022, 0.042, 0.125),
        pow(vertical, 0.78)
    );
    let horizon = exp(-abs(direction.y + 0.025) * 18.0);
    color += vec3<f32>(0.19, 0.035, 0.16) * horizon;
    color += vec3<f32>(0.025, 0.13, 0.2)
        * exp(-abs(direction.y - 0.08) * 9.0)
        * (0.35 + 0.65 * sin(direction.x * 3.2 + 1.4) * sin(direction.x * 3.2 + 1.4));

    let auroraRibbon = pow(
        0.5 + 0.5 * sin(
            direction.x * 11.0
                + direction.z * 4.0
                + sin(direction.y * 8.0 + direction.x * 2.5) * 2.1
        ),
        15.0
    ) * smoothstep(0.02, 0.7, direction.y) * (1.0 - smoothstep(0.72, 0.98, direction.y));
    let auroraFade = 0.35 + 0.65 * pow(1.0 - vertical, 1.4);
    color += mix(
        vec3<f32>(0.015, 0.25, 0.31),
        vec3<f32>(0.32, 0.035, 0.34),
        0.5 + 0.5 * sin(direction.x * 5.0)
    ) * auroraRibbon * auroraFade;

    let starCell = floor(direction * 640.0);
    let starNoise = fract(
        sin(dot(starCell, vec3<f32>(12.9898, 78.233, 45.164))) * 43758.5453
    );
    let star = pow(starNoise, 520.0) * smoothstep(0.06, 0.38, direction.y);
    color += vec3<f32>(0.72, 0.86, 1.0) * star * 1.8;

    let sunsetDirection = normalize(vec3<f32>(-0.42, 0.03, -0.907));
    let sunCosine = max(dot(direction, sunsetDirection), 0.0);
    let sunDisc = pow(sunCosine, 1650.0);
    let sunHalo = pow(sunCosine, 38.0);
    color += vec3<f32>(9.0, 1.45, 0.32) * sunDisc;
    color += vec3<f32>(0.92, 0.07, 0.2) * sunHalo;

    let coolDirection = normalize(vec3<f32>(0.68, 0.4, -0.62));
    color += vec3<f32>(1.1, 4.8, 9.0)
        * pow(max(dot(direction, coolDirection), 0.0), 190.0);
    return color;
}

fn cosineHemisphere(
    normal: vec3<f32>,
    firstRandom: f32,
    secondRandom: f32
) -> vec3<f32> {
    let radius = sqrt(firstRandom);
    let angle = 2.0 * PI * secondRandom;
    let local = vec3<f32>(
        radius * cos(angle),
        radius * sin(angle),
        sqrt(max(0.0, 1.0 - firstRandom))
    );
    let helper = select(
        vec3<f32>(0.0, 1.0, 0.0),
        vec3<f32>(1.0, 0.0, 0.0),
        abs(normal.y) > 0.9
    );
    let tangent = normalize(cross(helper, normal));
    let bitangent = cross(normal, tangent);
    return normalize(tangent * local.x + bitangent * local.y + normal * local.z);
}

fn fresnelSchlick(cosine: f32, ior: f32) -> f32 {
    let base = (1.0 - ior) / (1.0 + ior);
    let reflectance = base * base;
    return reflectance + (1.0 - reflectance) * pow(1.0 - cosine, 5.0);
}

fn visibleToLight(origin: vec3<f32>, lightPoint: vec3<f32>) -> bool {
    let delta = lightPoint - origin;
    let distance = length(delta);
    let blocker = traceScene(origin, delta / distance);
    return blocker.distance > distance - 0.015;
}

fn directLight(
    position: vec3<f32>,
    normal: vec3<f32>,
    state: ptr<function, u32>
) -> vec3<f32> {
    let chooseCool = random(state) > 0.72;
    var lightPosition = vec3<f32>(
        -2.7 + (random(state) - 0.5) * 3.0,
        4.6,
        1.8 + (random(state) - 0.5) * 1.5
    );
    var lightColor = vec3<f32>(11.5, 8.4, 6.5);
    if (chooseCool) {
        lightPosition = vec3<f32>(
            2.9,
            1.4 + (random(state) - 0.5) * 1.6,
            -0.6 + (random(state) - 0.5) * 2.3
        );
        lightColor = vec3<f32>(3.6, 8.8, 14.0);
    }
    let toLight = lightPosition - position;
    let distanceSquared = dot(toLight, toLight);
    let lightDirection = toLight / sqrt(distanceSquared);
    let cosine = max(dot(normal, lightDirection), 0.0);
    if (cosine <= 0.0 || !visibleToLight(position + normal * EPSILON * 2.0, lightPosition)) {
        return vec3<f32>(0.0);
    }
    return lightColor * cosine / max(distanceSquared * 0.16, 1.0);
}

fn sphereCaustic(position: vec3<f32>) -> vec3<f32> {
    let lightDirection = normalize(vec3<f32>(-0.48, 0.86, 0.18));
    let sphereCenter = vec3<f32>(-1.27, 0.53, 0.24);
    let projectedCenter = sphereCenter
        - lightDirection * (sphereCenter.y / lightDirection.y);
    let local = position.xz - projectedCenter.xz;
    let radius = length(local * vec2<f32>(1.08, 0.84));
    let red = exp(-pow((radius - 0.355) / 0.055, 2.0));
    let green = exp(-pow((radius - 0.31) / 0.05, 2.0));
    let blue = exp(-pow((radius - 0.268) / 0.045, 2.0));
    let focus = exp(-radius * radius * 34.0);
    return vec3<f32>(red * 1.55, green * 1.3, blue * 1.8)
        + focus * vec3<f32>(2.0, 1.7, 2.35);
}

fn textCaustic(position: vec3<f32>) -> vec3<f32> {
    let lightDirection = normalize(vec3<f32>(0.18, 0.92, -0.35));
    let projectionDistance = (-0.62 - position.z) / lightDirection.z;
    if (projectionDistance <= 0.0) {
        return vec3<f32>(0.0);
    }
    let projected = position + lightDirection * projectionDistance;
    if (projected.y < 1.02 || projected.y > 1.94) {
        return vec3<f32>(0.0);
    }
    let spectralOffset = vec3<f32>(0.014, 0.0, 0.0);
    let redDistance = textDistance(projected - spectralOffset);
    let greenDistance = textDistance(projected);
    let blueDistance = textDistance(projected + spectralOffset);
    let spectralEdge = vec3<f32>(
        exp(-abs(redDistance) * 105.0),
        exp(-abs(greenDistance) * 105.0),
        exp(-abs(blueDistance) * 105.0)
    );
    let interior = smoothstep(0.022, -0.018, greenDistance);
    return spectralEdge * vec3<f32>(1.6, 1.3, 2.0)
        + interior * vec3<f32>(0.1, 0.045, 0.16);
}

fn henyeyGreenstein(cosine: f32, anisotropy: f32) -> f32 {
    let numerator = 1.0 - anisotropy * anisotropy;
    let denominator = pow(
        max(1.0 + anisotropy * anisotropy - 2.0 * anisotropy * cosine, 0.0001),
        1.5
    );
    return numerator / (4.0 * PI * denominator);
}

fn volumeVisibility(position: vec3<f32>, lightDirection: vec3<f32>) -> f32 {
    let blocker = traceScene(position + lightDirection * EPSILON * 3.0, lightDirection);
    if (blocker.material == 0u) {
        return 1.0;
    }
    if (blocker.material == 1u || blocker.material == 2u) {
        return 0.38;
    }
    return 0.0;
}

fn integrateVolume(
    rayOrigin: vec3<f32>,
    rayDirection: vec3<f32>,
    maximumDistance: f32
) -> vec3<f32> {
    let stepCount = 6u;
    let integrationDistance = min(maximumDistance, 8.5);
    if (integrationDistance <= 0.01) {
        return vec3<f32>(0.0);
    }
    let stepLength = integrationDistance / f32(stepCount);
    let lightDirection = normalize(vec3<f32>(-0.42, 0.03, -0.907));
    let phase = henyeyGreenstein(dot(rayDirection, lightDirection), 0.58);
    let jitter = 0.5;
    var transmittance = 1.0;
    var scattering = vec3<f32>(0.0);
    for (var step = 0u; step < stepCount; step += 1u) {
        let distance = (f32(step) + jitter) * stepLength;
        let position = rayOrigin + rayDirection * distance;
        let mist = 0.72 + 0.28 * sin(position.x * 0.72 + position.z * 0.48);
        let density = 0.018
            * exp(-max(position.y, 0.0) * 0.42)
            * mist;
        let visibility = volumeVisibility(position, lightDirection);
        let sunScatter = vec3<f32>(4.2, 0.62, 0.34)
            * phase
            * visibility;
        let skyScatter = vec3<f32>(0.018, 0.04, 0.08);
        scattering += transmittance
            * density
            * (sunScatter + skyScatter)
            * stepLength;
        transmittance *= exp(-density * stepLength * 1.35);
    }
    return scattering;
}

fn tracePath(
    initialOrigin: vec3<f32>,
    initialDirection: vec3<f32>,
    state: ptr<function, u32>
) -> TraceResult {
    var rayOrigin = initialOrigin;
    var rayDirection = initialDirection;
    var throughput = vec3<f32>(1.0);
    var radiance = vec3<f32>(0.0);
    var guide = vec4<f32>(0.0);
    let spectralBand = min(u32(random(state) * 3.0), 2u);
    let primaryHit = traceScene(initialOrigin, initialDirection);
    let volumeDistance = select(primaryHit.distance, 8.5, primaryHit.material == 0u);
    radiance += integrateVolume(
        initialOrigin,
        initialDirection,
        volumeDistance
    );

    for (var bounce = 0u; bounce < 5u; bounce += 1u) {
        let hit = traceScene(rayOrigin, rayDirection);
        if (hit.material == 0u) {
            radiance += throughput * environment(rayDirection);
            break;
        }

        let frontFace = dot(rayDirection, hit.normal) < 0.0;
        let orientedNormal = select(-hit.normal, hit.normal, frontFace);
        if (bounce == 0u) {
            guide = vec4<f32>(orientedNormal, hit.distance);
        }

        if (hit.material == 6u) {
            let pulse = 0.82 + 0.18 * sin(hit.position.y * 32.0);
            radiance += throughput
                * mix(
                    vec3<f32>(3.8, 0.12, 1.45),
                    vec3<f32>(0.12, 2.15, 4.2),
                    0.5 + 0.5 * hit.normal.y
                )
                * pulse;
            break;
        }

        if (hit.material == 1u || hit.material == 2u) {
            let isText = hit.material == 1u;
            var ior = select(1.36, 1.49, isText);
            var spectralWeight = vec3<f32>(1.0);
            if (isText) {
                if (spectralBand == 0u) {
                    ior = 1.462;
                    spectralWeight = vec3<f32>(3.0, 0.0, 0.0);
                } else if (spectralBand == 1u) {
                    ior = 1.492;
                    spectralWeight = vec3<f32>(0.0, 3.0, 0.0);
                } else {
                    ior = 1.528;
                    spectralWeight = vec3<f32>(0.0, 0.0, 3.0);
                }
            }
            let etaRatio = select(ior, 1.0 / ior, frontFace);
            let cosine = min(dot(-rayDirection, orientedNormal), 1.0);
            let sine = sqrt(max(0.0, 1.0 - cosine * cosine));
            let cannotRefract = etaRatio * sine > 1.0;
            let reflectionChance = fresnelSchlick(cosine, ior);
            if (isText) {
                let edgeGlow = pow(1.0 - cosine, 2.25);
                let prismPhase = 0.5 + 0.5 * sin(hit.position.x * 3.4 + hit.position.y * 4.1);
                let prismColor = mix(
                    vec3<f32>(0.08, 1.15, 1.8),
                    vec3<f32>(1.65, 0.1, 1.25),
                    prismPhase
                );
                radiance += throughput * prismColor * (0.018 + edgeGlow * 0.32);
            }
            let reflectRay = cannotRefract || random(state) < reflectionChance;
            if (reflectRay) {
                rayDirection = reflect(rayDirection, orientedNormal);
                rayOrigin = hit.position + orientedNormal * EPSILON * 2.0;
                throughput *= select(
                    vec3<f32>(0.78, 0.94, 1.0),
                    vec3<f32>(0.86, 0.95, 1.0),
                    isText
                );
            } else {
                rayDirection = refract(
                    rayDirection,
                    orientedNormal,
                    etaRatio
                );
                rayOrigin = hit.position - orientedNormal * EPSILON * 2.0;
                let textPhase = 0.5 + 0.5 * sin(hit.position.x * 3.2);
                let textTint = mix(
                    vec3<f32>(0.76, 0.96, 1.0),
                    vec3<f32>(0.96, 0.78, 1.0),
                    textPhase
                );
                let sphereTint = vec3<f32>(0.72, 0.93, 0.96);
                throughput *= select(sphereTint, textTint, isText);
                if (isText && frontFace) {
                    throughput *= spectralWeight;
                }
                if (!frontFace) {
                    throughput *= exp(
                        -select(
                            vec3<f32>(0.24, 0.055, 0.025),
                            vec3<f32>(0.08, 0.035, 0.018),
                            isText
                        ) * hit.distance
                    );
                }
            }
            radiance += throughput * vec3<f32>(0.006, 0.016, 0.03);
            continue;
        }

        if (hit.material == 3u || hit.material == 4u) {
            let isMoon = hit.material == 4u;
            let metalColor = select(
                vec3<f32>(0.98, 0.48, 0.2),
                vec3<f32>(0.18, 0.72, 1.0),
                isMoon
            );
            let roughness = select(0.075, 0.035, isMoon);
            radiance += throughput
                * metalColor
                * directLight(hit.position, orientedNormal, state)
                * 0.08;
            let reflected = reflect(rayDirection, orientedNormal);
            let diffuseLobe = cosineHemisphere(
                orientedNormal,
                random(state),
                random(state)
            );
            rayDirection = normalize(mix(reflected, diffuseLobe, roughness));
            rayOrigin = hit.position + orientedNormal * EPSILON * 2.0;
            throughput *= metalColor;
            continue;
        }

        let viewCosine = clamp(dot(-rayDirection, orientedNormal), 0.0, 1.0);
        let waterFresnel = fresnelSchlick(viewCosine, 1.333);
        let crest = pow(
            0.5 + 0.5 * sin(
                hit.position.x * 3.7
                    + hit.position.z * 4.9
                    + sin(hit.position.z * 1.4) * 1.7
            ),
            28.0
        );
        let shallow = smoothstep(0.12, 0.96, viewCosine);
        let waterBody = mix(
            vec3<f32>(0.004, 0.018, 0.038),
            vec3<f32>(0.012, 0.085, 0.12),
            shallow
        );
        let sunsetDirection = normalize(vec3<f32>(-0.42, 0.03, -0.907));
        let reflectedSun = reflect(-sunsetDirection, orientedNormal);
        let sunGlint = pow(max(dot(reflectedSun, -rayDirection), 0.0), 180.0);
        let caustic = sphereCaustic(hit.position) + textCaustic(hit.position);
        radiance += throughput
            * (
                waterBody * (1.0 - waterFresnel) * 0.42
                + crest * vec3<f32>(0.015, 0.08, 0.12) * (1.0 - waterFresnel) * 0.35
                + vec3<f32>(7.0, 0.48, 0.12) * sunGlint
                + caustic * (1.0 - waterFresnel) * 0.26
                + directLight(hit.position, orientedNormal, state) * 0.018
            );
        let reflected = reflect(rayDirection, orientedNormal);
        let roughLobe = cosineHemisphere(
            orientedNormal,
            random(state),
            random(state)
        );
        rayDirection = normalize(mix(reflected, roughLobe, 0.018));
        throughput *= mix(
            vec3<f32>(0.08, 0.31, 0.43),
            vec3<f32>(0.94, 0.97, 1.0),
            waterFresnel
        );
        rayOrigin = hit.position + orientedNormal * EPSILON * 2.0;

        if (bounce >= 2u) {
            let survival = clamp(max(max(throughput.x, throughput.y), throughput.z), 0.15, 0.92);
            if (random(state) > survival) {
                break;
            }
            throughput /= survival;
        }
    }
    return TraceResult(radiance, guide);
}

@compute @workgroup_size(${String(WORKGROUP_SIZE)}, ${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let width = u32(frame.resolution.x);
    let height = u32(frame.resolution.y);
    if (id.x >= width || id.y >= height) {
        return;
    }

    let sampleIndex = u32(frame.camera.w + 0.5);
    var state = hashPixel(id.xy, sampleIndex);
    let jitter = vec2<f32>(random(&state), random(&state));
    let pixel = (vec2<f32>(id.xy) + jitter) / frame.resolution.xy;
    var screen = pixel * 2.0 - vec2<f32>(1.0);
    screen.y = -screen.y;
    screen.x *= frame.resolution.x / frame.resolution.y;

    let yaw = frame.camera.x;
    let pitch = frame.camera.y;
    let distance = frame.camera.z;
    let lookAt = frame.lookAt.xyz;
    let cameraPosition = lookAt + vec3<f32>(
        sin(yaw) * cos(pitch),
        sin(pitch),
        cos(yaw) * cos(pitch)
    ) * distance;
    let forward = normalize(lookAt - cameraPosition);
    let right = normalize(cross(forward, vec3<f32>(0.0, 1.0, 0.0)));
    let up = cross(right, forward);
    let focalScale = tan(0.36);
    var rayDirection = normalize(
        forward + right * screen.x * focalScale + up * screen.y * focalScale
    );
    var rayOrigin = cameraPosition;

    let aperture = frame.render.y;
    if (aperture > 0.0) {
        let diskRadius = sqrt(random(&state)) * aperture;
        let diskAngle = random(&state) * 2.0 * PI;
        let lensOffset = right * cos(diskAngle) * diskRadius
            + up * sin(diskAngle) * diskRadius;
        let focusPoint = cameraPosition + rayDirection * frame.render.z;
        rayOrigin += lensOffset;
        rayDirection = normalize(focusPoint - rayOrigin);
    }

    let traced = tracePath(rayOrigin, rayDirection, &state);
    let sample = min(traced.radiance, vec3<f32>(10.0));
    let pixelIndex = id.y * width + id.x;
    let radianceIndex = pixelIndex * ${String(PIXEL_RECORD_VEC4S)}u;
    let guideIndex = radianceIndex + 1u;
    let previous = select(
        accumulation[radianceIndex].rgb,
        vec3<f32>(0.0),
        sampleIndex == 0u
    );
    let previousGuide = select(
        accumulation[guideIndex],
        traced.guide,
        sampleIndex == 0u
    );
    let sampleWeight = 1.0 / (f32(sampleIndex) + 1.0);
    let average = mix(previous, sample, sampleWeight);
    let guideAverage = mix(previousGuide, traced.guide, sampleWeight);
    accumulation[radianceIndex] = vec4<f32>(average, f32(sampleIndex + 1u));
    accumulation[guideIndex] = guideAverage;
}`,
            workgroupSize: [WORKGROUP_SIZE, WORKGROUP_SIZE],
            bindings: [
                {
                    name: 'frame',
                    group: 0,
                    binding: 0,
                    kind: 'uniform-buffer',
                    minBindingSize: 64
                },
                {
                    name: 'accumulation',
                    group: 0,
                    binding: 1,
                    kind: 'storage-buffer',
                    access: 'read-write',
                    minBindingSize: ACCUMULATION_BYTE_LENGTH
                }
            ]
        })
    }),
    'Hilo3D progressive crystal path tracer'
);

const PRESENT_PASS = new Hilo3d.GPUDrivenRenderPass({
    name: 'Hilo3D edge-aware path-tracing denoise and tonemap',
    shader: new Hilo3d.StorageGraphicsShader({
        label: 'Hilo3D edge-aware accumulation presenter',
        vertexSource: `#version 310 es
precision highp float;
precision highp int;
out vec2 v_uv;
${portableCoordinateShader}
void main() {
    vec2 corner = vec2(-1.0, -1.0);
    if (gl_VertexID == 1 || gl_VertexID >= 4) corner.x = 1.0;
    if (gl_VertexID == 2 || gl_VertexID == 3 || gl_VertexID == 5) corner.y = 1.0;
    v_uv = hiloRenderTargetUV(corner * 0.5 + 0.5);
    gl_Position = vec4(corner, 0.0, 1.0);
}`,
        fragmentSource: `#version 310 es
precision highp float;
precision highp int;
in vec2 v_uv;
layout(std430) readonly buffer AccumulationData {
    vec4 values[];
} accumulation;
layout(location = 0) out vec4 color;

vec3 acesFilm(vec3 value) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((value * (a * value + b)) / (value * (c * value + d) + e), 0.0, 1.0);
}

ivec2 clampPixel(ivec2 coordinate) {
    return clamp(coordinate, ivec2(0), ivec2(${String(TARGET_WIDTH - 1)}, ${String(TARGET_HEIGHT - 1)}));
}

int pixelRecord(ivec2 coordinate) {
    return (coordinate.y * ${String(TARGET_WIDTH)} + coordinate.x) * ${String(PIXEL_RECORD_VEC4S)};
}

vec3 radianceAt(ivec2 coordinate) {
    return accumulation.values[pixelRecord(clampPixel(coordinate))].rgb;
}

vec4 guideAt(ivec2 coordinate) {
    return accumulation.values[pixelRecord(clampPixel(coordinate)) + 1];
}

float luminance(vec3 value) {
    return dot(value, vec3(0.2126, 0.7152, 0.0722));
}

void addDenoiseTap(
    inout vec3 sum,
    inout float weightSum,
    ivec2 centerCoordinate,
    vec3 centerColor,
    vec4 centerGuide,
    ivec2 offset,
    float spatialWeight,
    float sampleCount
) {
    ivec2 coordinate = clampPixel(centerCoordinate + offset);
    vec3 sampleColor = radianceAt(coordinate);
    vec4 sampleGuide = guideAt(coordinate);
    float centerDepth = centerGuide.w;
    float sampleDepth = sampleGuide.w;
    float sameSurface = 1.0;
    if (centerDepth <= 0.0 || sampleDepth <= 0.0) {
        sameSurface = centerDepth <= 0.0 && sampleDepth <= 0.0 ? 1.0 : 0.0;
    } else {
        float relativeDepth = abs(sampleDepth - centerDepth) / max(centerDepth, 0.35);
        float depthWeight = exp(-relativeDepth * 34.0);
        vec3 centerNormal = normalize(centerGuide.xyz);
        vec3 sampleNormal = normalize(sampleGuide.xyz);
        float normalWeight = pow(max(dot(centerNormal, sampleNormal), 0.0), 24.0);
        sameSurface = depthWeight * normalWeight;
    }
    float noiseScale = 0.34 / sqrt(max(sampleCount, 1.0)) + 0.045;
    float colorWeight = exp(
        -abs(luminance(sampleColor) - luminance(centerColor)) / noiseScale
    );
    float weight = spatialWeight * sameSurface * colorWeight;
    sum += sampleColor * weight;
    weightSum += weight;
}

vec3 denoisedRadiance(ivec2 coordinate) {
    vec4 centerRecord = accumulation.values[pixelRecord(coordinate)];
    vec3 centerColor = centerRecord.rgb;
    vec4 centerGuide = guideAt(coordinate);
    float sampleCount = max(centerRecord.w, 1.0);
    int radius = sampleCount < 40.0 ? 2 : 1;
    vec3 sum = centerColor;
    float weightSum = 1.0;
    addDenoiseTap(sum, weightSum, coordinate, centerColor, centerGuide, ivec2(radius, 0), 0.78, sampleCount);
    addDenoiseTap(sum, weightSum, coordinate, centerColor, centerGuide, ivec2(-radius, 0), 0.78, sampleCount);
    addDenoiseTap(sum, weightSum, coordinate, centerColor, centerGuide, ivec2(0, radius), 0.78, sampleCount);
    addDenoiseTap(sum, weightSum, coordinate, centerColor, centerGuide, ivec2(0, -radius), 0.78, sampleCount);
    addDenoiseTap(sum, weightSum, coordinate, centerColor, centerGuide, ivec2(radius, radius), 0.48, sampleCount);
    addDenoiseTap(sum, weightSum, coordinate, centerColor, centerGuide, ivec2(-radius, radius), 0.48, sampleCount);
    addDenoiseTap(sum, weightSum, coordinate, centerColor, centerGuide, ivec2(radius, -radius), 0.48, sampleCount);
    addDenoiseTap(sum, weightSum, coordinate, centerColor, centerGuide, ivec2(-radius, -radius), 0.48, sampleCount);
    return sum / max(weightSum, 0.0001);
}

vec3 bloomTap(ivec2 coordinate) {
    return max(radianceAt(coordinate) - vec3(0.9), vec3(0.0));
}

void main() {
    ivec2 coordinate = clampPixel(
        ivec2(
            int(v_uv.x * ${String(TARGET_WIDTH)}.0),
            int(v_uv.y * ${String(TARGET_HEIGHT)}.0)
        )
    );
    vec2 uv = v_uv;
    vec3 hdr = denoisedRadiance(coordinate);
    vec3 bloom = vec3(0.0);
    bloom += bloomTap(coordinate + ivec2(3, 0));
    bloom += bloomTap(coordinate + ivec2(-3, 0));
    bloom += bloomTap(coordinate + ivec2(0, 3));
    bloom += bloomTap(coordinate + ivec2(0, -3));
    bloom += bloomTap(coordinate + ivec2(5, 5)) * 0.45;
    bloom += bloomTap(coordinate + ivec2(-5, 5)) * 0.45;
    bloom += bloomTap(coordinate + ivec2(5, -5)) * 0.45;
    bloom += bloomTap(coordinate + ivec2(-5, -5)) * 0.45;
    bloom += bloomTap(coordinate + ivec2(11, 0)) * 0.28;
    bloom += bloomTap(coordinate + ivec2(-11, 0)) * 0.28;
    bloom += bloomTap(coordinate + ivec2(21, 0)) * 0.12;
    bloom += bloomTap(coordinate + ivec2(-21, 0)) * 0.12;
    hdr += bloom * 0.07;

    vec3 mapped = acesFilm(hdr * 1.24);
    mapped = pow(mapped, vec3(1.0 / 2.2));
    mapped = mix(mapped, mapped * mapped * (3.0 - 2.0 * mapped), 0.22);
    float mappedLuminance = luminance(mapped);
    mapped = mix(vec3(mappedLuminance), mapped, 1.16);
    vec3 shadowGrade = vec3(0.91, 1.0, 1.08);
    vec3 highlightGrade = vec3(1.08, 0.97, 0.94);
    mapped *= mix(
        shadowGrade,
        highlightGrade,
        smoothstep(0.22, 0.78, mappedLuminance)
    );
    float vignette = 1.0 - smoothstep(0.36, 0.83, length((uv - 0.5) * vec2(1.0, 0.7)));
    mapped *= mix(0.64, 1.0, vignette);
    color = vec4(mapped, 1.0);
}`,
        bindings: [
            {
                name: 'accumulation',
                group: 0,
                binding: 0,
                kind: 'read-only-storage-buffer',
                minBindingSize: ACCUMULATION_BYTE_LENGTH
            }
        ]
    }),
    pipelineState: {
        ...Hilo3d.DEFAULT_MATERIAL_PIPELINE_STATE,
        depthTest: false,
        depthWrite: false,
        cullMode: 'none'
    }
});

interface RayTracingResources {
    readonly accumulation: Hilo3d.StorageBuffer;
}

class ReusableBufferBinding implements Hilo3d.ComputeBufferBinding {
    buffer!: Hilo3d.RenderGraphBufferHandle;
}

class ReusableColorAttachment implements Hilo3d.RenderPipelineColorAttachment {
    texture!: Hilo3d.RenderGraphTextureHandle;
    readonly loadOp = 'clear';
    readonly storeOp = 'store';
    readonly clearValue = CLEAR_COLOR;
}

class RayTracingComputeParameters implements Hilo3d.ComputeRenderPassParameters {
    readonly uniformBuffers = [frameBlock];
    readonly #accumulationBinding = new ReusableBufferBinding();
    readonly buffers = [this.#accumulationBinding];
    readonly textures = [];
    readonly dispatch = Object.freeze({
        x: Math.ceil(TARGET_WIDTH / WORKGROUP_SIZE),
        y: Math.ceil(TARGET_HEIGHT / WORKGROUP_SIZE)
    });

    configure(accumulation: Hilo3d.RenderGraphBufferHandle): void {
        this.#accumulationBinding.buffer = accumulation;
    }
}

class RayTracingPresentParameters implements Hilo3d.GPUDrivenRenderPassParameters {
    readonly #accumulationBinding = new ReusableBufferBinding();
    readonly #colorAttachment = new ReusableColorAttachment();
    readonly buffers = [this.#accumulationBinding];
    readonly draw = Object.freeze({ kind: 'draw' as const, vertexCount: 6 });
    readonly colorAttachments = [this.#colorAttachment];
    readonly viewport = FULL_VIEWPORT;
    readonly scissor = FULL_VIEWPORT;

    configure(
        accumulation: Hilo3d.RenderGraphBufferHandle,
        output: Hilo3d.RenderGraphTextureHandle
    ): void {
        this.#accumulationBinding.buffer = accumulation;
        this.#colorAttachment.texture = output;
    }
}

class RayTracingFrameParameters {
    readonly compute = new RayTracingComputeParameters();
    readonly present = new RayTracingPresentParameters();

    configure(
        accumulation: Hilo3d.RenderGraphBufferHandle,
        output: Hilo3d.RenderGraphTextureHandle
    ): void {
        this.compute.configure(accumulation);
        this.present.configure(accumulation, output);
    }
}

class CrystalRayTracingPipeline implements Hilo3d.RenderPipeline {
    readonly name = 'Hilo3D crystal compute path tracer';
    readonly #parameters = new Hilo3d.RenderPassParameterPool(
        () => new RayTracingFrameParameters()
    );
    #resources: RayTracingResources | null = null;

    attachResources(resources: RayTracingResources): void {
        if (this.#resources !== null) {
            throw new Error('Ray-tracing resources are already attached');
        }
        this.#resources = resources;
    }

    record(context: Hilo3d.RenderPipelineContext): void {
        const resources = this.#resources;
        if (resources === null) {
            throw new Error('Ray-tracing resources are unavailable');
        }
        const output = context.graph.importOutput().color(0);
        const accumulation = context.graph.importStorageBuffer(resources.accumulation);
        const parameters = context.acquirePassParameters(this.#parameters);
        parameters.configure(accumulation, output);
        context.graph.addPass(RAYTRACE_PASS, parameters.compute);
        context.graph.addPass(PRESENT_PASS, parameters.present);
    }

    destroy(): void {
        this.#resources = null;
    }
}

class CrystalRayTracingPipelineFactory implements Hilo3d.RenderPipelineFactory {
    readonly name = 'Hilo3D crystal compute path tracer';
    readonly requirements: Readonly<Hilo3d.RenderPipelineRequirements> = Object.freeze({
        requiredCapabilities: REQUIRED_CAPABILITIES,
        requiredLimits: Object.freeze({
            maxStorageBuffersPerShaderStage: 1,
            maxStorageBufferBindingSize: ACCUMULATION_BYTE_LENGTH,
            maxBufferSize: ACCUMULATION_BYTE_LENGTH,
            maxComputeInvocationsPerWorkgroup: WORKGROUP_SIZE * WORKGROUP_SIZE,
            maxComputeWorkgroupSizeX: WORKGROUP_SIZE,
            maxComputeWorkgroupSizeY: WORKGROUP_SIZE
        }),
        requiredTextureFormats: Object.freeze([
            Object.freeze({ format: 'rgba8unorm', use: 'color-attachment' })
        ])
    });
    readonly runtime = new CrystalRayTracingPipeline();

    create(): Hilo3d.RenderPipeline {
        return this.runtime;
    }
}

class OrbitController implements Hilo3d.Tickable {
    readonly #camera = new Float32Array([0.06, 0.23, 5.35, 0]);
    readonly #target = new Float32Array([0, 0.9, -0.12, 1.14]);
    readonly #render = new Float32Array([0, 0.012, 5.45, 0]);
    readonly #sampleElement: HTMLElement;
    #yaw = 0.06;
    #pitch = 0.23;
    #distance = 5.35;
    #sampleIndex = 0;
    #dragging = false;
    #pointerId = -1;
    #lastX = 0;
    #lastY = 0;

    constructor(sampleElement: HTMLElement) {
        this.#sampleElement = sampleElement;
    }

    attach(canvas: HTMLCanvasElement): void {
        canvas.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            this.#dragging = true;
            this.#pointerId = event.pointerId;
            this.#lastX = event.clientX;
            this.#lastY = event.clientY;
            canvas.setPointerCapture(event.pointerId);
        });
        canvas.addEventListener('pointermove', event => {
            if (!this.#dragging || event.pointerId !== this.#pointerId) return;
            const deltaX = event.clientX - this.#lastX;
            const deltaY = event.clientY - this.#lastY;
            this.#lastX = event.clientX;
            this.#lastY = event.clientY;
            this.#yaw -= deltaX * 0.0042;
            this.#pitch = Math.max(-0.08, Math.min(0.55, this.#pitch + deltaY * 0.0032));
            this.resetAccumulation();
        });
        const releasePointer = (event: PointerEvent): void => {
            if (event.pointerId !== this.#pointerId) return;
            this.#dragging = false;
            if (canvas.hasPointerCapture(event.pointerId)) {
                canvas.releasePointerCapture(event.pointerId);
            }
            this.#pointerId = -1;
        };
        canvas.addEventListener('pointerup', releasePointer);
        canvas.addEventListener('pointercancel', releasePointer);
        canvas.addEventListener(
            'wheel',
            event => {
                event.preventDefault();
                this.#distance = Math.max(
                    4.25,
                    Math.min(7.4, this.#distance + event.deltaY * 0.0035)
                );
                this.resetAccumulation();
            },
            { passive: false }
        );
        canvas.addEventListener('dblclick', () => {
            this.#yaw = 0.06;
            this.#pitch = 0.23;
            this.#distance = 5.35;
            this.resetAccumulation();
        });
    }

    resetAccumulation(): void {
        this.#sampleIndex = 0;
    }

    tick(_deltaTime: number): void {
        this.#camera[0] = this.#yaw;
        this.#camera[1] = this.#pitch;
        this.#camera[2] = this.#distance;
        this.#camera[3] = this.#sampleIndex;
        this.#render[0] = this.#sampleIndex;
        frameBlock.set('u_camera', this.#camera);
        frameBlock.set('u_target', this.#target);
        frameBlock.set('u_render', this.#render);
        this.#sampleIndex = Math.min(this.#sampleIndex + 1, 4095);
        if (this.#sampleIndex < 12 || this.#sampleIndex % 8 === 0) {
            this.#sampleElement.textContent = `${String(this.#sampleIndex).padStart(3, '0')} spp`;
        }
    }
}

interface RayTracingEvidence {
    readonly backend: Hilo3d.RendererBackend;
    readonly sampleCount: number;
    readonly coloredPixels: number;
    readonly brightPixels: number;
    readonly distinctColors: number;
    readonly hash: number;
}

function analyzeFrame(
    data: Uint8Array,
    backend: Hilo3d.RendererBackend,
    sampleCount: number
): RayTracingEvidence {
    const colors = new Set<number>();
    let coloredPixels = 0;
    let brightPixels = 0;
    let hash = 0x811c9dc5;
    for (let offset = 0; offset < data.length; offset += 4) {
        const red = data[offset] ?? 0;
        const green = data[offset + 1] ?? 0;
        const blue = data[offset + 2] ?? 0;
        if (red + green + blue > 48) coloredPixels += 1;
        if (red + green + blue > 430) brightPixels += 1;
        colors.add((red << 16) | (green << 8) | blue);
        for (let channel = 0; channel < 4; channel += 1) {
            hash ^= data[offset + channel] ?? 0;
            hash = Math.imul(hash, 0x01000193) >>> 0;
        }
    }
    return {
        backend,
        sampleCount,
        coloredPixels,
        brightPixels,
        distinctColors: colors.size,
        hash
    };
}

const container = document.querySelector<HTMLElement>('#container');
const sampleElement = document.querySelector<HTMLElement>('#sample-count');
if (!container || !sampleElement) {
    throw new Error('Ray-tracing example UI is incomplete');
}

const factory = new CrystalRayTracingPipelineFactory();
const camera = new Hilo3d.PerspectiveCamera({
    aspect: TARGET_ASPECT,
    near: 0.1,
    far: 20,
    z: 5.8
});
const stage = await Hilo3d.Stage.create({
    backend: 'webgpu',
    container,
    camera,
    width: TARGET_WIDTH,
    height: TARGET_HEIGHT,
    pixelRatio: 1,
    antialias: false,
    alpha: false,
    renderPipeline: factory
});
const target = stage.renderer.createRenderTarget({
    label: 'Hilo3D path-tracing presentation target',
    width: TARGET_WIDTH,
    height: TARGET_HEIGHT,
    colorAttachments: [{ format: 'rgba8unorm', clearValue: CLEAR_COLOR }],
    depthStencilAttachment: false
});
const accumulation = stage.renderer.createStorageBuffer({
    label: 'Hilo3D path-tracing progressive accumulation',
    byteLength: ACCUMULATION_BYTE_LENGTH,
    usage: ['storage'],
    initialData: new Float32Array(TARGET_WIDTH * TARGET_HEIGHT * PIXEL_RECORD_VEC4S * 4),
    recovery: 'cpu-shadow'
});
factory.runtime.attachResources({ accumulation });
stage.renderer.setRenderTarget(target, { present: true, takeOwnership: true });

const controller = new OrbitController(sampleElement);
controller.attach(stage.canvas);

async function stepAndRead(frames: number): Promise<RayTracingEvidence> {
    if (!Number.isSafeInteger(frames) || frames < 1 || frames > 256) {
        throw new RangeError('Ray-tracing test steps must be an integer in [1, 256]');
    }
    controller.resetAccumulation();
    for (let frame = 0; frame < frames; frame += 1) {
        controller.tick(1000 / 60);
        stage.tick(1000 / 60);
    }
    await stage.renderer.waitForIdle();
    const readback = await target.readColorAttachment();
    return analyzeFrame(readback.data, stage.renderer.backend, frames);
}

const testMode = new URLSearchParams(window.location.search).has('test');
if (testMode) {
    window.__HILO3D_RAYTRACING_TEST_API__ = { step: stepAndRead };
    window.__HILO3D_RAYTRACING_RESULT__ = await stepAndRead(2);
    document.body.dataset['rayTracingReady'] = 'true';
} else {
    controller.tick(1000 / 60);
    stage.tick(1000 / 60);
    const ticker = new Hilo3d.Ticker(60);
    ticker.addTick(controller);
    ticker.addTick(stage);
    ticker.start();
    window.addEventListener(
        'pagehide',
        () => {
            ticker.stop();
        },
        { once: true }
    );
}

window.addEventListener(
    'pagehide',
    () => {
        accumulation.destroy();
        stage.destroy();
    },
    { once: true }
);

declare global {
    interface Window {
        __HILO3D_RAYTRACING_RESULT__?: RayTracingEvidence;
        __HILO3D_RAYTRACING_TEST_API__?: {
            readonly step: (frames: number) => Promise<RayTracingEvidence>;
        };
    }
}
