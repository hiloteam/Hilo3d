// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

function loadTVModel() {
            const loader = new Hilo3d.GLTFLoader();
            return loader.load({
                src: '//g.alicdn.com/eva-assets/32c704f358ece9da27494b127f003c92/0.0.1/2018_flat_screen_tv/scene.gltf'
            }).then(function (model) {
                stage.addChild(model.node);
            });
        }

        function loadVideo() {
            return new Promise((resolve, reject) => {
                const video = document.getElementById('video');
                video.addEventListener('ended', function () {
                    video.play();
                });

                video.addEventListener('canplaythrough', function () {
                    resolve();
                });

                document.body.addEventListener('click', function () {
                    video.play();
                });
                video.play();
            });
        }

        function addVideoMesh() {
            const texture = new Hilo3d.Texture({
                image: video,
                wrapS: Hilo3d.constants.CLAMP_TO_EDGE,
                wrapT: Hilo3d.constants.CLAMP_TO_EDGE,
                autoUpdate: true,
                flipY: true,
            });

            const mesh = new Hilo3d.Mesh({
                material: new Hilo3d.PBRMaterial({
                    emission: texture,
                    emissionFactor:new Hilo3d.Vector4(1, 1, 1, 1),
                    baseColor: new Hilo3d.Vector4(0, 0, 0, 1),
                }),
                geometry: new Hilo3d.PlaneGeometry({
                    width: 1.95,
                    height: 1.1,
                }),
                y: 0.03,
            }).addTo(stage);
        }
    
        Promise.all([
            loadVideo(),
            loadTVModel(),
        ]).then(() => {
            addVideoMesh();
        });
