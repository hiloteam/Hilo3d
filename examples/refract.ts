import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './js/init';

const { stage, renderer } = createExampleContext();

initModel();

function initModel(): void {
    const gltfURL = './models/mineral_water/scene.gltf';
    void new Hilo3d.GLTFLoader()
        .load({
            src: gltfURL
        })
        .then(model => {
            const framebuffer = new Hilo3d.Framebuffer(renderer);
            renderer.on('beforeRender', function () {
                model.materials.forEach(function (material) {
                    material.transparent = true;
                    material.side = Hilo3d.constants.BACK;
                    material.onBeforeCompile = null;
                    material.isDirty = true;
                });
                framebuffer.bind();
                renderer.viewport();
                renderer.clear(new Hilo3d.Color(0, 0, 0, 0));
                renderer.renderScene();
                framebuffer.unbind();

                model.materials.forEach(function (material) {
                    material.transparent = false;
                    material.premultiplyAlpha = false;
                    material.side = Hilo3d.constants.FRONT;
                    material.uniforms['u_refractionMap'] = {
                        get(_mesh, _material, programInfo) {
                            if (programInfo.textureIndex === undefined) {
                                throw new Error('u_refractionMap has no texture unit');
                            }
                            return Hilo3d.semantic.handlerTexture(
                                framebuffer.texture,
                                programInfo.textureIndex
                            );
                        }
                    };
                    material.onBeforeCompile = (vs, fs) => {
                        let fragmentSource = fs.replace(
                            /(void\s+main\s*\()/,
                            `
                            uniform vec2 u_rendererSize;
                            uniform sampler2D u_refractionMap;
                            $1`
                        );
                        fragmentSource = fragmentSource.replace(
                            /(#ifdef HILO_IGNORE_TRANSPARENT)/,
                            `
                        vec2 screenUV = gl_FragCoord.xy/u_rendererSize;
                        vec2 bump = normal.xy;
                        vec4 screenColor = texture2D(u_refractionMap, screenUV - bump*vec2(0.03, 0.01)).rgba;

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
            });

            model.node.setScale(0.002);
            // model.node.y =;
            stage.addChild(model.node);
        })
        .catch((error: unknown) => {
            console.error('Failed to initialize refraction example', error);
        });
}
