// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

initModel();

    function initModel(){
        var gltfURL = './models/light.gltf';

        var loadQueue = new Hilo3d.LoadQueue([{
            type: 'CubeTexture',
            images: [
                './image/bakedDiffuse_01.jpg',
                './image/bakedDiffuse_02.jpg',
                './image/bakedDiffuse_03.jpg',
                './image/bakedDiffuse_04.jpg',
                './image/bakedDiffuse_05.jpg',
                './image/bakedDiffuse_06.jpg'
            ]
        }, {
            type: 'CubeTexture',
            right: './image/px.jpg',
            left: './image/nx.jpg',
            top: './image/py.jpg',
            bottom: './image/ny.jpg',
            front: './image/pz.jpg',
            back: './image/nz.jpg',
            magFilter: Hilo3d.constants.LINEAR,
            minFilter: Hilo3d.constants.LINEAR_MIPMAP_LINEAR
        },{
            src: './image/brdfLUT.png',
            wrapS: Hilo3d.constants.CLAMP_TO_EDGE,
            wrapT: Hilo3d.constants.CLAMP_TO_EDGE,
            type:'Texture'
        },{
            src:gltfURL
        }]).start().on('complete', function(){
            var result = loadQueue.getAllContent();
            var diffuseEnvMap = result[0];
            var specularEnvMap = result[1];
            var brdfTexture = result[2];
            var model = window.model = result[3];

            stage.addChild(model.node);

            var skyBox = new Hilo3d.Mesh({
                geometry: new Hilo3d.BoxGeometry(),
                material: new Hilo3d.BasicMaterial({
                    lightType: 'NONE',
                    side: Hilo3d.constants.BACK,
                    diffuse: specularEnvMap
                })
            }).addTo(stage);
            skyBox.setScale(20);

            stage.addChild(new Hilo3d.Mesh({
                y:-0.5,
                scaleX:2,
                scaleY:0.1,
                scaleZ:2,
                geometry:new Hilo3d.BoxGeometry,
                material:new Hilo3d.PBRMaterial({
                    baseColor:new Hilo3d.Color(1, 1, 1, 1),
                    brdfLUT:brdfTexture,
                    diffuseEnvMap:diffuseEnvMap,
                    specularEnvMap:specularEnvMap
                })
            }))

            stage.addChild(new Hilo3d.Mesh({
                y:0.5,
                scaleX:2,
                scaleY:0.1,
                scaleZ:2,
                geometry:new Hilo3d.BoxGeometry,
                material:new Hilo3d.PBRMaterial({
                    brdfLUT:brdfTexture,
                    diffuseEnvMap:diffuseEnvMap,
                    specularEnvMap:specularEnvMap,
                    baseColor:new Hilo3d.Color(1, 1, 1, 1)
                })
            }))


            model.node.getChildrenByClassName('PointLight').forEach(function(light){
                light.parent.addChild(new Hilo3d.Mesh({
                    geometry:new Hilo3d.SphereGeometry,
                    material:new Hilo3d.BasicMaterial({
                        diffuse:light.color,
                        lightType:'NONE'
                    }),
                    scaleX:0.05,
                    scaleY:0.05,
                    scaleZ:0.05,
                }))
            });

            model.node.getChildrenByClassName('SpotLight').forEach(function(light){
                window.spotLight = light;
                light.parent.addChild(new Hilo3d.Mesh({
                    geometry:new Hilo3d.SphereGeometry,
                    material:new Hilo3d.BasicMaterial({
                        diffuse:light.color,
                        lightType:'NONE'
                    }),
                    scaleX:0.05,
                    scaleY:0.05,
                    scaleZ:0.05,
                }))
            });

            model.node.getChildrenByClassName('DirectionalLight').forEach(function(light){
                window.spotLight = light;
                light.parent.addChild(new Hilo3d.Mesh({
                    geometry:new Hilo3d.SphereGeometry,
                    material:new Hilo3d.BasicMaterial({
                        diffuse:light.color,
                        lightType:'NONE'
                    }),
                    scaleX:0.05,
                    scaleY:0.05,
                    scaleZ:0.05,
                }))
            });
        });
    }
