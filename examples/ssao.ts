import * as Hilo3d from '../src/Hilo3d';
import { FullscreenPass } from './shared/FullscreenPass';
import { createExampleContext } from './shared/init';

const SSAO_KERNEL_SIZE = 32;
const SSAO_NOISE_SIZE = 4;

Hilo3d.registerUniformBlockBinding('SsaoSamplingBlock');
Hilo3d.registerUniformBlockBinding('SsaoBlurBlock');

const { camera, stage, renderer, ticker } = await createExampleContext({ autoStart: false });

function createGeometryTarget(label: string): Hilo3d.RenderTarget {
    return renderer.createRenderTarget({
        width: Math.max(1, renderer.width),
        height: Math.max(1, renderer.height),
        sampleCount: 1,
        colorAttachments: [
            {
                format: 'rgba16float',
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'clear',
                storeOp: 'store',
                label: `${label}.color`
            }
        ],
        depthStencilAttachment: {
            format: 'depth24plus',
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'discard',
            label: `${label}.depth`
        },
        label
    });
}

function createColorTarget(label: string): Hilo3d.RenderTarget {
    return renderer.createRenderTarget({
        width: Math.max(1, renderer.width),
        height: Math.max(1, renderer.height),
        sampleCount: 1,
        colorAttachments: [
            {
                format: 'rgba16float',
                clearValue: { r: 1, g: 1, b: 1, a: 1 },
                loadOp: 'clear',
                storeOp: 'store',
                label: `${label}.color`
            }
        ],
        depthStencilAttachment: false,
        label
    });
}

function resizeTarget(target: Hilo3d.RenderTarget, width: number, height: number): void {
    if (target.width !== width || target.height !== height) target.resize(width, height);
}

function createSsaoKernel(): Float32Array {
    const kernel = new Float32Array(SSAO_KERNEL_SIZE * 3);
    for (let sampleIndex = 0; sampleIndex < SSAO_KERNEL_SIZE; sampleIndex++) {
        let x = Math.random() * 2 - 1;
        let y = Math.random() * 2 - 1;
        let z = Math.random();
        const length = Math.max(Math.hypot(x, y, z), Number.EPSILON);
        x /= length;
        y /= length;
        z /= length;
        const randomScale = Math.random();
        const distribution = sampleIndex / SSAO_KERNEL_SIZE;
        const hemisphereScale = 0.1 + 0.9 * distribution * distribution;
        const offset = sampleIndex * 3;
        kernel[offset] = x * randomScale * hemisphereScale;
        kernel[offset + 1] = y * randomScale * hemisphereScale;
        kernel[offset + 2] = z * randomScale * hemisphereScale;
    }
    return kernel;
}

function createNoiseTexture(): Hilo3d.DataTexture {
    const noise = new Float32Array(SSAO_NOISE_SIZE * SSAO_NOISE_SIZE * 4);
    for (let pixel = 0; pixel < SSAO_NOISE_SIZE * SSAO_NOISE_SIZE; pixel++) {
        const offset = pixel * 4;
        noise[offset] = Math.random() * 2 - 1;
        noise[offset + 1] = Math.random() * 2 - 1;
        noise[offset + 2] = 0;
        noise[offset + 3] = 1;
    }
    return new Hilo3d.DataTexture({
        data: noise,
        wrapS: Hilo3d.constants.REPEAT,
        wrapT: Hilo3d.constants.REPEAT,
        minFilter: Hilo3d.constants.NEAREST,
        magFilter: Hilo3d.constants.NEAREST,
        flipY: false
    });
}

