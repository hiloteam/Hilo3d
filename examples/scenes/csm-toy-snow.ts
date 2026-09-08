import * as Hilo3d from '../../src/Hilo3d';
import { environmentMaterialDefaults } from '../shared/environment';
import type { EnvironmentMaps } from '../shared/init';

interface SnowVertex {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly nx: number;
    readonly ny: number;
    readonly nz: number;
}

interface SnowGeometryData {
    readonly positions: number[];
    readonly normals: number[];
    readonly uvs: number[];
    readonly colors: number[];
    readonly indices: number[];
}

const MINIMUM_UP = 0.43;

/** Clip across interpolated normals so round crowns have smooth snow-cap edges. */
function clipSnowTriangle(vertices: readonly SnowVertex[]): SnowVertex[] {
    const output: SnowVertex[] = [];
    for (const [index, current] of vertices.entries()) {
        const previous = vertices[(index + vertices.length - 1) % vertices.length];
        if (!previous) continue;
        const currentInside = current.ny >= MINIMUM_UP;
        const previousInside = previous.ny >= MINIMUM_UP;
        if (currentInside !== previousInside) {
            const fraction = (MINIMUM_UP - previous.ny) / (current.ny - previous.ny);
            output.push({
                x: previous.x + (current.x - previous.x) * fraction,
                y: previous.y + (current.y - previous.y) * fraction,
                z: previous.z + (current.z - previous.z) * fraction,
                nx: previous.nx + (current.nx - previous.nx) * fraction,
                ny: MINIMUM_UP,
                nz: previous.nz + (current.nz - previous.nz) * fraction
            });
        }
        if (currentInside) output.push(current);
    }
    return output;
}

function snowSourceAllowed(node: Hilo3d.Node): boolean {
    // These objects move, emit light, or are the weather layer itself. Keeping them out of the
    // static batch avoids detached snow following neither the train nor the windmill blades.
    return !/ToyTrain|ToyWindmillRotor|Toy rotor|ToyHouseWindows|ToyLighthouseLantern|Lens|Beam|Snow|Weather/i.test(
        node.name
    );
}

function addSnowSource(
    mesh: Hilo3d.Mesh,
    data: SnowGeometryData,
    toParent: Hilo3d.Matrix4,
    normalToParent: Hilo3d.Matrix3
): void {
    const geometry = mesh.geometry;
    if (
        geometry?.mode !== Hilo3d.TRIANGLES ||
        geometry.positionDecodeMat ||
        geometry.normalDecodeMat
    )
        return;
    const positions = geometry.vertices;
    const normals = geometry.normals;
    if (!positions || !normals || positions.size !== 3 || normals.size !== 3) return;
    const toWorld = mesh.getConcatenatedMatrix();
    const normalToWorld = new Hilo3d.Matrix3().normalFromMat4(toWorld);
    const transformed: SnowVertex[] = [];
    const point = new Hilo3d.Vector3();
    const normal = new Hilo3d.Vector3();
    for (let index = 0; index < positions.count; index += 1) {
        const positionValue = positions.get(index);
        const normalValue = normals.get(index);
        if (!(positionValue instanceof Hilo3d.Vector3) || !(normalValue instanceof Hilo3d.Vector3))
            return;
        point.copy(positionValue).transformMat4(toWorld);
        normal.copy(normalValue).transformMat3(normalToWorld).normalize();
        transformed.push({
            x: point.x,
            y: point.y,
            z: point.z,
            nx: normal.x,
            ny: normal.y,
            nz: normal.z
        });
    }
    const indices = geometry.indices;
    const count = indices?.count ?? positions.count;
    const readVertex = (offset: number): SnowVertex | undefined => {
        const index = indices ? indices.get(offset) : offset;
        return typeof index === 'number' ? transformed[index] : undefined;
    };
    for (let offset = 0; offset + 2 < count; offset += 3) {
        const a = readVertex(offset);
        const b = readVertex(offset + 1);
        const c = readVertex(offset + 2);
        if (!a || !b || !c) continue;
        // Do not coat the pedestal, its underside, or the ocean beneath the toy landscape.
        if (Math.max(a.y, b.y, c.y) < 0.7) continue;
        if (Math.max(a.ny, b.ny, c.ny) < MINIMUM_UP) continue;
        const polygon = clipSnowTriangle([a, b, c]);
        if (polygon.length < 3) continue;
        const first = data.positions.length / 3;
        for (const vertex of polygon) {
            const edge = Math.max(0, Math.min(1, (vertex.ny - MINIMUM_UP) / 0.13));
            const edgeOpacity = edge * edge * (3 - 2 * edge);
            // The river is a ribbon above the green tray. A fine ground dusting remains below
            // its depth surface, while roofs and crowns get a visibly rounded, thicker cap.
            const lift = vertex.y < 0.89 ? 0.009 : 0.026 + edgeOpacity * 0.052;
            point
                .set(
                    vertex.x + vertex.nx * lift,
                    vertex.y + vertex.ny * lift,
                    vertex.z + vertex.nz * lift
                )
                .transformMat4(toParent);
            normal.set(vertex.nx, vertex.ny, vertex.nz).transformMat3(normalToParent).normalize();
            data.positions.push(point.x, point.y, point.z);
            data.normals.push(normal.x, normal.y, normal.z);
            data.uvs.push(point.x * 0.04, point.z * 0.04);
            data.colors.push(1, 1, 1, edgeOpacity);
        }
        for (let index = 1; index + 1 < polygon.length; index += 1) {
            data.indices.push(first, first + index, first + index + 1);
        }
    }
}

