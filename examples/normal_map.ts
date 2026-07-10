// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

stage.addChild(new Hilo3d.AxisHelper());
        var loadQueue = new Hilo3d.LoadQueue();
        loadQueue.add([{
            id: 'brickwall',
            crossOrigin: 'anonymous',
            src: '//img.alicdn.com/tfs/TB1aNxtQpXXXXX1XVXXXXXXXXXX-1024-1024.jpg'
        }, {
            id: 'brickwall_normal',
            crossOrigin: 'anonymous',
            src: '//img.alicdn.com/tfs/TB1UCM6QXXXXXXKaFXXXXXXXXXX-1024-1024.jpg'
        }]).on('complete', function(evt) {
            var geometry = new Hilo3d.PlaneGeometry();
            var diffuse = new Hilo3d.Texture({
                image: loadQueue.get('brickwall').content
            });
            var normalTexture = new Hilo3d.Texture({
                image: loadQueue.get('brickwall_normal').content
            });
            var material = new Hilo3d.BasicMaterial({
                specular: new Hilo3d.Color(0.5, 0.5, 0.5),
                diffuse: diffuse,
                normalMap: normalTexture
            });
            var mesh = new Hilo3d.Mesh({
                geometry: geometry,
                material: material
            });
            window.xx = mesh;
            stage.addChild(mesh);
        }).on('error', function (err) {
            console.log('load err:' + JSON.stringify(err));
        }).start();

        var pointLight = new Hilo3d.PointLight({
            color:new Hilo3d.Color(0.5, 0.5, 0.5),
            x: 5,
            y: 2,
            z: 5,
            range:100
        });
        stage.addChild(pointLight);

        var blueBox = new Hilo3d.Mesh({
            geometry: new Hilo3d.BoxGeometry(),
            material: new Hilo3d.BasicMaterial({
                diffuse: new Hilo3d.Color(0, 0, 1),
                lightType:'NONE'
            })
        });
        blueBox.setScale(0.1);
        pointLight.addChild(blueBox);

        Hilo3d.Tween.to(pointLight, {
            x:-5
        }, {
            duration:2000,
            loop:true,
            reverse:true
        });
