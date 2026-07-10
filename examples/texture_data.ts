// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

var geometry = new Hilo3d.PlaneGeometry({
            width: 50,
            height: 50,
            heightSegments: 32,
            widthSegments: 64
        })

        camera.z = 90;
        camera.far = 1000;

        var data = new Float32Array(128);
        for (var i = 0; i < 128; i++) {
            data[i] = Math.random() * 2;
        }

        var colorBox = new Hilo3d.Mesh({
            geometry: geometry,
            material: new Hilo3d.BasicMaterial({
                diffuse: new Hilo3d.DataTexture({
                    data: data
                }),
                side:Hilo3d.constants.FRONT_AND_BACK
            }),
            onUpdate: function() {
                for (var i = 0; i < 128; i++) {
                    data[i] = Math.random() * 2;
                }

                this.material.diffuse.needUpdate = true;
            }
        });
        stage.addChild(colorBox);
