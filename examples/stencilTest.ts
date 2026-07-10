// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

stage.renderer.stencil = true;
        var boxGeometry = new Hilo3d.BoxGeometry();
        boxGeometry.setAllRectUV([[0, 1], [1, 1], [1, 0], [0, 0]]);

        var textureBox = new Hilo3d.Mesh({
            geometry:boxGeometry,
            material: new Hilo3d.BasicMaterial({
                renderOrder: 0,
                diffuse:new Hilo3d.LazyTexture({
                    crossOrigin:true,
                    src:'//gw.alicdn.com/tfs/TB1iNtERXXXXXcBaXXXXXXXXXXX-600-600.png'
                }),
                depthTest: false,
                stencilTest: true,
                stencilMask: 0xff,
                stencilFunc: Hilo3d.constants.ALWAYS,
                stencilFuncRef: 1,
                stencilFuncMask: 0xff,
                stencilOpFail: Hilo3d.constants.KEEP,
                stencilOpZFail: Hilo3d.constants.REPLACE,
                stencilOpZPass: Hilo3d.constants.REPLACE,
            }),
            onUpdate: function() {
                this.rotationX ++;
                this.rotationY += 2;
            }
        });
        textureBox.setScale(0.95);
        stage.addChild(textureBox);

        var textureBorderBox = new Hilo3d.Mesh({
            geometry:boxGeometry,
            material: new Hilo3d.BasicMaterial({
                renderOrder: 1,
                lightType: 'NONE',
                diffuse:new Hilo3d.Color(0, 0, 0),
                depthTest: false,
                stencilTest: true,
                stencilMask: 0x00,
                stencilFunc: Hilo3d.constants.EQUAL,
                stencilFuncRef: 0,
                stencilFuncMask: 0xff,
                stencilOpFail: Hilo3d.constants.KEEP,
                stencilOpZFail: Hilo3d.constants.KEEP,
                stencilOpZPass: Hilo3d.constants.KEEP,
            }),
            onUpdate: function() {
                this.rotationX ++;
                this.rotationY += 2;
            }
        });
        stage.addChild(textureBorderBox);
