// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

orbitControls.isLockZ = true;

    const loadQueue = new Hilo3d.LoadQueue([{
        type: 'CubeTexture',
        images: [
            '//gw.alicdn.com/tfs/TB1Ss.ORpXXXXcNXVXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
            '//gw.alicdn.com/tfs/TB1YhUDRpXXXXcyaXXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
            '//gw.alicdn.com/tfs/TB1Y1MORpXXXXcpXVXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
            '//gw.alicdn.com/tfs/TB1ZgAqRpXXXXa0aFXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
            '//gw.alicdn.com/tfs/TB1IVZNRpXXXXaNXFXXXXXXXXXX-2048-2048.jpg_960x960.jpg',
            '//gw.alicdn.com/tfs/TB1M3gyRpXXXXb9apXXXXXXXXXX-2048-2048.jpg_960x960.jpg'
        ]
    }, {
        src: './models/Tmall/Tmall.gltf'
    }]).on('complete', function () {
        const result = loadQueue.getAllContent();
        const skyboxMap = result[0];
        const model = result[1];

        const skybox = new Hilo3d.Mesh({
            geometry: new Hilo3d.BoxGeometry(),
            material: new Hilo3d.BasicMaterial({
                lightType: 'NONE',
                side: Hilo3d.constants.BACK,
                diffuse: skyboxMap
            })
        }).addTo(stage);
        skybox.setScale(20);

        const material = new Hilo3d.BasicMaterial({
            diffuse: new Hilo3d.Color(0, 0, 0),
            specularEnvMap: skyboxMap,
            refractRatio: 1/1.5,
            refractivity: 0.8,
            reflectivity: 0.2
        });

        model.node.setScale(0.001);
        model.meshes.forEach(function (m) {
            m.material = material;
            material.jointCount = model.materials[0].jointCount;
        }); 
        stage.addChild(model.node);
        model.node.onUpdate = function () {
            material.specularEnvMatrix = new Hilo3d.Matrix4().invert(stage.worldMatrix);
        }
    }).start();
