import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';
import { createScreenMesh } from './shared/ScreenMesh';

const { camera, stage, renderer } = await createExampleContext();

const boxGeometry = new Hilo3d.BoxGeometry();
boxGeometry.setAllRectUV([
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0]
]);
const material = new Hilo3d.BasicMaterial({
    lightType: 'NONE'
});

const depthNode = new Hilo3d.Node();
depthNode.onUpdate = () => {
    depthNode.rotationY += 0.5;
    depthNode.rotationX += 0.5;
};
for (let i = 0; i < 20; i++) {
    const mesh = new Hilo3d.Mesh({
        material,
        geometry: boxGeometry,
        x: (Math.random() * 2 - 1) * 5,
        y: (Math.random() * 2 - 1) * 5,
        z: (Math.random() * 2 - 1) * 5,
        rotationX: Math.random() * 360,
        rotationY: Math.random() * 360,
        rotationZ: Math.random() * 360
    });
    mesh.onUpdate = () => {
        mesh.rotationY += 0.5;
        mesh.rotationX += 0.5;
    };
    depthNode.addChild(mesh).setScale(0.1);
}

const depthTarget = renderer.createRenderTarget({
    width: renderer.width,
    height: renderer.height,
    colorAttachments: [
        {
            format: 'rgba8unorm',
            storeOp: 'discard'
        }
    ],
    depthStencilAttachment: {
        format: 'depth24plus',
        sampled: true,
        compare: 'less-equal'
    },
    label: 'DepthTexture.scene'
});
const sampledDepthTexture = depthTarget.getDepthTexture();
if (!sampledDepthTexture) throw new Error('Depth target has no sampleable attachment.');
sampledDepthTexture.minFilter = Hilo3d.constants.NEAREST;
sampledDepthTexture.magFilter = Hilo3d.constants.NEAREST;

stage.addChild(
    createScreenMesh({
        label: 'DepthTexture.preview',
        samplers: {
            u_depth: () => sampledDepthTexture
        },
        fragmentShader: `#version 300 es
            precision highp float;
            in vec2 v_texcoord0;
            uniform highp sampler2D u_depth;
            layout(location = 0) out vec4 fragmentColor;
            void main(void) {
                float depth = texture(u_depth, v_texcoord0).r;
                fragmentColor = vec4(vec3(depth), 1.0);
            }
        `
    })
);

stage.onUpdate = function (deltaTime) {
    if (depthTarget.width !== renderer.width || depthTarget.height !== renderer.height) {
        depthTarget.resize(renderer.width, renderer.height);
    }
    depthNode.traverseUpdate(deltaTime);
    renderer.renderToTarget(depthTarget, depthNode, camera, false);
};
