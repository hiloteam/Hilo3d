import * as Hilo3d from '../src/Hilo3d';
import { FullscreenPass } from './shared/FullscreenPass';
import { createExampleContext } from './shared/init';

const BLOOM_LEVEL_COUNT = 5;

Hilo3d.registerUniformBlockBinding('BloomExtractBlock');
Hilo3d.registerUniformBlockBinding('BloomBlurBlock');
Hilo3d.registerUniformBlockBinding('BloomCompositeBlock');

const { camera, stage, renderer, ticker } = await createExampleContext({ autoStart: false });

function createColorTarget(
    label: string,
    width: number,
    height: number,
    depthStencil: boolean
): Hilo3d.RenderTarget {
    return renderer.createRenderTarget({
        width,
        height,
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
        depthStencilAttachment: depthStencil
            ? {
                  format: 'depth24plus',
                  depthClearValue: 1,
                  depthLoadOp: 'clear',
                  depthStoreOp: 'discard',
                  label: `${label}.depth`
              }
            : false,
        label
    });
}

function resizeTarget(target: Hilo3d.RenderTarget, width: number, height: number): void {
    if (target.width !== width || target.height !== height) target.resize(width, height);
}

const extractFragment = `#version 300 es
precision highp float;
in vec2 v_texcoord0;
uniform sampler2D u_scene;
layout(std140) uniform BloomExtractBlock {
    float u_threshold;
    float u_softKnee;
};
layout(location = 0) out vec4 fragmentColor;

void main(void) {
    vec3 sceneColor = texture(u_scene, v_texcoord0).rgb;
    float brightness = dot(sceneColor, vec3(0.2126, 0.7152, 0.0722));
    float contribution = smoothstep(
        u_threshold - u_softKnee,
        u_threshold + u_softKnee,
        brightness
    );
    fragmentColor = vec4(sceneColor * contribution, 1.0);
}`;

const blurFragment = `#version 300 es
precision highp float;
in vec2 v_texcoord0;
uniform sampler2D u_source;
layout(std140) uniform BloomBlurBlock {
    vec2 u_textureSize;
    vec2 u_direction;
};
layout(location = 0) out vec4 fragmentColor;

void main(void) {
    float weight[5];
    weight[0] = 0.227027;
    weight[1] = 0.1945946;
    weight[2] = 0.1216216;
    weight[3] = 0.054054;
    weight[4] = 0.016216;

    vec2 texelOffset = u_direction / u_textureSize;
    vec3 result = texture(u_source, v_texcoord0).rgb * weight[0];
    for (int sampleIndex = 1; sampleIndex < 5; ++sampleIndex) {
        vec2 offset = texelOffset * float(sampleIndex);
        result += texture(u_source, v_texcoord0 + offset).rgb * weight[sampleIndex];
        result += texture(u_source, v_texcoord0 - offset).rgb * weight[sampleIndex];
    }
    fragmentColor = vec4(result, 1.0);
}`;

const compositeFragment = `#version 300 es
precision highp float;
in vec2 v_texcoord0;
uniform sampler2D u_scene;
uniform sampler2D u_bloom0;
uniform sampler2D u_bloom1;
uniform sampler2D u_bloom2;
uniform sampler2D u_bloom3;
uniform sampler2D u_bloom4;
layout(std140) uniform BloomCompositeBlock {
    float u_strength;
    float u_exposure;
    vec4 u_levelWeights;
    float u_levelWeight4;
};
layout(location = 0) out vec4 fragmentColor;

void main(void) {
    vec3 bloom = texture(u_bloom0, v_texcoord0).rgb * u_levelWeights.x;
    bloom += texture(u_bloom1, v_texcoord0).rgb * u_levelWeights.y;
    bloom += texture(u_bloom2, v_texcoord0).rgb * u_levelWeights.z;
    bloom += texture(u_bloom3, v_texcoord0).rgb * u_levelWeights.w;
    bloom += texture(u_bloom4, v_texcoord0).rgb * u_levelWeight4;
    vec3 hdrColor = texture(u_scene, v_texcoord0).rgb + bloom * u_strength;
    vec3 mappedColor = vec3(1.0) - exp(-hdrColor * u_exposure);
    fragmentColor = vec4(mappedColor, 1.0);
}`;

