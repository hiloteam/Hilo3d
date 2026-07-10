// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

stage.rotationX = 30;
        camera.far = 5;
        directionLight.shadow = {};
        renderer.clearColor.set(0, 0, 0, 1);
        var loadQueue = new Hilo3d.LoadQueue();

        var smdList = [
            'attack',
            'attack2',
            'attack3',
            'death',
            'flail',
            'idle',
            'idle2',
            'idle3',
            'idle_angry',
            'loadout',
            'nasal_goo',
            'portrait',
            'portrait2',
            'portrait3',
            'quill_spray',
            'run',
            'run_angry',
            'stun',
            'teleport_end'
        ];

        var loadList = [{
            isProgressive: true,
            src: '//cx.alicdn.com/tmx/d2cae334015474802976b87d07f89307.gltf'
        }];

        smdList.forEach(function (name) {
            loadList.push({
                name: name,
                src: './res/' + name + '.smd'
            });
        });


        var currentModel = null;
        var animMap = {};
        var animSelect = document.getElementById('animSelect');
        function changeAnim(name) {
            currentModel.rotationX = -90
            currentModel.anim && currentModel.anim.stop();
            currentModel.setAnim(animMap[name]);
            currentModel.anim.play();
        }
        animSelect.addEventListener('change', function () {
            changeAnim(animSelect.value);
        });

        loadQueue.add(loadList).on('load', function(evt) {
            var result = evt.detail.content;
            if (result.node) {
                result.node.y = .2;
                result.node.setScale(0.002);
                stage.addChild(result.node);
                currentModel = result.node;
            } else {
                var name = evt.detail.name;
                animMap[name] = result;
                var opt = document.createElement('option');
                opt.innerText = name;
                opt.setAttribute('value', name);
                animSelect.appendChild(opt);
                if (currentModel && !currentModel.anim) {
                    animSelect.value = name;
                    changeAnim(name);
                }
            }
        }).on('error', function (err) {
            console.log('err:' + err);
        }).start();

        // stage.addChild(new Hilo3d.AxisNetHelper({ size: 5 }));
        stage.addChild(new Hilo3d.Mesh({
            rotationX: -90,
            geometry: new Hilo3d.PlaneGeometry({
                width: 2,
                height: 2
            }),
            material: new Hilo3d.BasicMaterial({
                diffuse: new Hilo3d.Color(1, 0, 0)
            })
        }))
