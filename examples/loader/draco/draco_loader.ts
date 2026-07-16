import * as Hilo3d from '../../../src/Hilo3d';
import { createExampleContext } from '../../js/init';
import './DracoLoader';

interface DracoExampleRequest extends Hilo3d.LoaderRequest {
    images?: readonly string[];
    right?: string;
    left?: string;
    top?: string;
    bottom?: string;
    front?: string;
    back?: string;
    magFilter?: GLenum;
    minFilter?: GLenum;
    wrapS?: GLenum;
    wrapT?: GLenum;
}

interface LoadedModel {
    readonly node: Hilo3d.Node;
    readonly materials: readonly Hilo3d.Material[];
}

function requireCubeTexture(value: unknown, description: string): Hilo3d.CubeTexture {
    if (!(value instanceof Hilo3d.CubeTexture)) {
        throw new TypeError(`${description} did not produce a CubeTexture.`);
    }
    return value;
}

function isTexture(value: unknown): value is Hilo3d.Texture {
    return value instanceof Hilo3d.Texture;
}

function requireTexture(value: unknown, description: string): Hilo3d.Texture {
    if (!isTexture(value)) {
        throw new TypeError(`${description} did not produce a Texture.`);
    }
    return value;
}

function requireModel(value: unknown): LoadedModel {
    if (
        typeof value !== 'object' ||
        value === null ||
        !('node' in value) ||
        !(value.node instanceof Hilo3d.Node) ||
        !('materials' in value) ||
        !Array.isArray(value.materials) ||
        !value.materials.every(material => material instanceof Hilo3d.Material)
    ) {
        throw new TypeError('Draco glTF request did not produce a model.');
    }
    return { node: value.node, materials: value.materials };
}

const { stage } = createExampleContext();
stage.enableDOMEvent('click');
stage.on('click', event => {
    if ('eventTarget' in event && event.eventTarget instanceof Hilo3d.Node) {
        console.info('Selected mesh:', event.eventTarget);
    }
});

const queue = new Hilo3d.LoadQueue<DracoExampleRequest>([
    {
        type: 'CubeTexture',
        images: [
            '../../image/bakedDiffuse_01.jpg',
            '../../image/bakedDiffuse_02.jpg',
            '../../image/bakedDiffuse_03.jpg',
            '../../image/bakedDiffuse_04.jpg',
            '../../image/bakedDiffuse_05.jpg',
            '../../image/bakedDiffuse_06.jpg'
        ]
    },
    {
        type: 'CubeTexture',
        right: '../../image/px.jpg',
        left: '../../image/nx.jpg',
        top: '../../image/py.jpg',
        bottom: '../../image/ny.jpg',
        front: '../../image/pz.jpg',
        back: '../../image/nz.jpg',
        magFilter: Hilo3d.constants.LINEAR,
        minFilter: Hilo3d.constants.LINEAR_MIPMAP_LINEAR
    },
    {
        src: '../../image/brdfLUT.png',
        wrapS: Hilo3d.constants.CLAMP_TO_EDGE,
        wrapT: Hilo3d.constants.CLAMP_TO_EDGE,
        type: 'Texture'
    },
    { src: './res/Duck.gltf' }
]);

queue
    .on('complete', () => {
        const [diffuseValue, specularValue, brdfValue, modelValue] = queue.getAllContent();
        const diffuseEnvMap = requireCubeTexture(diffuseValue, 'Diffuse environment map');
        const specularEnvMap = requireCubeTexture(specularValue, 'Specular environment map');
        const brdfLUT = requireTexture(brdfValue, 'BRDF lookup table');
        const model = requireModel(modelValue);

        for (const material of model.materials) {
            if (!(material instanceof Hilo3d.PBRMaterial)) continue;
            material.brdfLUT = brdfLUT;
            material.diffuseEnvMap = diffuseEnvMap;
            material.specularEnvMap = specularEnvMap;
        }

        model.node.y = -0.5;
        stage.addChild(model.node);
        new Hilo3d.Mesh({
            geometry: new Hilo3d.BoxGeometry(),
            material: new Hilo3d.BasicMaterial({
                lightType: 'NONE',
                side: Hilo3d.constants.BACK,
                diffuse: specularEnvMap
            })
        })
            .setScale(20)
            .addTo(stage);
    })
    .on('error', event => {
        console.error('Failed to load the Draco example.', event.detail);
    })
    .start();
