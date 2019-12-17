English | [简体中文](./README_ZH.md)

<p align="center"><img src="https://gw.alicdn.com/tfs/TB1znqbquT2gK0jSZFvXXXnFXXa-569-143.svg" alt="omi" width="500"/></p>
<h3 align="center">A 3D WebGL Rendering Engine</h3>

---
[Installation](#Installation) • [Documentation](#Documentation) • [Development](#Development) • [Showcase](#Showcase) • [Examples](#Examples) • [Authors](#Authors) • [License](#License)

[![npm][npm-image]][npm-url] [![ci][ci-image]][ci-url] [![size][size-image]][cdn-url] [![gitter.im][gitter-image]][gitter-url]

### Features
* Compatible for multiple mobile and desktop bro wsers.
* Lightweight, only `100kb` after gzip.
* Physically-based rendering support.
* Perfect support for glTF models.

### Installation
* use npm

	```
	$ npm install hilo3d
	```
* use script tag from a [cdn][cdn-url]

	```
	<script src='//g.alicdn.com/hilo/Hilo3d/1.13.45/Hilo3d.js'></script>
	```

### Documentation
* [API documentation](https://hiloteam.github.io/Hilo3d/docs/index.html)
* [Tutorial](https://github.com/hiloteam/article/issues?q=is%3Aissue+is%3Aopen+label%3AHilo3d)

### Development
* run `npm run dev` to dev.
* run `npm run release` release the code.
* run `npm run doc` to build API documentation.
* run `npm run test` to run tests.

### Showcase

* 堆堆乐
  
  ![堆堆乐](https://raw.githubusercontent.com/06wj/06wj.github.com/master/images/hilo3d/ddl.gif)

* 天天惠星球

  ![天天惠星球](https://raw.githubusercontent.com/06wj/06wj.github.com/master/images/hilo3d/tthxq.gif)
 
### Examples

  * [Index.html](https://hiloteam.github.io/Hilo3d/docs/index.html)
  * glTF
    * [glTF Feature Test](https://cx20.github.io/gltf-test/?engines=Hilo3d)
	* [glTF Viewer](https://hiloteam.github.io/Hilo3d/examples/glTFViewer/index.html)

  * loader
    * [gltf_loader](https://hiloteam.github.io/Hilo3d/examples/loader/glTF_loader.html)
    * [gltf_clone](https://hiloteam.github.io/Hilo3d/examples/loader/glTF_clone.html)
    * [osg](https://hiloteam.github.io/Hilo3d/examples/loader/osg/osg_loader.html)
    * [smd](https://hiloteam.github.io/Hilo3d/examples/loader/smd/smd_loader.html)
    * [tga](https://hiloteam.github.io/Hilo3d/examples/loader/tga/tga_loader.html)
    * [khc](https://hiloteam.github.io/Hilo3d/examples/loader/khc/khc.html)
    * [shader](https://hiloteam.github.io/Hilo3d/examples/loader/shader/shader_loader.html)
    * [draco](https://hiloteam.github.io/Hilo3d/examples/loader/draco/draco_loader.html)
  * [compressed_texture](https://hiloteam.github.io/Hilo3d/examples/compressed_texture.html)
  * [fog](https://hiloteam.github.io/Hilo3d/examples/fog.html)
  * [mesh_picker](https://hiloteam.github.io/Hilo3d/examples/mesh_picker.html)
  * [mouse_event](https://hiloteam.github.io/Hilo3d/examples/mouse_event.html)
  * [lifegame](https://hiloteam.github.io/Hilo3d/examples/lifegame.html)
  * [normal_map](https://hiloteam.github.io/Hilo3d/examples/normal_map.html)
  * [pbr](https://hiloteam.github.io/Hilo3d/examples/pbr.html)
  * [pbr2](https://hiloteam.github.io/Hilo3d/examples/pbr2.html)
  * [polly](https://hiloteam.github.io/Hilo3d/examples/polly.html)
  * [post_process](https://hiloteam.github.io/Hilo3d/examples/post_process.html)
  * [raycast](https://hiloteam.github.io/Hilo3d/examples/raycast.html)
  * [raycast_node](https://hiloteam.github.io/Hilo3d/examples/raycast_node.html)
  * [shader_material](https://hiloteam.github.io/Hilo3d/examples/shader_material.html)
  * [shadow](https://hiloteam.github.io/Hilo3d/examples/shadow.html)
  * [skybox](https://hiloteam.github.io/Hilo3d/examples/skybox.html)
  * [sphereEnvMap](https://hiloteam.github.io/Hilo3d/examples/sphereEnvMap.html)
  * [spotLight](https://hiloteam.github.io/Hilo3d/examples/spotLight.html)
  * [ssao](https://hiloteam.github.io/Hilo3d/examples/ssao.html)
  * [texture_data](https://hiloteam.github.io/Hilo3d/examples/texture_data.html)
  * [transparent](https://hiloteam.github.io/Hilo3d/examples/transparent.html)
  * [video_in_cube](https://hiloteam.github.io/Hilo3d/examples/video_in_cube.html)
  * [webgl_support](https://hiloteam.github.io/Hilo3d/examples/webgl_support.html)
  * [wireframe](https://hiloteam.github.io/Hilo3d/examples/wireframe.html)
  * [geometry_box](https://hiloteam.github.io/Hilo3d/examples/geometry_box.html)
  * [geometry_box2](https://hiloteam.github.io/Hilo3d/examples/geometry_box2.html)
  * [geometry_color](https://hiloteam.github.io/Hilo3d/examples/geometry_color.html)
  * [geometry_custom](https://hiloteam.github.io/Hilo3d/examples/geometry_custom.html)
  * [geometry_dynamic](https://hiloteam.github.io/Hilo3d/examples/geometry_dynamic.html)
  * [geometry_dynamic2](https://hiloteam.github.io/Hilo3d/examples/geometry_dynamic2.html)
  * [geometry_instanced](https://hiloteam.github.io/Hilo3d/examples/geometry_instanced.html)
  * [geometry_merge](https://hiloteam.github.io/Hilo3d/examples/geometry_merge.html)
  * [geometry_morph](https://hiloteam.github.io/Hilo3d/examples/geometry_morph.html)
  * [geometry_sphere](https://hiloteam.github.io/Hilo3d/examples/geometry_sphere.html)



### Authors

 * [06wj](https://github.com/06wj)
 * [steel1990](https://github.com/steel1990)
 * [picacure](https://github.com/picacure)

### Contact us
  * [![gitter.im][gitter-image]][gitter-url]
  * QQ Group:372765886

### License

[MIT License](http://en.wikipedia.org/wiki/MIT_License)

[gitter-image]: https://img.shields.io/badge/GITTER-join%20chat-green.svg?style=flat-square
[gitter-url]: https://gitter.im/hiloteam/Hilo3d?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge
[npm-image]: https://img.shields.io/npm/v/hilo3d.svg?style=flat-square
[npm-url]: https://www.npmjs.com/package/hilo3d
[size-image]:https://img.badgesize.io/hiloteam/hilo3d/master/build/Hilo3d.js.svg?compression=gzip&style=flat-square
[ci-url]:https://github.com/hiloteam/Hilo3d/actions?query=workflow%3A%22npm+test%22+branch%3Adev
[ci-image]:https://img.shields.io/github/workflow/status/hiloteam/Hilo3d/npm%20test?style=flat-square
[cdn-url]: https://g.alicdn.com/hilo/Hilo3d/1.13.45/Hilo3d.js
