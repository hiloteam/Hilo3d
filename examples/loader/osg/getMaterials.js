var texturesInfo = prefetchedData['/i' + location.pathname + '/textures'];
var textures = {};
texturesInfo.results.forEach(textureInfo => {
    var img = textureInfo.images.filter(img => {
        return img.width === 1024;
    })[0];
    if (!img) {
        img = textureInfo.images[0];
    }
    textures[textureInfo.uid] = {
        uid: textureInfo.uid,
        name: textureInfo.name,
        image: img.url
    }
});


function parseChanel(channel) {
    var result = {};
    if (channel.texture) {
        result.internalFormat = channel.texture.internalFormat;
        result.magFilter = channel.texture.magFilter;
        result.minFilter = channel.texture.minFilter;
        result.wrapS = channel.texture.wrapS;
        result.wrapT = channel.texture.wrapT;
        result.texture = textures[channel.texture.uid];
    } else if (channel.color) {
        result.color = Array.from(channel.color);
        if (result.color.length === 3) {
            result.color.push(1);
        }
    }
    if ('factor' in channel) {
        result.factor = channel.factor;
    }
    return result;
}

var modelInfo = prefetchedData['/i' + location.pathname];
var isPBR = modelInfo.options.shading.renderer === 'pbr';
var materialsInfo = modelInfo.options.materials;
console.log(materialsInfo);

var materials = {};
for (var id in materialsInfo) {
    var materialInfo = materialsInfo[id];
    var material = {};
    material.name = materialInfo.name;
    material.isPBR = isPBR;
    materials[material.name] = material;
    material.reflection = 0.1;
    var channels = materialInfo.channels;

    [
        ['Opacity', 'transparency'],
        // ['DiffuseColor', 'diffuse'],
        ['AlbedoPBR', 'baseColor'],
        ['EmitColor', 'emission'],
        ['AOPBR', 'ao'],
        ['DiffusePBR', 'diffuse'],
        // ['SpecularColor', 'specular'],
        ['RoughnessPBR', 'roughness'],
        // ['DiffuseIntensity', ''],
        ['GlossinessPBR', 'glossiness'],
        // ['NormalMap', 'normalMap'],
        // ['SpecularHardness', ],
        ['BumpMap', 'normalMap'],
        // ['CavityPBR', ],
        ['MetalnessPBR', 'metallic'],
        ['SpecularPBR', 'specular'],
        // ['SpecularF0', 'specular'],
    ].forEach(info => {
        material[info[1]] = parseChanel(channels[info[0]]);
    });
}

copy(materials);