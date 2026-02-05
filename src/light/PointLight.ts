import Light from './Light';
import CubeLightShadow from './CubeLightShadow';

/**
 * 点光源
 * @class
 * @extends Light
 */
class PointLight extends Light {
    /**
     * @default true
     * @type {boolean}
     */
    readonly isPointLight: boolean = true;

    /**
     * @default PointLight
     * @type {string}
     */
    readonly className: string = 'PointLight';

    lightShadow: CubeLightShadow | null = null;

    createShadowMap(renderer: any, camera: any): void {
        if (!this.shadow) {
            return;
        }
        if (!this.lightShadow) {
            this.lightShadow = new CubeLightShadow({
                light: this,
                renderer
            });
            if ('minBias' in this.shadow) {
                this.lightShadow.minBias = this.shadow.minBias;
            }
            if ('maxBias' in this.shadow) {
                this.lightShadow.maxBias = this.shadow.maxBias;
            }
        }
        this.lightShadow.createShadowMap(camera);
    }
}

export default PointLight;
