// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

var container = new Hilo3d.Node();
        var material = new Hilo3d.BasicMaterial({ diffuse : new Hilo3d.Color(1, 0, 0) });
        var geometry = new Hilo3d.Geometry();

        geometry.addFace([-0.5, -0.289, 0], [0, 0.577, 0], [0.5, -0.289, 0]);
        geometry.addFace([-0.5, -0.289, 0], [0.5, -0.289, 0], [0, 0, 0.9]);
        geometry.addFace([-0.5, -0.289, 0], [0, 0, 0.9], [0, 0.577, 0]);
        geometry.addFace([0, 0.577, 0], [0, 0, 0.9], [0.5, -0.289, 0]);
        var mesh = new Hilo3d.Mesh({
            geometry: geometry,
            material: material
        });
        container.addChild(mesh);

        container.addChild(new Hilo3d.AxisHelper());
        stage.addChild(container);