/** Real surface accumulation, independent of the falling-flake particle layer. */
export interface CsmToySnow {
    readonly accumulation: number;
    setSnowing(enabled: boolean): void;
    setMotion(enabled: boolean): void;
    /** Set a stable amount directly for previews and deterministic browser coverage. */
    setAccumulation(value: number): void;
    tick(dt: number): void;
}

/**
 * Call after the static toy landscape and GLB landmarks have been added. Snow follows their
 * actual upward-facing triangles and shares one PBR draw with real directional/local shadows.
 */
export function createCsmToySnow(
    parent: Hilo3d.Node,
    maps: EnvironmentMaps,
    roots: readonly Hilo3d.Node[] = parent.children.slice()
): CsmToySnow {
    const data: SnowGeometryData = {
        positions: [],
        normals: [],
        uvs: [],
        colors: [],
        indices: []
    };
    const toParent = new Hilo3d.Matrix4().invert(parent.getConcatenatedMatrix());
    const normalToParent = new Hilo3d.Matrix3().normalFromMat4(toParent);
    const visited = new Set<Hilo3d.Node>();
    const collect = (node: Hilo3d.Node): void => {
        if (visited.has(node) || !snowSourceAllowed(node)) return;
        visited.add(node);
        if (
            node instanceof Hilo3d.Mesh &&
            node.material instanceof Hilo3d.PBRMaterial &&
            node.material.compositing.mode === 'opaque'
        )
            addSnowSource(node, data, toParent, normalToParent);
        for (const child of node.children) collect(child);
    };
    for (const root of roots) collect(root);
    const geometry = new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(data.positions), 3),
        normals: new Hilo3d.GeometryData(new Float32Array(data.normals), 3),
        uvs: new Hilo3d.GeometryData(new Float32Array(data.uvs), 2),
        colors: new Hilo3d.GeometryData(new Float32Array(data.colors), 4),
        indices: new Hilo3d.GeometryData(
            data.positions.length / 3 > 65535
                ? new Uint32Array(data.indices)
                : new Uint16Array(data.indices),
            1
        )
    });
    const material = new Hilo3d.PBRMaterial({
        name: 'Toy snow / soft accumulated powder',
        ...environmentMaterialDefaults(maps),
        baseColor: new Hilo3d.Color(0.91, 0.965, 1, 0),
        metallic: 0,
        roughness: 0.97,
        clearcoatFactor: 0,
        diffuseEnvIntensity: 0.62,
        specularEnvIntensity: 0.07,
        compositing: { mode: 'alpha-blend', premultiplied: false },
        state: { depthWrite: false }
    });
    const cover = new Hilo3d.Mesh({
        name: 'ToySnowAccumulation',
        geometry,
        material,
        castShadows: false,
        receiveShadows: true,
        pointerEnabled: false,
        visible: false
    }).addTo(parent);
    let accumulation = 0;
    let snowing = false;
    let motion = true;
    const setAccumulation = (value: number): void => {
        accumulation = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
        material.baseColor.a = accumulation * accumulation * (3 - 2 * accumulation);
        cover.visible = accumulation > 0.015 && data.indices.length > 0;
    };
    return {
        get accumulation(): number {
            return accumulation;
        },
        setSnowing(enabled: boolean): void {
            snowing = enabled;
        },
        setMotion(enabled: boolean): void {
            motion = enabled;
        },
        setAccumulation,
        tick(dt: number): void {
            if (!motion || !Number.isFinite(dt) || dt <= 0) return;
            // Consume elapsed wall time, so accumulation does not slow down on modest GPUs.
            setAccumulation(accumulation + dt / (snowing ? 25000 : -20000));
        }
    };
}
