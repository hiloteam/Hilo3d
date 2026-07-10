// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

function rand(min, max) {
            return Math.random() * (max - min) + min;
        }

        var geometry = new Hilo3d.PlaneGeometry();
      
        for (var i = 0; i < 100; i++) {
            var rect = new Hilo3d.Mesh({
                geometry: geometry,
                material: new Hilo3d.BasicMaterial({
                    lightType:'NONE',
                    diffuse: new Hilo3d.Color(Math.random(), Math.random(), Math.random())
                }),
                x: rand(-0.5, 0.5),
                y: rand(-0.5, 0.5),
                z: rand(-1, 1)
            });
            rect.setScale(rand(0.2, 0.2));
            stage.addChild(rect);
        }

        var ray = new Hilo3d.Ray();
        document.body.onclick = function(e){
            var mousePos = {
                x:e.clientX,
                y:e.clientY
            };

            ray.fromCamera(camera, mousePos.x, mousePos.y, stage.width, stage.height);

            var hitResult = stage.raycast(ray, true);
            if(hitResult){
                console.log(hitResult);
                hitResult.forEach(function(raycastInfo, index){
                    var mesh = raycastInfo.mesh;
                    Hilo3d.Tween.to(mesh, {
                        scaleX:0,
                        scaleY:0
                    }, {
                        reverse:false,
                        duration:300,
                        delay:index * 250,
                        onComplete:function(){
                            mesh.removeFromParent();
                        }
                    });
                });
            }
        };
