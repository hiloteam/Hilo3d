import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './js/init';

const { camera, stage } = createExampleContext();

camera.z = 0;
camera.fov = 90;
const hdrLoader = new Hilo3d.HDRLoader();
void hdrLoader
    .load({
        src: new URL('./image/reflectionprobe-00.hdr', import.meta.url).href
    })
    .then(hdrTexture => {
        const material = new Hilo3d.BasicMaterial({
            lightType: 'NONE',
            diffuse: hdrTexture,
            useHDR: true,
            exposure: 2,
            side: Hilo3d.constants.BACK
        });

        const sphereMesh = new Hilo3d.Mesh({
            material,
            geometry: new Hilo3d.SphereGeometry()
        }).addTo(stage);
        sphereMesh.onUpdate = () => {
            sphereMesh.rotationY -= 0.1;
        };

        Hilo3d.Tween.to(
            material,
            {
                exposure: 10
            },
            {
                duration: 2000,
                reverse: true,
                loop: true
            }
        );
    })
    .catch((error: unknown) => {
        console.error('Failed to load HDR environment', error);
    });
