// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

var isWebGLSupport = Hilo3d.WebGLSupport.get();
        var canvas = document.createElement('canvas');
        var infoText = '';
        infoText += 'context: ' + canvas.getContext('webgl') + '<br/>';
        infoText += 'WebGLSupport: ' + isWebGLSupport;

        document.getElementById('info').innerHTML = infoText;
        if(isWebGLSupport){
            var boxGeometry = new Hilo3d.BoxGeometry();
            boxGeometry.setAllRectUV([[0, 1], [1, 1], [1, 0], [0, 0]]);

            var colorBox = new Hilo3d.Mesh({
                geometry: boxGeometry,
                material: new Hilo3d.BasicMaterial({
                    diffuse: new Hilo3d.Color(0.8, 0, 0)
                }),
                x: -1,
                onUpdate: function() {
                    this.rotationX += .5;
                    this.rotationY += .5;
                }
            });
            stage.addChild(colorBox);

            var textureBox = new Hilo3d.Mesh({
                geometry:boxGeometry,
                material: new Hilo3d.BasicMaterial({
                    diffuse:new Hilo3d.LazyTexture({
                        crossOrigin:true,
                        src:'//gw.alicdn.com/tfs/TB1iNtERXXXXXcBaXXXXXXXXXXX-600-600.png_500x500.jpg'
                    })
                }),
                x: 1,
                onUpdate: function() {
                    this.rotationX += .5;
                    this.rotationZ += .5;
                }
            });
            stage.addChild(textureBox);
        }
