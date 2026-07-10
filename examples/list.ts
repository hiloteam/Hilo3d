// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

var listElem = document.getElementById('exampleList');
        var iframeElem = document.getElementById('exampleFrame');
        var examples = [
            'areaLight',
            'billboard',
            'bloom',
            'cameraHelper',
            'compressed_texture',
            'cubeTexture_HDR',
            'custom_anim_state',
            'depthTexture',
            'drawBuffers',
            'fog',
            'MultiSampledRenderbuffers',
            'frameBuffer',
            'frustum_test',
            'geometry_box',
            'geometry_color',
            'geometry_custom',
            'geometry_dynamic',
            'geometry_dynamic2',
            'geometry_instanced',
            'geometry_line',
            'geometry_merge',
            'geometry_morph',
            'geometry_plane',
            'geometry_sphere',
            'geometry_triangles',
            'animation',
            'gltf_light',
            'hdr',
            'lifegame',
            'mesh_picker',
            'mouse_event',
            'normal_map',
            'pbr',
            'pbr2',
            'pointLight',
            'polly',
            'post_process',
            'quickStart',
            'raycast',
            'raycast_node',
            'refract',
            'resourceManagerTest',
            'sRGB',
            'shaderToy',
            'shader_material',
            'shadow',
            'skybox',
            'snow',
            'sphereEnvMap',
            'sphericalHarmonics',
            'spotLight',
            'ssao',
            'stencilTest',
            'textureLod',
            'texture_data',
            'texture_image_release',
            'transparent',
            'tween_walk',
            'uniformBufferObject',
            'update_sub_texture',
            'uv_map',
            'video',
            'webgl_support',
            'wireframe',
            ['physics','./physics/cannon'],
        ];

        function getExampleName(name){
            if(Object.prototype.toString.call(name) === '[object Array]'){
                return name[0];
            }
            else{
                return name;
            }
        }

        function getExamplePath(name){
            if(Object.prototype.toString.call(name) === '[object Array]'){
                return name[1] + '.html';
            }
            else{
                return name + '.html';
            }
        }

        var examplesDict = {};
        for(var i = 0;i < examples.length;i ++){
            (function(originName, i){
                var name = getExampleName(originName);
                var elem = document.createElement('li');
                examplesDict[name] = {
                    elem:elem,
                    originName:originName
                };
                elem.innerHTML = name;
                listElem.appendChild(elem);
                elem.onclick = function(){
                    setDemo(originName);
                };
            })(examples[i], i);
        }

        var winWidth = window.innerWidth || document.documentElement.clientWidth;
        var winHeight = window.innerHeight || document.documentElement.clientHeight;
        
        iframeElem.width = winWidth - 220;
        iframeElem.height = winHeight;
        var iframeWindow = iframeElem.contentWindow;

        var hashName = location.hash.slice(1);
        var currentName = '';
        function setDemo(originName, first){
            var name = getExampleName(originName);
            var path = getExamplePath(originName);
            if(name !== currentName){
                location.hash = name;
                iframeElem.src = path + (first?location.search:iframeWindow.location.search);
                if(examplesDict[currentName]){
                    examplesDict[currentName].elem.className = '';
                }
                examplesDict[name].elem.className = 'active';
                currentName = name;
            }
        }

        setDemo(examplesDict[hashName]?examplesDict[hashName].originName:examples[0], true);

        window.onkeydown = function(e){
            var index = examples.indexOf(examplesDict[currentName].originName);
            switch(e.keyCode){
                case 38://up
                case 87://w
                    index --;
                    break;
                case 40://down
                case 83://s
                    index ++;
                    break;
            }
            if(index < 0){
                index = examples.length - 1;
            }
            else if(index > examples.length - 1){
                index = 0;
            }

            setDemo(examples[index]);
        };

        document.getElementById('webglVersionForm').onchange = function(event) {
            location.search = event.target.id === 'webglVersion1' ? '?webgl1=true' : '?webgl2=true';
        }

        if (location.search.indexOf('webgl2') > -1) {
            document.getElementById('webglVersion2').checked = true;
        } else {
            document.getElementById('webglVersion1').checked = true;
        }