const fullWidth = Math.max(1, renderer.width);
const fullHeight = Math.max(1, renderer.height);
const sceneTarget = createColorTarget('Bloom.scene', fullWidth, fullHeight, true);
const extractTarget = createColorTarget('Bloom.extract', fullWidth, fullHeight, false);

const extractLayout = Hilo3d.createStd140Layout({
    u_threshold: 'float',
    u_softKnee: 'float'
});
const extractBlock = Hilo3d.UniformBuffer.fromSchema(extractLayout, {
    u_threshold: 0.55,
    u_softKnee: 0.12
});
const extractPass = new FullscreenPass({
    renderer,
    fragmentShader: extractFragment,
    samplers: { u_scene: () => sceneTarget.getColorTexture() },
    uniformBlocks: { BloomExtractBlock: extractBlock },
    label: 'BloomExtract'
});

interface BlurLevel {
    readonly horizontalTarget: Hilo3d.RenderTarget;
    readonly verticalTarget: Hilo3d.RenderTarget;
    readonly horizontalBlock: Hilo3d.UniformBuffer;
    readonly verticalBlock: Hilo3d.UniformBuffer;
    readonly horizontalPass: FullscreenPass;
    readonly verticalPass: FullscreenPass;
}

const blurLayout = Hilo3d.createStd140Layout({
    u_textureSize: 'vec2',
    u_direction: 'vec2'
});
const blurLevels: BlurLevel[] = [];
for (let level = 0; level < BLOOM_LEVEL_COUNT; level++) {
    const divisor = 2 ** level;
    const width = Math.max(1, Math.ceil(fullWidth / divisor));
    const height = Math.max(1, Math.ceil(fullHeight / divisor));
    const horizontalTarget = createColorTarget(
        `Bloom.blur${String(level)}.horizontal`,
        width,
        height,
        false
    );
    const verticalTarget = createColorTarget(
        `Bloom.blur${String(level)}.vertical`,
        width,
        height,
        false
    );
    const horizontalBlock = Hilo3d.UniformBuffer.fromSchema(blurLayout, {
        u_textureSize: [width, height],
        u_direction: [1, 0]
    });
    const verticalBlock = Hilo3d.UniformBuffer.fromSchema(blurLayout, {
        u_textureSize: [width, height],
        u_direction: [0, 1]
    });
    const horizontalPass = new FullscreenPass({
        renderer,
        fragmentShader: blurFragment,
        samplers: { u_source: () => extractTarget.getColorTexture() },
        uniformBlocks: { BloomBlurBlock: horizontalBlock },
        label: 'BloomBlur'
    });
    const verticalPass = new FullscreenPass({
        renderer,
        fragmentShader: blurFragment,
        samplers: { u_source: () => horizontalTarget.getColorTexture() },
        uniformBlocks: { BloomBlurBlock: verticalBlock },
        label: 'BloomBlur'
    });
    blurLevels.push({
        horizontalTarget,
        verticalTarget,
        horizontalBlock,
        verticalBlock,
        horizontalPass,
        verticalPass
    });
}

let bloomStrength = 1;
const compositeLayout = Hilo3d.createStd140Layout({
    u_strength: 'float',
    u_exposure: 'float',
    u_levelWeights: 'vec4',
    u_levelWeight4: 'float'
});
const compositeBlock = Hilo3d.UniformBuffer.fromSchema(compositeLayout, {
    u_strength: bloomStrength,
    u_exposure: 0.8,
    u_levelWeights: [1, 0.8, 0.6, 0.4],
    u_levelWeight4: 0.2
});

