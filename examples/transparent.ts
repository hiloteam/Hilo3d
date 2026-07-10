// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

var boxGeometry = new Hilo3d.BoxGeometry();
        boxGeometry.setAllRectUV([[0, 1], [1, 1], [1, 0], [0, 0]]);

        var container = new Hilo3d.Node({
            rotationY:-70
        }).addTo(stage);
        var n = totalNum = 8;
        while(n --){
            var box = new Hilo3d.Mesh({
                geometry: boxGeometry,
                material: new Hilo3d.BasicMaterial({
                    transparent:true,
                    transparency:0.5,
                    diffuse: new Hilo3d.Color(Math.random(), Math.random(), Math.random())
                }),
                x:- totalNum * 0.5 + n + 0.2,
                rotationX:n * 36,
                onUpdate: function() {
                    this.rotationX += .5;
                }
            });
            container.addChild(box);
        } 

        stage.setScale(0.4);
