// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

var boxGeometry = new Hilo3d.BoxGeometry();
        boxGeometry.setAllRectUV([[0, 1], [1, 1], [1, 0], [0, 0]]);

        var colorBox = new Hilo3d.Mesh({
            geometry: boxGeometry,
            material: new Hilo3d.BasicMaterial({
                diffuse: new Hilo3d.Color(0.8, 0, 0)
            }),
            x: -1,
            onUpdate: function() {
                this.rotationX += .5;
                this.rotationY += .5;
            }
        });
        stage.addChild(colorBox);

        var angle = 0;
        var axis = new Hilo3d.Vector3(1, 1, 1).normalize();
        var textureBox = new Hilo3d.Mesh({
            geometry:boxGeometry,
            material: new Hilo3d.BasicMaterial({
                diffuse:new Hilo3d.LazyTexture({
                    crossOrigin:true,
                    src:'//gw.alicdn.com/tfs/TB1iNtERXXXXXcBaXXXXXXXXXXX-600-600.png'
                })
            }),
            x: 1,
            onUpdate: function() {
                angle += Hilo3d.math.DEG2RAD;
                this.quaternion.setAxisAngle(axis, angle);
            }
        });
        stage.addChild(textureBox);
