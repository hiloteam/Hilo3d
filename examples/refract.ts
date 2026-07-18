import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage, renderer } = await createExampleContext();

const refractionTarget = renderer.createRenderTarget({
    width: renderer.width,
    height: renderer.height,
    colorAttachments: [
        {
            clearValue: { r: 0, g: 0, b: 0, a: 0 }
        }
    ],
    label: 'Refraction.backfaces'
});
const backfaceMaterial = new Hilo3d.BasicMaterial({
    lightType: 'NONE',
    side: Hilo3d.constants.BACK,
    diffuse: new Hilo3d.Color(0.75, 0.85, 1)
});

stage.onUpdate = () => {
    if (refractionTarget.width !== renderer.width || refractionTarget.height !== renderer.height) {
        refractionTarget.resize(renderer.width, renderer.height);
    }
    const previousMaterial = renderer.forceMaterial;
    renderer.forceMaterial = backfaceMaterial;
    try {
        const camera = stage.camera;
        if (!camera) throw new Error('Refraction example requires a camera.');
        renderer.renderToTarget(refractionTarget, stage, camera, false);
    } finally {
        renderer.forceMaterial = previousMaterial;
    }
};

initModel();

function initModel(): void {
    const gltfURL = './models/mineral_water/scene.gltf';
    void new Hilo3d.GLTFLoader()
        .load({
            src: gltfURL
        })
        .then(model => {
            model.materials.forEach(material => {
                material.transparent = false;
                material.premultiplyAlpha = false;
                material.side = Hilo3d.constants.FRONT;
                material.uniforms['u_refractionMap'] = {
                    get: () => refractionTarget.getColorTexture()
                };
                material.onBeforeCompile = (vs, fs) => {
                    let fragmentSource = fs.replace(
                        /(void\s+main\s*\()/,
                        `
                            uniform sampler2D u_refractionMap;
                            $1`
                    );
                    fragmentSource = fragmentSource.replace(
                        /(#ifdef HILO_IGNORE_TRANSPARENT)/,
                        `
                        vec2 screenUV = gl_FragCoord.xy/u_rendererSize;
                        vec2 bump = normal.xy;
                        vec4 screenColor = texture(u_refractionMap, screenUV - bump*vec2(0.03, 0.01)).rgba;

                        if (color.a <= 0.9 && screenColor.a > 0.5) {
                            color.rgb *= color.a;
                            color.rgb += (1. - color.a) * screenColor.rgb;
                        }
                        $1
                        `
                    );
                    return {
                        vs,
                        fs: fragmentSource
                    };
                };
                material.isDirty = true;
            });

            model.node.setScale(0.002);
            stage.addChild(model.node);
        })
        .catch((error: unknown) => {
            console.error('Failed to initialize refraction example', error);
        });
}
