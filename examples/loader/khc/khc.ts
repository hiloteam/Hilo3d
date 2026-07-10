// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

var loadQueue = new Hilo3d.LoadQueue([{
            crossOrigin: 'anonymous',
            src: '//gw.alicdn.com/tfs/TB15OJpQFXXXXXgXVXXXXXXXXXX-512-512.png'
        }, {
            crossOrigin: 'anonymous',
            src: '//gw.alicdn.com/tfs/TB1gwNqQFXXXXcIXFXXXXXXXXXX-512-512.png'
        }, {
            crossOrigin: 'anonymous',
            src: '//gw.alicdn.com/tfs/TB1pyNcQFXXXXb7XVXXXXXXXXXX-512-512.png'
        }, {
            crossOrigin: 'anonymous',
            src: '//gw.alicdn.com/tfs/TB1FilNQFXXXXcKXXXXXXXXXXXX-512-512.png'
        }, {
            crossOrigin: 'anonymous',
            src: '//gw.alicdn.com/tfs/TB1gIpqQFXXXXcZXFXXXXXXXXXX-512-512.png'
        }, {
            crossOrigin: 'anonymous',
            src: '//gw.alicdn.com/tfs/TB1RFXLQFXXXXXEXpXXXXXXXXXX-512-512.png'
        }, {
            src: '//cx.alicdn.com/tmx/2aa87481889ecab77adad40450eb502a.gltf'
        }]).on('complete', function () {
            var result = loadQueue.getAllContent();
            var skyboxMap = new Hilo3d.CubeTexture({
                image: result.filter(function(r){return r instanceof Image})
            });
            var khcTexture = new Hilo3d.Texture({
                image: document.getElementById('xx'),
                autoUpdate: true,
                wrapS: 33071,
                wrapT: 33071
            });

            var model = result.filter(function(r){return r.node})[0];
            model.node.setScale(.002);
            var screenMaterial = model.meshes[5].material;
            screenMaterial.diffuse = khcTexture;
            model.materials.forEach(function(material){
                if (material === screenMaterial) {
                    material.lightType = 'NONE';
                    return;
                }
                material.skyboxMap = skyboxMap;
                material.reflectivity = .1;
            });
            stage.addChild(model.node);
        }).start();
