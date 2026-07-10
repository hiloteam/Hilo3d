// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

orbitControls.disable();
        
        renderer.onInit(function(renderer){
            var planeGeometry = new Hilo3d.PlaneGeometry();

            var images = {
                astc: ['astc'],
                etc: ['etc_etc2'],
                etc1: ['etc_etc1'],
                pvrtc: ['pvrtc'],
                s3tc: ['s3tc_dxt1', 's3tc_dxt3', 's3tc_dxt5']
            };

            var i = 0;
            for(var extType in images){
                var res = images[extType];
                if(Hilo3d.extensions.get(Hilo3d.KTXLoader[extType])){
                    res.forEach(function(src){
                        var loader = new Hilo3d.Loader();
                        loader.load({
                            src:'./image/compressed/logo_' + src + '.ktx'
                        }).then(function(texture){
                            texture.minFilter = Hilo3d.constants.NEAREST_MIPMAP_LINEAR;
                            var textureBox = new Hilo3d.Mesh({
                                geometry:planeGeometry,
                                material: new Hilo3d.BasicMaterial({
                                    lightType:'NONE',
                                    diffuse:texture,
                                    side:Hilo3d.constants.FRONT_AND_BACK
                                }),
                                rotationX:180,
                                x:0.8 * ( i % 2 - 0.5),
                                y:0.8 * ( 0.5 - Math.floor(i/2) ),
                                scaleX:0.66,
                                scaleY:0.66
                            });
                            i ++;
                            console.log(src, texture);
                            stage.addChild(textureBox);
                        });
                    })
                }
            }
        });
