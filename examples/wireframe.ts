// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

const loader = new Hilo3d.GLTFLoader();
        loader.load({
            src: './models/Tmall/Tmall.gltf',
        }).then(function(model) {
            model.node.setScale(0.001);
            model.materials.forEach(material => {
                material.wireframe = true;
            });
            stage.addChild(model.node);
        });
