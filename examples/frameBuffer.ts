import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage, renderer } = createExampleContext();

const boxGeometry = new Hilo3d.BoxGeometry();
boxGeometry.setAllRectUV([
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0]
]);
const colorBox = new Hilo3d.Mesh({
    geometry: boxGeometry,
    material: new Hilo3d.BasicMaterial({
        diffuse: new Hilo3d.Color(0.8, 0, 0)
    }),
    x: -1
});
colorBox.onUpdate = () => {
    colorBox.rotationX += 0.5;
    colorBox.rotationY += 0.5;
};
stage.addChild(colorBox);
const texture = new Hilo3d.LazyTexture({
    src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
});
const textureMaterial = new Hilo3d.BasicMaterial({ diffuse: texture.clone() });
const textureBox = new Hilo3d.Mesh({
    geometry: boxGeometry,
    material: textureMaterial,
    x: 1,
    rotationX: 45
});
textureBox.onUpdate = () => {
    textureBox.rotationX += 0.5;
    textureBox.rotationZ += 0.5;
};
stage.addChild(textureBox);

const framebuffer = new Hilo3d.Framebuffer(renderer, {
    width: renderer.width,
    height: renderer.height
});

const clearColor = new Hilo3d.Color(1, 1, 1);

renderer.on('afterRender', () => {
    framebuffer.bind();
    renderer.clear(clearColor);
    textureMaterial.diffuse = texture;
    renderer.renderList.traverse(mesh => {
        renderer.renderMesh(mesh);
    });
    framebuffer.unbind();

    framebuffer.render(0, 0.7, 0.3, 0.3);
    textureMaterial.diffuse = framebuffer.texture;
});
