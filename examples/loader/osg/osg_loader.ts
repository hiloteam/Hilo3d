import { createExampleContext } from '../../shared/init';
import OSGLoader from './OSGLoader';

const { stage } = createExampleContext();

const loader = new OSGLoader();
void loader
    .load({
        src: './housefly/file.osgjs',
        materials: {
            RootNode: {
                name: 'RootNode',
                isPBR: true,
                reflection: 0.1,
                transparency: {
                    internalFormat: 'ALPHA',
                    magFilter: 'LINEAR',
                    minFilter: 'LINEAR_MIPMAP_LINEAR',
                    wrapS: 'REPEAT',
                    wrapT: 'REPEAT',
                    texture: {
                        uid: '626b10ff182b4a40be1f940891470a89',
                        name: 'fly_transparency_01.png',
                        image: './housefly/transparency.jpg'
                    },
                    factor: 1
                },
                baseColor: {
                    color: [1, 1, 1, 1],
                    factor: 1
                },
                emission: {
                    color: [1, 1, 1, 1],
                    factor: 0
                },
                ao: {
                    color: [1, 1, 1, 1],
                    factor: 0.23
                },
                diffuse: {
                    internalFormat: 'RGB',
                    magFilter: 'LINEAR',
                    minFilter: 'LINEAR_MIPMAP_LINEAR',
                    wrapS: 'REPEAT',
                    wrapT: 'REPEAT',
                    texture: {
                        uid: '862e78d6010f40afa03464fd65d8baa3',
                        name: 'fly_diffuse_01.png',
                        image: './housefly/diffuse.jpg'
                    },
                    factor: 0.74
                },
                normalMap: {
                    internalFormat: 'LUMINANCE',
                    magFilter: 'LINEAR',
                    minFilter: 'LINEAR_MIPMAP_LINEAR',
                    wrapS: 'REPEAT',
                    wrapT: 'REPEAT',
                    texture: {
                        uid: 'e35862ff713b43aba096eb82b402dc0e',
                        name: 'fly_bump_01.png',
                        image: './housefly/normal.jpg'
                    },
                    factor: 3.3000000000000003
                },
                metallic: {
                    color: [1, 1, 1, 1],
                    factor: 0
                },
                specular: {
                    internalFormat: 'RGB',
                    magFilter: 'LINEAR',
                    minFilter: 'LINEAR_MIPMAP_LINEAR',
                    wrapS: 'REPEAT',
                    wrapT: 'REPEAT',
                    texture: {
                        uid: '4ce389fa840b407a9b3f430385f53396',
                        name: 'fly_specular_01.png',
                        image: './housefly/specular.jpg'
                    },
                    factor: 0.24
                }
            }
        }
    })
    .then(model => {
        model.node.rotationX = 0;
        model.node.rotationY = -45;
        model.node.rotationZ = -90;
        model.node.setScale(0.01);
        stage.addChild(model.node);
    })
    .catch((error: unknown) => {
        const message = document.createElement('p');
        message.className = 'example-error';
        message.textContent = error instanceof Error ? error.message : String(error);
        document.body.append(message);
        console.error('Unable to load the local OSG sample.', error);
    });