function bloomTexture(levelIndex: number): Hilo3d.Texture<unknown> {
    const level = blurLevels[levelIndex];
    if (!level) throw new RangeError(`Bloom level ${String(levelIndex)} is unavailable.`);
    return level.verticalTarget.getColorTexture();
}

const compositePass = new FullscreenPass({
    renderer,
    fragmentShader: compositeFragment,
    samplers: {
        u_scene: () => sceneTarget.getColorTexture(),
        u_bloom0: () => bloomTexture(0),
        u_bloom1: () => bloomTexture(1),
        u_bloom2: () => bloomTexture(2),
        u_bloom3: () => bloomTexture(3),
        u_bloom4: () => bloomTexture(4)
    },
    uniformBlocks: { BloomCompositeBlock: compositeBlock },
    prepare: () => {
        compositeBlock.set('u_strength', bloomStrength);
    },
    label: 'BloomComposite'
});

function resizePipelineTargets(): void {
    const width = Math.max(1, renderer.width);
    const height = Math.max(1, renderer.height);
    resizeTarget(sceneTarget, width, height);
    resizeTarget(extractTarget, width, height);
    blurLevels.forEach((level, index) => {
        const divisor = 2 ** index;
        const levelWidth = Math.max(1, Math.ceil(width / divisor));
        const levelHeight = Math.max(1, Math.ceil(height / divisor));
        resizeTarget(level.horizontalTarget, levelWidth, levelHeight);
        resizeTarget(level.verticalTarget, levelWidth, levelHeight);
        level.horizontalBlock.set('u_textureSize', [levelWidth, levelHeight]);
        level.verticalBlock.set('u_textureSize', [levelWidth, levelHeight]);
    });
}

function random(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

function initScene(): void {
    camera.far = 5;
    stage.rotationX = 25;

    const boxGeometry = new Hilo3d.BoxGeometry();
    boxGeometry.setAllRectUV([
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0]
    ]);
    const sphereGeometry = new Hilo3d.SphereGeometry({ radius: 0.7 });

    for (let index = 0; index < 50; index++) {
        const speed = random(0.5, 1);
        const colorMesh = new Hilo3d.Mesh({
            geometry: random(0, 1) > 0.5 ? boxGeometry : sphereGeometry,
            material: new Hilo3d.BasicMaterial({
                lightType: 'NONE',
                diffuse: new Hilo3d.Color(random(0.5, 1), random(0.5, 1), random(0.5, 1))
            }),
            x: random(-1.5, 1.5),
            y: random(-1.5, 1.5),
            z: random(-1.5, 1.5)
        });
        colorMesh.onUpdate = () => {
            colorMesh.rotationX += speed;
            colorMesh.rotationY += speed;
        };
        colorMesh.setScale(random(0.05, 0.08));
        stage.addChild(colorMesh);
    }

    stage.onUpdate = function () {
        this.rotationX += 0.5;
        this.rotationY += 0.5;
    };
}

initScene();

const bloomAnimation = { value: 0 };
Hilo3d.Tween.to(
    bloomAnimation,
    { value: 0.8 },
    {
        ease: Hilo3d.Tween.Ease.Quad.EaseOut,
        duration: 1000,
        loop: true,
        reverse: true,
        onUpdate: () => {
            bloomStrength = bloomAnimation.value;
        }
    }
);

const bloomPipeline: Hilo3d.Tickable = {
    tick(deltaTime): void {
        stage.traverseUpdate(deltaTime);
        resizePipelineTargets();
        renderer.renderFrame(() => {
            renderer.renderToTarget(sceneTarget, stage, camera, false);
            extractPass.render(extractTarget);
            for (const level of blurLevels) {
                level.horizontalPass.render(level.horizontalTarget);
                level.verticalPass.render(level.verticalTarget);
            }
            compositePass.render();
        });
    }
};

ticker.removeTick(stage);
ticker.addTick(bloomPipeline);
ticker.start();
