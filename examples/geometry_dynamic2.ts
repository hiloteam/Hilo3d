// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

const g1 = new Hilo3d.BoxGeometry();
        
        const g2 = new Hilo3d.SphereGeometry({
            radius:0.5
        });
        
        const g3 = new Hilo3d.PlaneGeometry({
            width:0.6,
            height:0.6
        });
        
        const g4 = new Hilo3d.Geometry();
        g4.addFace([-0.5, -0.289, 0], [0, 0.577, 0], [0.5, -0.289, 0]);
        g4.addFace([-0.5, -0.289, 0], [0.5, -0.289, 0], [0, 0, 0.9]);
        g4.addFace([-0.5, -0.289, 0], [0, 0, 0.9], [0, 0.577, 0]);
        g4.addFace([0, 0.577, 0], [0, 0, 0.9], [0.5, -0.289, 0]);

        const gs = [g1, g2, g3, g4];
        const m = new Hilo3d.BasicMaterial({
            diffuse:new Hilo3d.Color(.4, .6, 1),
            side:Hilo3d.constants.FRONT_AND_BACK
        });

        const g = new Hilo3d.BoxGeometry({
            isStatic:false
        });
        const mesh = new Hilo3d.Mesh({
            geometry:g,
            material:m
        });
        stage.addChild(mesh);

        let gIndex = 0;
        setInterval(function(){
            g.vertices.data = gs[gIndex].vertices.data;
            g.indices.data = gs[gIndex].indices.data;
            g.normals.data = gs[gIndex].normals.data;
            gIndex ++;
            if(gIndex >= gs.length){
                gIndex = 0;
            }
        }, 500);
