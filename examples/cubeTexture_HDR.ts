// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

Promise.all([
            './image/reflectionprobe-00.hdr',
            './image/reflectionprobe-01.hdr',
            './image/reflectionprobe-02.hdr',
            './image/reflectionprobe-03.hdr',
            './image/reflectionprobe-04.hdr',
            './image/reflectionprobe-05.hdr',
        ].map((src => new Hilo3d.HDRLoader().load({src})))
        ).then(textures => {
            var cubeTexture = new Hilo3d.CubeTexture({
                image: textures.map(texture => texture.image),
                type:Hilo3d.constants.FLOAT,
                width: textures[0].width,
                height: textures[0].height,
                format: textures[0].format,
                internalFormat: textures[0].internalFormat,
                minFilter: textures[0].minFilter,
                magFilter: textures[0].magFilter,
            });

           new Hilo3d.Mesh({
                geometry: new Hilo3d.BoxGeometry(),
                material: new Hilo3d.BasicMaterial({
                    lightType: 'NONE',
                    diffuse: cubeTexture,
                    side:Hilo3d.constants.BACK,
                    useHDR: true
                })
            }).addTo(stage);
        })
