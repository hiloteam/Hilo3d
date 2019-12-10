describe('display:geometry', () => {
    const camera = new Hilo3d.PerspectiveCamera({
        aspect: innerWidth / innerHeight,
        far: 100,
        near: 0.1,
        z: 3
    });

    const stage = new Hilo3d.Stage({
        container: document.querySelector('#stage'),
        camera: camera,
        clearColor: new Hilo3d.Color(1, 1, 1),
        width: innerWidth,
        height: innerHeight
    });

    var directionLight = new Hilo3d.DirectionalLight({
        color: new Hilo3d.Color(1, 1, 1),
        direction: new Hilo3d.Vector3(0.7, -1, -0.5)
    }).addTo(stage);

    var ambientLight = new Hilo3d.AmbientLight({
        color: new Hilo3d.Color(1, 1, 1),
        amount: .5
    }).addTo(stage);

    const material = new Hilo3d.BasicMaterial();

    const mesh = new Hilo3d.Mesh({
        material: material,
        rotationX: -60,
        rotationY: 30
    });

    stage.addChild(mesh);

    describe('color', () => {
        beforeEach('init color', () => {
            material.diffuse = new Hilo3d.Color(0.3, 0.6, 0.9);
        });

        it('box', (done) => {
            mesh.geometry = new Hilo3d.BoxGeometry();
            stage.tick();
            utils.diffWithScreenshot('geometry-color-box', done);
        });

        it('sphere', (done) => {
            mesh.geometry = new Hilo3d.SphereGeometry();
            stage.tick();
            utils.diffWithScreenshot('geometry-color-sphere', done);
        });

        it('plane', (done) => {
            mesh.geometry = new Hilo3d.PlaneGeometry();
            stage.tick();
            utils.diffWithScreenshot('geometry-color-plane', done);
        });
    });

    describe('texture', () => {
        const texture = new Hilo3d.Texture();
        const loader = new Hilo3d.TextureLoader();

        beforeEach('load image', (done) => {
            material.diffuse = texture;
            material.id = Hilo3d.math.generateUUID('BasicMaterial');
            loader.load({
                src: './asset/images/logo.png'
            }).then((texture) => {
                material.diffuse = texture;
                done();
            })
        });

        it('box', (done) => {
            mesh.geometry = new Hilo3d.BoxGeometry();
            mesh.geometry.setAllRectUV([
                [0, 1],
                [1, 1],
                [1, 0],
                [0, 0]
            ]);
            stage.tick();
            utils.diffWithScreenshot('geometry-texture-box', done);
        });

        it('sphere', (done) => {
            mesh.geometry = new Hilo3d.SphereGeometry();
            stage.tick();
            utils.diffWithScreenshot('geometry-texture-sphere', done);
        });

        it('plane', (done) => {
            mesh.geometry = new Hilo3d.PlaneGeometry();
            stage.tick();
            utils.diffWithScreenshot('geometry-texture-plane', done);
        });
    });
});