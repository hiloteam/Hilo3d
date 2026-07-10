// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

function rand(min, max) {
            return Math.random() * (max - min) + min;
        }

        var geometry = new Hilo3d.PlaneGeometry();
        var container = new Hilo3d.Node();
        stage.addChild(container);

        for (var i = 0; i < 100; i++) {
            var rect = new Hilo3d.Mesh({
                geometry: geometry,
                material: new Hilo3d.BasicMaterial({
                    lightType:'NONE',
                    diffuse: new Hilo3d.Color(Math.random(), Math.random(), Math.random()),
                    transparent:true,
                    side:Hilo3d.constants.FRONT_AND_BACK
                }),
                x: rand(-0.5, 0.5),
                y: rand(-0.5, 0.5),
                z: rand(-1, 1),
                useHandCursor:true
            });
            rect.setScale(rand(0.2, 0.2));
            container.addChild(rect);
        }

        stage.enableDOMEvent([Hilo3d.browser.POINTER_START, Hilo3d.browser.POINTER_MOVE, Hilo3d.browser.POINTER_END, 'mouseover', 'mouseout']);
        stage.on('mouseover', (e)=>{
            var eventTarget = e.eventTarget;
            if(eventTarget.isMesh){
                eventTarget.material.transparency = 0.5;
                console.log('mesh', e.hitPoint.elements);
            }
            else{
                // console.log('stage', e.hitPoint.elements);
            }
        });

        stage.on('mouseout', (e)=>{
            var eventTarget = e.eventTarget;
            if(eventTarget.isMesh){
                eventTarget.material.transparency = 1;
            }
        });
