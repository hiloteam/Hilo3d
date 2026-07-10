// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

stage.addChild(new Hilo3d.AxisNetHelper({ size: 4 }));
        stage.addChild(new Hilo3d.AxisHelper());
        stage.rotationX = 30;
        window.u_diff = 0;
        Hilo3d.Tween.to(window, {
            u_diff: Math.PI * 2
        }, {
            duration: 3000,
            loop: true
        }).start();

        var loader = new Hilo3d.ShaderMaterialLoader();
        loader.load({
            fs: './test.frag',
            vs: './test.vert',
            attributes: {
                a_pos: 'POSITION',
                a_uv: 'TEXCOORD_0'
            },
            uniforms: {
                u_mat: 'MODELVIEWPROJECTION',
                u_diffuse: 'DIFFUSE',
                u_diff: {
                    get: function () {
                        return window.u_diff;
                    }
                }
            },
            // cullFace: true,
            wireframe: true,
            diffuse: new Hilo3d.LazyTexture({
                crossOrigin: true,
                src: '//img.alicdn.com/tfs/TB1va2xQVXXXXaFapXXXXXXXXXX-1024-710.jpg'
            })
        }).then(function(material){
            var geometry = new Hilo3d.PlaneGeometry({
                heightSegments: 100,
                widthSegments: 100
            });
            window.x = geometry;
            var plane = new Hilo3d.Mesh({
                // rotationX: -90,
                material: material,
                geometry: geometry
            });
            window.xx = plane;
            stage.addChild(plane);
        });
