// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

camera.z = 0;
        camera.fov = 90;
        const hdrLoader = new Hilo3d.HDRLoader();
        hdrLoader.load({
            src: '//g.alicdn.com/eva-assets/bf1ccbac4fc81cd77f007111766a5a58/0.0.1/christmas_photo_studio_01/1k.hdr'
        }).then(hdrTexture => {
            const material = new Hilo3d.BasicMaterial({
                lightType:'NONE',
                diffuse: hdrTexture,
                useHDR: true,
                exposure:2,
                side: Hilo3d.constants.BACK,
            });

            const sphereMesh = new Hilo3d.Mesh({
                material: material,
                geometry: new Hilo3d.SphereGeometry(),
                onUpdate() {
                    this.rotationY -= 0.1;
                }
            }).addTo(stage);

            Hilo3d.Tween.to(material, {
                exposure:10
            }, {
                duration:2000,
                reverse:true,
                loop:true
            })
        })
