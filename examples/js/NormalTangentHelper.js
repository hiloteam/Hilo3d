(function(){
    var NormalTangentHelper = {
        create(mesh, size) {
            if (!size) {
                size = 1;
            }
            var node = new Hilo3d.Node();
            var geometry = mesh.geometry;
            var normals = geometry._normals;
            var tangents = geometry._tangents;
            var vertices = geometry.vertices;

            var colors = [
                [0, 0, 1],
                [1, 0, 0]
            ];
            [normals, tangents].forEach(function(info, index) {
                if(info){
                    var color = colors[index];
                    var point1 = new Hilo3d.Vector3();
                    var point2 = new Hilo3d.Vector3();
                    var infoGeometry = new Hilo3d.Geometry({
                        mode: Hilo3d.constants.LINES
                    });
                    for (var i = 0; i < info.count; i++) {
                        infoGeometry.addLine(
                            point1.copy(vertices.get(i)).elements,
                            point2.copy(vertices.get(i)).scaleAndAdd(size, info.get(i)).elements
                        );
                    }

                    var infoMesh = new Hilo3d.Mesh({
                        geometry: infoGeometry,
                        material: new Hilo3d.BasicMaterial({
                            lightType: 'NONE',
                            diffuse: new Hilo3d.Color(color[0], color[1], color[2])
                        })
                    });

                    node.addChild(infoMesh);
                }
            });
            node.matrix = mesh.matrix;
            return node;
        }
    };

    if(typeof module !== 'undefined'){
        module.exports = NormalTangentHelper;
    }

    if(typeof window !== 'undefined'){
        window.NormalTangentHelper = NormalTangentHelper;
    }
})();