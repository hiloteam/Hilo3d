import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { camera, stage, renderer, ticker } = createExampleContext();

ticker.targetFPS = 1;
renderer.clearColor = new Hilo3d.Color(0.9, 0.6, 0.3);

const sphereGeometry = new Hilo3d.PlaneGeometry();
const material = new Hilo3d.BasicMaterial({
    lightType: 'NONE',
    diffuse: new Hilo3d.Color(1, 1, 1),
    wireframe: true
});

camera.lookAt(new Hilo3d.Vector3(0, 0, 0));

const sceneNode = new Hilo3d.Node();
const mesh = new Hilo3d.Mesh({
    material,
    geometry: sphereGeometry,
    x: 0,
    y: 0,
    z: 0,
    rotationZ: 30
}).setScale(1.4);
mesh.onUpdate = () => {
    mesh.rotationZ += 6.7;
};
sceneNode.addChild(mesh);

const framebufferWidth = renderer.width / 32;
const framebufferHeight = renderer.height / 32;

const framebuffers = [0, 2, 4].map(samples => {
    const multiSampledFramebuffer = new Hilo3d.Framebuffer(renderer, {
        width: framebufferWidth,
        height: framebufferHeight,
        colorAttachmentInfos: [
            {
                attachmentType: Hilo3d.Framebuffer.ATTACHMENT_TYPE_RENDERBUFFER,
                internalFormat: Hilo3d.constants.RGBA8,
                samples
            }
        ],
        depthStencilAttachmentInfo: {
            attachmentType: Hilo3d.Framebuffer.ATTACHMENT_TYPE_RENDERBUFFER,
            internalFormat: Hilo3d.constants.DEPTH_COMPONENT24,
            attachment: Hilo3d.constants.DEPTH_ATTACHMENT,
            samples
        }
    });

    const copyFramebuffer = new Hilo3d.Framebuffer(renderer, {
        width: framebufferWidth,
        height: framebufferHeight,
        colorAttachmentInfos: [
            {
                attachmentType: Hilo3d.Framebuffer.ATTACHMENT_TYPE_TEXTURE
            }
        ]
    });

    return {
        multiSampledFramebuffer,
        copyFramebuffer
    };
});

const singleFramebuffer = new Hilo3d.Framebuffer(renderer, {
    width: framebufferWidth,
    height: framebufferHeight,
    colorAttachmentInfos: [
        {
            attachmentType: Hilo3d.Framebuffer.ATTACHMENT_TYPE_TEXTURE
        }
    ]
});

stage.onUpdate = function () {
    const preWidth = renderer.width;
    const preHeight = renderer.height;

    sceneNode.traverseUpdate(0);
    renderer.width = framebufferWidth;
    renderer.height = framebufferHeight;
    renderer.viewport(0, 0, framebufferWidth, framebufferHeight);

    framebuffers.forEach(framebuffer => {
        const { multiSampledFramebuffer, copyFramebuffer } = framebuffer;

        multiSampledFramebuffer.bind();
        stage.renderer.render(sceneNode, camera);

        copyFramebuffer.copyFramebuffer(multiSampledFramebuffer);
    });

    singleFramebuffer.bind();
    stage.renderer.render(sceneNode, camera);

    renderer.state.bindSystemFramebuffer();
    renderer.width = preWidth;
    renderer.height = preHeight;
    renderer.viewport();
};

renderer.on('afterRender', () => {
    singleFramebuffer.render(0.025, 0.025, 0.45, 0.45);
    const viewports = [
        [0.525, 0.025, 0.45, 0.45],
        [0.025, 0.525, 0.45, 0.45],
        [0.525, 0.525, 0.45, 0.45]
    ] as const;
    framebuffers.forEach(({ copyFramebuffer }, index) => {
        const viewport = viewports[index];
        if (viewport) copyFramebuffer.render(...viewport);
    });
});
