import * as Hilo3d from '../../src/Hilo3d';
import type { GeometryAttributeValue } from '../../src/geometry/GeometryData';

function requireVector3(value: GeometryAttributeValue, label: string): Hilo3d.Vector3 {
    if (value instanceof Hilo3d.Vector3) return value;
    throw new TypeError(`${label} must contain three-component vectors`);
}

/** Builds line geometry that visualizes a mesh's normals and tangents. */
const NormalTangentHelper = {
    create(mesh: Hilo3d.Mesh, size = 1): Hilo3d.Node {
        const geometry = mesh.geometry;
        if (!geometry?.vertices) {
            throw new Error('NormalTangentHelper requires mesh geometry with vertices');
        }

        const node = new Hilo3d.Node();
        const directions = [
            { data: geometry.normals, color: new Hilo3d.Color(0, 0, 1) },
            { data: geometry.tangents, color: new Hilo3d.Color(1, 0, 0) }
        ];

        for (const { data, color } of directions) {
            if (!data) continue;
            const infoGeometry = new Hilo3d.Geometry({ mode: Hilo3d.constants.webgl.LINES });
            const point1 = new Hilo3d.Vector3();
            const point2 = new Hilo3d.Vector3();

            for (let index = 0; index < data.count; index += 1) {
                const vertex = requireVector3(geometry.vertices.get(index), 'Geometry vertices');
                const direction = requireVector3(data.get(index), 'Geometry directions');
                point1.copy(vertex);
                point2.copy(vertex).scaleAndAdd(size, direction);
                infoGeometry.addLine(
                    [point1.x, point1.y, point1.z],
                    [point2.x, point2.y, point2.z]
                );
            }

            node.addChild(
                new Hilo3d.Mesh({
                    geometry: infoGeometry,
                    material: new Hilo3d.BasicMaterial({
                        lightType: 'NONE',
                        diffuse: color
                    })
                })
            );
        }

        node.matrix.copy(mesh.matrix);
        return node;
    }
};

export default NormalTangentHelper;
