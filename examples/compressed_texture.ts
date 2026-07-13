import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage, renderer, orbitControls } = createExampleContext();

orbitControls.disable();

renderer.onInit(() => {
    const planeGeometry = new Hilo3d.PlaneGeometry();

    const formats = [
        { extension: Hilo3d.KTXLoader.astc, sources: ['astc'] },
        { extension: Hilo3d.KTXLoader.etc, sources: ['etc_etc2'] },
        { extension: Hilo3d.KTXLoader.etc1, sources: ['etc_etc1'] },
        { extension: Hilo3d.KTXLoader.pvrtc, sources: ['pvrtc'] },
        { extension: Hilo3d.KTXLoader.s3tc, sources: ['s3tc_dxt1', 's3tc_dxt3', 's3tc_dxt5'] }
    ];

    let i = 0;
    for (const { extension, sources } of formats) {
        if (Hilo3d.extensions.get(extension)) {
            sources.forEach(src => {
                const loader = new Hilo3d.KTXLoader();
                void loader
                    .load({
                        src: `./image/compressed/logo_${src}.ktx`
                    })
                    .then(texture => {
                        texture.minFilter = Hilo3d.constants.LINEAR;
                        const textureBox = new Hilo3d.Mesh({
                            geometry: planeGeometry,
                            material: new Hilo3d.BasicMaterial({
                                lightType: 'NONE',
                                diffuse: texture,
                                side: Hilo3d.constants.FRONT_AND_BACK
                            }),
                            rotationX: 180,
                            x: 0.8 * ((i % 2) - 0.5),
                            y: 0.8 * (0.5 - Math.floor(i / 2)),
                            scaleX: 0.66,
                            scaleY: 0.66
                        });
                        i += 1;
                        console.log(src, texture);
                        stage.addChild(textureBox);
                    })
                    .catch((error: unknown) => {
                        console.error(`Failed to load ${src} KTX texture`, error);
                    });
            });
        }
    }
});
