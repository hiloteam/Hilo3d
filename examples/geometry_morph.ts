// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

var boxGeometry = new Hilo3d.BoxGeometry();
        boxGeometry.setAllRectUV([[0, 1], [1, 1], [1, 0], [0, 0]]);
        directionLight.direction.set(-1, -0.5, 0);

        var morphGeometry = new Hilo3d.MorphGeometry({
            vertices: boxGeometry.vertices.clone(),
            indices: boxGeometry.indices.clone(),
            uvs: boxGeometry.uvs.clone(),
            weights:[0, 1]
        }); 

        morphGeometry.targets = {
            vertices: [new Hilo3d.GeometryData(new Float32Array(morphGeometry.vertices.length), 3), new Hilo3d.GeometryData(new Float32Array(morphGeometry.vertices.length), 3)]
        };

        var a = new Hilo3d.Vector3(0.5, 0.5, 0.5);
        var b = new Hilo3d.Vector3(-0.5, -0.5, -0.5);
        morphGeometry.vertices.traverse(function(attribute, index){
            if (attribute.equals(a)) {
                morphGeometry.targets.vertices[0].set(index, new Hilo3d.Vector3(0.3, 0.3, 0.3));
            }

            if (attribute.equals(b)) {
                morphGeometry.targets.vertices[1].set(index, new Hilo3d.Vector3(-0.3, -0.3, -0.3));
            }
        })

        var mesh = new Hilo3d.Mesh({
            geometry: morphGeometry,
            material:new Hilo3d.PBRMaterial({
                baseColorMap:new Hilo3d.LazyTexture({
                    src:'//gw.alicdn.com/tfs/TB1iNtERXXXXXcBaXXXXXXXXXXX-600-600.png'
                })
            }),
            onUpdate:function(){
                var weights = this.geometry.weights;
                weights[0] = Math.abs(Math.sin(new Date().getTime()/1000));
                weights[1] = 1 - weights[0];
            }
        }).addTo(stage);
