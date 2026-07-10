// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

var planeGeometry = new Hilo3d.PlaneGeometry();

        var sRGBPlane = new Hilo3d.Mesh({
            geometry:planeGeometry,
            material: new Hilo3d.BasicMaterial({
                lightType: 'NONE',
                diffuse:new Hilo3d.LazyTexture({
                    src:'//gw.alicdn.com/imgextra/i2/O1CN015YnrkX1jp17VWipnN_!!6000000004596-2-tps-512-512.png',
                    format: Hilo3d.constants.RGBA,
                    internalFormat: Hilo3d.constants.SRGB8_ALPHA8,
                    flipY: true,
                    minFilter: Hilo3d.constants.NEAREST,
                    magFilter: Hilo3d.constants.NEAREST,
                }),
            }),
            x: -1,
        });
        stage.addChild(sRGBPlane);

        var linearPlane = new Hilo3d.Mesh({
            geometry:planeGeometry,
            material: new Hilo3d.BasicMaterial({
                lightType: 'NONE',
                diffuse:new Hilo3d.LazyTexture({
                    src:'//gw.alicdn.com/imgextra/i3/O1CN01sTOdgW1CgslZ8CrFJ_!!6000000000111-2-tps-512-512.png',
                    flipY: true,
                    minFilter: Hilo3d.constants.NEAREST,
                    magFilter: Hilo3d.constants.NEAREST,
                }),
            }),
            x: 1
        });
        stage.addChild(linearPlane);
