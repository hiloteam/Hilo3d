// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

const boxGeometry = new Hilo3d.BoxGeometry();
        boxGeometry.setAllRectUV([[0, 1], [1, 1], [1, 0], [0, 0]]);

        const tgaLoader = new Hilo3d.TGALoader();
        tgaLoader.load({
            src: '//g.alicdn.com/eva-assets/137b7a9ebee547ea998694edc62a0b68/0.0.1/tga_sample/tga_sample.tga'
        }).then(diffuse => {
            const box = new Hilo3d.Mesh({
                geometry: boxGeometry,
                material: new Hilo3d.BasicMaterial({
                    diffuse: diffuse
                }),
                onUpdate: function() {
                    this.rotationX += .5;
                    this.rotationZ += .5;
                }
            });
            stage.addChild(box);
        })