const samplingFragment = `#version 300 es
precision highp float;
in vec2 v_texcoord0;
uniform sampler2D u_position;
uniform sampler2D u_normal;
uniform sampler2D u_depth;
uniform sampler2D u_noise;
layout(std140) uniform SsaoSamplingBlock {
    vec3 u_kernel[32];
    mat4 u_projection;
    vec2 u_noiseScale;
    float u_radius;
    float u_bias;
    float u_power;
    float u_cameraNear;
    float u_cameraFar;
};
layout(location = 0) out vec4 fragmentColor;

float viewSpaceDepth(float depth) {
    float clipDepth = depth * 2.0 - 1.0;
    return (-2.0 * u_cameraNear * u_cameraFar) /
        (u_cameraFar + u_cameraNear - clipDepth * (u_cameraFar - u_cameraNear));
}

void main(void) {
    vec4 positionSample = textureLod(u_position, v_texcoord0, 0.0);
    if (positionSample.a < 0.5) {
        fragmentColor = vec4(1.0);
        return;
    }

    vec3 fragmentPosition = positionSample.xyz;
    vec3 normal = normalize(textureLod(u_normal, v_texcoord0, 0.0).xyz);
    vec3 randomVector = normalize(textureLod(u_noise, v_texcoord0 * u_noiseScale, 0.0).xyz);
    vec3 tangent = normalize(randomVector - normal * dot(randomVector, normal));
    vec3 bitangent = cross(normal, tangent);
    mat3 tangentBasis = mat3(tangent, bitangent, normal);

    float occlusion = 0.0;
    for (int sampleIndex = 0; sampleIndex < 32; ++sampleIndex) {
        vec3 samplePosition = fragmentPosition +
            tangentBasis * u_kernel[sampleIndex] * u_radius;
        vec4 projected = u_projection * vec4(samplePosition, 1.0);
        projected.xyz /= projected.w;
        vec2 sampleUv = projected.xy * 0.5 + 0.5;
        #ifdef HILO_WEBGPU
            sampleUv.y = 1.0 - sampleUv.y;
        #endif
        vec4 depthSample = textureLod(u_depth, sampleUv, 0.0);
        if (depthSample.a > 0.5) {
            float sampledViewDepth = viewSpaceDepth(depthSample.r);
            float depthDelta = abs(fragmentPosition.z - sampledViewDepth);
            float rangeWeight = smoothstep(
                0.0,
                1.0,
                u_radius / max(depthDelta, 0.0001)
            );
            float blocked = sampledViewDepth >= samplePosition.z + u_bias ? 1.0 : 0.0;
            occlusion += blocked * rangeWeight;
        }
    }

    float visibility = 1.0 - occlusion / 32.0;
    visibility = pow(max(visibility, 0.0), u_power);
    fragmentColor = vec4(vec3(visibility), 1.0);
}`;

const blurFragment = `#version 300 es
precision highp float;
in vec2 v_texcoord0;
uniform sampler2D u_ssao;
uniform sampler2D u_depth;
uniform sampler2D u_normal;
layout(std140) uniform SsaoBlurBlock {
    vec2 u_textureSize;
    float u_depthSharpness;
    float u_normalSharpness;
};
layout(location = 0) out vec4 fragmentColor;

void main(void) {
    vec4 centerDepth = textureLod(u_depth, v_texcoord0, 0.0);
    if (centerDepth.a < 0.5) {
        fragmentColor = vec4(1.0);
        return;
    }

    vec2 texelSize = 1.0 / u_textureSize;
    vec3 centerNormal = normalize(textureLod(u_normal, v_texcoord0, 0.0).xyz);
    float weightedVisibility = 0.0;
    float totalWeight = 0.0;
    for (int x = -2; x <= 2; ++x) {
        for (int y = -2; y <= 2; ++y) {
            vec2 sampleOffset = vec2(float(x), float(y));
            vec2 sampleUv = v_texcoord0 + sampleOffset * texelSize;
            vec4 sampleDepth = textureLod(u_depth, sampleUv, 0.0);
            vec3 sampleNormal = normalize(textureLod(u_normal, sampleUv, 0.0).xyz);
            float spatialWeight = exp(-dot(sampleOffset, sampleOffset) * 0.125);
            float depthWeight = exp(
                -abs(sampleDepth.r - centerDepth.r) * u_depthSharpness
            );
            float normalWeight = pow(
                max(dot(centerNormal, sampleNormal), 0.0),
                u_normalSharpness
            );
            float weight = spatialWeight * depthWeight * normalWeight * sampleDepth.a;
            weightedVisibility += textureLod(u_ssao, sampleUv, 0.0).r * weight;
            totalWeight += weight;
        }
    }
    float visibility = weightedVisibility / max(totalWeight, 0.0001);
    fragmentColor = vec4(vec3(visibility), 1.0);
}`;

const positionTarget = createGeometryTarget('SSAO.position');
const normalTarget = createGeometryTarget('SSAO.normal');
const depthTarget = createGeometryTarget('SSAO.depth');
const ssaoTarget = createColorTarget('SSAO.visibility');
const outputTarget = createColorTarget('SSAO.output');

const positionMaterial = new Hilo3d.GeometryMaterial({
    vertexType: Hilo3d.constants.POSITION,
    writeOriginData: true
});
const normalMaterial = new Hilo3d.GeometryMaterial({
    vertexType: Hilo3d.constants.NORMAL,
    writeOriginData: true
});
const depthMaterial = new Hilo3d.GeometryMaterial({
    vertexType: Hilo3d.constants.DEPTH,
    writeOriginData: true
});

