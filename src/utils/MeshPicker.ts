import Color from '../math/Color';
import type Mesh from '../core/Mesh';
import Framebuffer from '../renderer/Framebuffer';
import type WebGLRenderer from '../renderer/WebGLRenderer';
import BasicMaterial from '../material/BasicMaterial';
import { padLeft } from './util';

const meshPickerMaterial = new BasicMaterial({ lightType: 'NONE' });
const clearColor = new Color(1, 1, 1);
const tempColor = new Color();

interface MeshPickerIdentity {
    numberId: number;
    color: string;
}

export interface MeshPickerParameters {
    renderer: WebGLRenderer;
    debug?: boolean;
}

/** GPU color-picking helper that does not mutate scene meshes. */
class MeshPicker {
    readonly isMeshPicker = true;
    readonly className = 'MeshPicker';
    debug = false;
    readonly renderer: WebGLRenderer;
    private framebuffer: Framebuffer | null = null;
    private readonly colorMeshMap = new Map<string, Mesh>();
    private meshIdentities = new WeakMap<Mesh, MeshPickerIdentity>();
    private nextIdentity = 1;
    private destroyed = false;
    private readonly afterRender = (): void => {
        this.renderColoredMeshes();
        if (this.debug) this.renderDebug();
    };

    constructor(params: MeshPickerParameters) {
        this.renderer = params.renderer;
        this.debug = params.debug ?? false;
        this.createFramebuffer();
        this.renderer.on('afterRender', this.afterRender);
    }

    private createFramebuffer(): void {
        if (this.framebuffer) return;
        this.framebuffer = new Framebuffer(this.renderer, {
            width: this.renderer.width,
            height: this.renderer.height
        });
    }

    private renderDebug(): void {
        this.framebuffer?.render(0, 0.7, 0.3, 0.3);
    }

    private getMeshIdentity(mesh: Mesh): MeshPickerIdentity {
        const existing = this.meshIdentities.get(mesh);
        if (existing) return existing;

        if (this.nextIdentity >= 0xffffff) {
            throw new RangeError('MeshPicker exhausted the 24-bit picking color space.');
        }
        const numberId = this.nextIdentity++;
        const identity = { numberId, color: padLeft(numberId.toString(16), 6) };
        this.meshIdentities.set(mesh, identity);
        this.colorMeshMap.set(identity.color, mesh);
        return identity;
    }

    private renderColoredMeshes(): void {
        const { framebuffer, renderer } = this;
        if (!framebuffer || this.destroyed) return;
        const diffuse = meshPickerMaterial.diffuse;
        if (!(diffuse instanceof Color)) {
            throw new TypeError('MeshPicker requires a color-based picking material.');
        }

        framebuffer.bind();
        const previousForceMaterial = renderer.forceMaterial;
        try {
            renderer.clear(clearColor);
            renderer.forceMaterial = meshPickerMaterial;
            renderer.renderList.traverse(mesh => {
                const identity = this.getMeshIdentity(mesh);
                diffuse.fromHEX(identity.color);
                meshPickerMaterial.isDirty = true;
                renderer.renderMesh(mesh);
            });
        } finally {
            renderer.forceMaterial = previousForceMaterial;
            framebuffer.unbind();
        }
    }

    getSelection(x: number, y: number, width = 1, height = 1): Mesh[] {
        if (!this.framebuffer) return [];
        const pixelRatio = this.renderer.pixelRatio;
        const meshes = new Set<Mesh>();
        const pixels = this.framebuffer.readPixels(
            x * pixelRatio,
            y * pixelRatio,
            width * pixelRatio,
            height * pixelRatio
        );
        for (let index = 0; index < pixels.length; index += 4) {
            const color = tempColor.fromUintArray(pixels, index).toHEX();
            const mesh = this.colorMeshMap.get(color);
            if (mesh) meshes.add(mesh);
        }
        return [...meshes];
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.renderer.off('afterRender', this.afterRender);
        this.framebuffer?.destroy();
        this.framebuffer = null;
        this.colorMeshMap.clear();
        this.meshIdentities = new WeakMap<Mesh, MeshPickerIdentity>();
    }
}

export default MeshPicker;
