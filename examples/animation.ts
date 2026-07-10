// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

camera.z = 4.5;
        var boxGeometry = new Hilo3d.BoxGeometry();
        boxGeometry.setAllRectUV([[0, 1], [1, 1], [1, 0], [0, 0]]);

        var textureBox = new Hilo3d.Mesh({
            name: 'textureBox',
            geometry:boxGeometry,
            material: new Hilo3d.BasicMaterial({
                diffuse:new Hilo3d.LazyTexture({
                    src:'//gw.alicdn.com/tfs/TB1iNtERXXXXXcBaXXXXXXXXXXX-600-600.png'
                })
            }),
        });
        stage.addChild(textureBox);

        const anim = new Hilo3d.Animation({
          animStatesList: [
            new Hilo3d.AnimationStates({
              interpolationType: 'LINEAR',
              nodeName: 'textureBox',
              keyTime: [1, 1.5, 2, 2.5, 3.5],
              states: [[1, 1, 0], [.4, -.5, .3], [-.4, -.5, .3], [-1, 1, 0], [1, 1, 0]],
              type: 'Translation',
            }),
            new Hilo3d.AnimationStates({
              interpolationType: 'LINEAR',
              nodeName: 'textureBox',
              keyTime: [1, 1.5, 2, 2.5],
              states: [[.5, 1, 1], [1, .5, 1], [.5, 1, 1], [1, .5, 1]],
              type: 'Scale',
            }),
          ]
        });
        anim.rootNode = textureBox;
        anim.play();
