import * as Hilo3d from '../../src/Hilo3d';

interface GeometryDirections {
    vertices: hilo3d.GeometryData;
    _normals?: hilo3d.GeometryData;
    _tangents?: hilo3d.GeometryData;
}

const NormalTangentHelper = {
    create(mesh: hilo3d.Mesh, size = 1): hilo3d.Node {
        if (!mesh.geometry) throw new Error('NormalTangentHelper requires mesh.geometry.');

        const node = new Hilo3d.Node();
        const geometry = mesh.geometry as unknown as GeometryDirections;
        const colors = [
            [0, 0, 1] as const,
            [1, 0, 0] as const
        ];

        [geometry._normals, geometry._tangents].forEach((directions, index) => {
            if (!directions) return;

            const color = colors[index];
            if (!color) return;
            const point1 = new Hilo3d.Vector3();
            const point2 = new Hilo3d.Vector3();
            const infoGeometry = new Hilo3d.Geometry({ mode: Hilo3d.constants.webgl.LINES });

            for (let itemIndex = 0; itemIndex < directions.count; itemIndex += 1) {
                const vertex = geometry.vertices.get(itemIndex) as hilo3d.Vector3;
                const direction = directions.get(itemIndex) as hilo3d.Vector3;
                infoGeometry.addLine(
                    Array.from(point1.copy(vertex).elements),
                    Array.from(point2.copy(vertex).scaleAndAdd(size, direction).elements)
                );
            }

            node.addChild(new Hilo3d.Mesh({
                geometry: infoGeometry,
                material: new Hilo3d.BasicMaterial({
                    lightType: 'NONE',
                    diffuse: new Hilo3d.Color(...color)
                })
            }));
        });

        node.matrix.copy(mesh.matrix);
        return node;
    }
};

declare global {
    interface Window {
        NormalTangentHelper: typeof NormalTangentHelper;
    }
}

window.NormalTangentHelper = NormalTangentHelper;

export default NormalTangentHelper;