const noiseTexture = createNoiseTexture();
const samplingLayout = Hilo3d.createStd140Layout({
    u_kernel: { type: 'vec3', arrayLength: SSAO_KERNEL_SIZE },
    u_projection: 'mat4',
    u_noiseScale: 'vec2',
    u_radius: 'float',
    u_bias: 'float',
    u_power: 'float',
    u_cameraNear: 'float',
    u_cameraFar: 'float'
});
const samplingBlock = Hilo3d.UniformBuffer.fromSchema(samplingLayout, {
    u_kernel: createSsaoKernel(),
    u_projection: camera.projectionMatrix.elements,
    u_noiseScale: [renderer.width / SSAO_NOISE_SIZE, renderer.height / SSAO_NOISE_SIZE],
    u_radius: 0.15,
    u_bias: 0.01,
    u_power: 1.35,
    u_cameraNear: camera.near,
    u_cameraFar: camera.far ?? 100
});
const samplingPass = new FullscreenPass({
    renderer,
    fragmentShader: samplingFragment,
    samplers: {
        u_position: () => positionTarget.getColorTexture(),
        u_normal: () => normalTarget.getColorTexture(),
        u_depth: () => depthTarget.getColorTexture(),
        u_noise: () => noiseTexture
    },
    uniformBlocks: { SsaoSamplingBlock: samplingBlock },
    prepare: () => {
        const cameraFar = camera.far;
        if (cameraFar === null) throw new Error('SSAO requires a finite camera far plane.');
        samplingBlock.set('u_projection', camera.projectionMatrix.elements);
        samplingBlock.set('u_noiseScale', [
            renderer.width / SSAO_NOISE_SIZE,
            renderer.height / SSAO_NOISE_SIZE
        ]);
        samplingBlock.set('u_cameraNear', camera.near);
        samplingBlock.set('u_cameraFar', cameraFar);
    },
    label: 'SsaoSampling'
});

const blurLayout = Hilo3d.createStd140Layout({
    u_textureSize: 'vec2',
    u_depthSharpness: 'float',
    u_normalSharpness: 'float'
});
const blurBlock = Hilo3d.UniformBuffer.fromSchema(blurLayout, {
    u_textureSize: [renderer.width, renderer.height],
    u_depthSharpness: 180,
    u_normalSharpness: 8
});
const blurPass = new FullscreenPass({
    renderer,
    fragmentShader: blurFragment,
    samplers: {
        u_ssao: () => ssaoTarget.getColorTexture(),
        u_depth: () => depthTarget.getColorTexture(),
        u_normal: () => normalTarget.getColorTexture()
    },
    uniformBlocks: { SsaoBlurBlock: blurBlock },
    prepare: () => {
        blurBlock.set('u_textureSize', [renderer.width, renderer.height]);
    },
    label: 'SsaoBilateralBlur'
});

function resizePipelineTargets(): void {
    const width = Math.max(1, renderer.width);
    const height = Math.max(1, renderer.height);
    resizeTarget(positionTarget, width, height);
    resizeTarget(normalTarget, width, height);
    resizeTarget(depthTarget, width, height);
    resizeTarget(ssaoTarget, width, height);
    resizeTarget(outputTarget, width, height);
}

function initScene(): void {
    const loader = new Hilo3d.GLTFLoader();
    loader
        .load({ src: './models/dragon/dragon.gltf' })
        .then(async model => {
            await model.ready;
            model.node.setScale(0.1);
            stage.addChild(model.node);
        })
        .catch((error: unknown) => {
            queueMicrotask(() => {
                throw error;
            });
        });
}

initScene();

const ssaoPipeline: Hilo3d.Tickable = {
    tick(deltaTime): void {
        stage.traverseUpdate(deltaTime);
        resizePipelineTargets();

        renderer.renderFrame(() => {
            const previousMaterial = renderer.forceMaterial;
            try {
                renderer.forceMaterial = positionMaterial;
                renderer.renderToTarget(positionTarget, stage, camera, false);
                renderer.forceMaterial = normalMaterial;
                renderer.renderToTarget(normalTarget, stage, camera, false);
                renderer.forceMaterial = depthMaterial;
                renderer.renderToTarget(depthTarget, stage, camera, false);
            } finally {
                renderer.forceMaterial = previousMaterial;
            }

            samplingPass.render(ssaoTarget);
            blurPass.render(outputTarget);
            renderer.present(outputTarget);
        });
    }
};

ticker.removeTick(stage);
ticker.addTick(ssaoPipeline);
ticker.start();
