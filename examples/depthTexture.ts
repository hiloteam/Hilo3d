import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './js/init';

const { camera, stage, renderer } = createExampleContext();

Hilo3d.extensions.use('WEBGL_depth_texture');
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

const framebuffer = new Hilo3d.Framebuffer(renderer, {
    colorAttachmentInfos: [],
    depthStencilAttachmentInfo: {
        attachmentType: Hilo3d.Framebuffer.ATTACHMENT_TYPE_TEXTURE,
        attachment: Hilo3d.constants.DEPTH_ATTACHMENT,
        format: Hilo3d.constants.DEPTH_COMPONENT,
        internalFormat: Hilo3d.constants.DEPTH_COMPONENT16,
        type: Hilo3d.constants.UNSIGNED_SHORT
    }
});
stage.onUpdate = function () {
    framebuffer.bind();
    depthNode.traverseUpdate(0);
    stage.renderer.render(depthNode, camera);
    framebuffer.unbind();
};

renderer.on('afterRender', () => {
    const depthTexture = framebuffer.depthStencilAttachmentInfo?.texture;
    if (depthTexture) framebuffer.render(0, 0, 1, 1, null, depthTexture);
});
