// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

var material = new Hilo3d.BasicMaterial({ 
            diffuse : new Hilo3d.Color(1, 0, 0),
            lightType:'NONE'
        });
        var geometry = new Hilo3d.Geometry({ mode: Hilo3d.constants.LINES });
        geometry.addPoints([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
        geometry.addIndices(0, 1, 0, 2, 0, 3);
        
        var mesh = new Hilo3d.Mesh({
            geometry: geometry,
            material: material,
            rotationX: 30,
            rotationY: 30
        });
        stage.addChild(mesh);
