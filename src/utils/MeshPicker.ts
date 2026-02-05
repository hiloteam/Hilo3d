import Color from '../math/Color';
import Framebuffer from '../renderer/Framebuffer';
import BasicMaterial from '../material/BasicMaterial';
import WebGLRenderer from '../renderer/WebGLRenderer';
import Mesh from '../core/Mesh';
import {
    padLeft
} from './util';

const meshPickerMaterial = new BasicMaterial({
    lightType: 'NONE'
});
const clearColor = new Color(1, 1, 1);
const tempColor = new Color();

interface MeshPickerParams {
    renderer?: WebGLRenderer;
    debug?: boolean;
}

/**
 * Mesh 选择工具，可以获取画布中某个区域内的Mesh
 * @class
 * @example
 * const picker = new Hilo3d.MeshPicker({
 *     renderer: stage.renderer
 * });
 * picker.getSelection(20, 20, 1, 1);
 */
class MeshPicker {
    /**
     * @default true
     * @type {boolean}
     */
    isMeshPicker: boolean = true;

    /**
     * @default MeshPicker
     * @type {string}
     */
    className: string = 'MeshPicker';

    /**
     * 是否开启debug，开启后会将mesh以不同的颜色绘制在左下角
     * @default false
     * @type {boolean}
     */
    debug: boolean = false;

    /**
     * WebGLRenderer 的实例
     * @default null
     * @type {WebGLRenderer}
     */
    renderer!: WebGLRenderer;

    private colorMeshMap: Record<string, Mesh> = {};

    private framebuffer!: Framebuffer;

    /**
     * @constructs
     * @param {object} [params] 创建对象的属性参数，可包含此类的所有属性。
     */
    constructor(params?: MeshPickerParams) {
        if (params) {
            Object.assign(this, params);
        }
        this.colorMeshMap = {};
        this.init();
    }

    private createFramebuffer(): void {
        if (this.framebuffer) {
            return;
        }

        const renderer = this.renderer;

        this.framebuffer = new Framebuffer(renderer, {
            useVao: renderer.useVao,
            width: renderer.width,
            height: renderer.height
        });
    }

    private renderDebug(): void {
        this.framebuffer.render(0, 0.7, 0.3, 0.3);
    }

    private createMeshNumberId(mesh: any): void {
        if (!('numberId' in mesh)) {
            mesh.numberId = Number(mesh.id.replace(/^.*_(\d+)$/, '$1')) * 10;
            mesh.color = padLeft(mesh.numberId.toString(16), 6);
            this.colorMeshMap[mesh.color] = mesh;
        }
    }

    private renderColoredMeshes(): void {
        const {
            renderer,
            framebuffer
        } = this;

        framebuffer.bind();
        renderer.clear(clearColor);
        const currentForceMaterial = renderer.forceMaterial;
        renderer.forceMaterial = meshPickerMaterial;
        renderer.renderList.traverse((mesh: any) => {
            this.createMeshNumberId(mesh);
            meshPickerMaterial.diffuse.fromHEX(mesh.color);
            meshPickerMaterial.isDirty = true;
            renderer.renderMesh(mesh);
        });
        renderer.forceMaterial = currentForceMaterial;
        framebuffer.unbind();
    }

    /**
     * 获取指定区域内的Mesh，注意无法获取被遮挡的Mesh
     * @param {number} x 左上角的x坐标
     * @param {number} y 左上角的y坐标
     * @param {number} [width=1] 区域的宽
     * @param {number} [height=1] 区域的高
     * @return {Mesh[]} 返回获取的Mesh数组
     */
    getSelection(x: number, y: number, width: number = 1, height: number = 1): Mesh[] {
        const pixelRatio = this.renderer.pixelRatio;
        const meshes: Mesh[] = [];
        const pixels = this.framebuffer.readPixels(x * pixelRatio, y * pixelRatio, width * pixelRatio, height * pixelRatio);
        for (let i = 0; i < pixels.length; i += 4) {
            let color = tempColor.fromUintArray(pixels, i).toHEX();
            if (this.colorMeshMap[color]) {
                meshes.push(this.colorMeshMap[color]);
            }
        }
        return meshes;
    }

    private init(): void {
        this.createFramebuffer();
        this.renderer.on('afterRender', () => {
            this.renderColoredMeshes();
            if (this.debug) {
                this.renderDebug();
            }
        });
    }
}

export default MeshPicker;
