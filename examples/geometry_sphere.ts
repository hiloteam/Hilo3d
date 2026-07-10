// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

var container = new Hilo3d.Node();
    var loader = new Hilo3d.BasicLoader();
    loader.load({
        src: '//gw.alicdn.com/tfs/TB1VUmoQFXXXXcjXFXXXXXXXXXX-1500-750.jpg',
        crossOrigin: 'anonymous'
    }).then(function(image){
        return new Hilo3d.Texture({image});
    }, function(err){
        return new Hilo3d.Color(.5, .5, .5);
    }).then(function (diffuse) {
        var geometry = new Hilo3d.SphereGeometry({
            radius: 1,
            heightSegments: 32,
            widthSegments: 64,
        })
        var material = new Hilo3d.BasicMaterial({
            lightType: 'NONE',
            diffuse: diffuse,
            wireframe:false
        });
        var mesh = new Hilo3d.Mesh({
            geometry: geometry,
            material: material
        });
        container.addChild(mesh);
        stage.addChild(container);

        // container.addChild(NormalTangentHelper.create(mesh, 0.1));
    })
