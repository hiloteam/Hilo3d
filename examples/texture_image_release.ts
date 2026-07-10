// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

// basic loader will cache all requests,
        // if you want to release image memory,
        // you should disable or clear(Hilo3d.BasicLoader.clearCache()) after load
        Hilo3d.BasicLoader.disableCache();
        var loader = new Hilo3d.Loader();

        loader.load({
            type: 'CubeTexture',
            isImageCanRelease: true,
            images: [
                '//gw.alicdn.com/tfs/TB1Ss.ORpXXXXcNXVXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
                '//gw.alicdn.com/tfs/TB1YhUDRpXXXXcyaXXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
                '//gw.alicdn.com/tfs/TB1Y1MORpXXXXcpXVXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
                '//gw.alicdn.com/tfs/TB1ZgAqRpXXXXa0aFXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
                '//gw.alicdn.com/tfs/TB1IVZNRpXXXXaNXFXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
                '//gw.alicdn.com/tfs/TB1M3gyRpXXXXb9apXXXXXXXXXX-2048-2048.jpg_960x960.jpg'
            ]
        }).then(skyboxMap => {
            window.skyboxMap = skyboxMap;
            var skybox = new Hilo3d.Mesh({
                geometry: new Hilo3d.BoxGeometry(),
                material: new Hilo3d.BasicMaterial({
                    lightType: 'NONE',
                    side: Hilo3d.constants.BACK,
                    diffuse: skyboxMap
                })
            }).addTo(stage);
            skybox.setScale(20);
        });

        var boxGeometry = new Hilo3d.BoxGeometry();
        boxGeometry.setAllRectUV([[0, 1], [1, 1], [1, 0], [0, 0]]);
        var texture = new Hilo3d.LazyTexture({
            isImageCanRelease: true,
            crossOrigin:true,
            src:'//gw.alicdn.com/tfs/TB1iNtERXXXXXcBaXXXXXXXXXXX-600-600.png'
        });

        var angle = 0;
        var axis = new Hilo3d.Vector3(1, 1, 1).normalize();
        var textureBox = new Hilo3d.Mesh({
            geometry:boxGeometry,
            material: new Hilo3d.BasicMaterial({
                diffuse: texture
            }),
            // x: 1,
            onUpdate: function() {
                angle += Hilo3d.math.DEG2RAD;
                this.quaternion.setAxisAngle(axis, angle);
            }
        });
        stage.addChild(textureBox);

        var idx = 0;
        setInterval(function() {
            loader.load({
                src: ++idx % 2 ? './models/Tmall/baseColor.png' : '//gw.alicdn.com/tfs/TB1iNtERXXXXXcBaXXXXXXXXXXX-600-600.png'
            }).then(img => {
                if (Math.random() < .5) {
                    texture.image = img;
                }
                texture.needUpdate = true;
            });
        }, 3000);
