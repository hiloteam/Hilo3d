// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

var boxGeometry = new Hilo3d.BoxGeometry({
            isStatic:false
        });
        boxGeometry.setAllRectUV([[0, 1], [1, 1], [1, 0], [0, 0]]);

        var textureBox = new Hilo3d.Mesh({
            geometry:boxGeometry,
            material: new Hilo3d.BasicMaterial({
                side:Hilo3d.constants.FRONT_AND_BACK,
                diffuse:new Hilo3d.LazyTexture({
                    crossOrigin:true,
                    src:'//gw.alicdn.com/tfs/TB1iNtERXXXXXcBaXXXXXXXXXXX-600-600.png'
                })
            }),
            rotationY:-60
        });

        stage.addChild(textureBox);
        
        var vertices = boxGeometry.vertices;
        var point = new Hilo3d.Vector3();
        point.copy(vertices.get(0));
        Hilo3d.Tween.to(point, {
            x:1
        }, {
            duration:500,
            reverse:true,
            loop:true,
            onUpdate(){
                vertices.set(0, point);
                boxGeometry.calculateNormals();
                boxGeometry.normals.isDirty = true;
                vertices.isDirty = true;
            }
        });
