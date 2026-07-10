// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

function rand(min, max) {
            return Math.random() * (max - min) + min;
        }

        var geometry = new Hilo3d.PlaneGeometry();
        var textureMaterial = new Hilo3d.BasicMaterial({
            lightType:'NONE',
            side:Hilo3d.constants.FRONT_AND_BACK,
            diffuse:new Hilo3d.LazyTexture({
                flipY: true,
                src:'//gw.alicdn.com/tfs/TB1iNtERXXXXXcBaXXXXXXXXXXX-600-600.png'
            })
        });

        for (var i = 0; i < 100; i++) {
            var rect = new Hilo3d.Mesh({
                geometry: geometry,
                material: Math.random() < .5 ? textureMaterial : new Hilo3d.BasicMaterial({
                    lightType:'NONE',
                    side:Hilo3d.constants.FRONT_AND_BACK,
                    diffuse: new Hilo3d.Color(Math.random(), Math.random(), Math.random())
                }),
                x: rand(-1, 1),
                y: rand(-1, 1),
                z: rand(-1, 1)
            });
            rect.setScale(rand(0.2, 0.2));
            stage.addChild(rect);
        }
