import Light from './Light';

/**
 * 环境光
 * @class
 * @extends Light
 */
class AmbientLight extends Light {
    /**
     * @type {Boolean}
     * @readOnly
     * @default true
     */
    readonly isAmbientLight: boolean = true;

    /**
     * @type {String}
     * @readOnly
     * @default AmbientLight
     */
    readonly className: string = 'AmbientLight';

    autoUpdateWorldMatrix: boolean = false;
}

export default AmbientLight;
