English | [简体中文](./README_ZH.md)

<p align="center"><img src="https://gw.alicdn.com/tfs/TB1znqbquT2gK0jSZFvXXXnFXXa-569-143.svg" alt="omi" width="500"/></p>
<h3 align="center">A 3D WebGL Rendering Engine</h3>

---
[Installation](#Installation) • [Documentation](#Documentation) • [Development](#Development) • [Showcase](#Showcase) • [Examples](#Examples) • [Authors](#Authors) • [License](#License)

[![npm][npm-image]][npm-url] [![ci][ci-image]][ci-url] [![size][size-image]][cdn-url] [![gitter.im][gitter-image]][gitter-url]

### Features
* Compatible for multiple mobile and desktop browsers.
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
	<script src='//cdn.jsdelivr.net/npm/hilo3d@1.15.13/build/Hilo3d.js'></script>
	```

### Documentation
* [API documentation](https://hilo3d.js.org/docs/index.html)
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
 
* More cases can be found here: 
  [![](https://gw.alicdn.com/tfs/TB1rngb0pT7gK0jSZFpXXaTkpXa-2048-1009.jpg)](https://seinjs.com/cn/production)

### Examples

  * [Index.html](https://hilo3d.js.org/docs/index.html)
  * glTF
    * [glTF Feature Test](https://cx20.github.io/gltf-test/?engines=Hilo3d)
	* [glTF Viewer](https://hilo3d.js.org/examples/glTFViewer/index.html)

  * loader
    * [gltf_loader](https://hilo3d.js.org/examples/loader/glTF_loader.html)
    * [gltf_clone](https://hilo3d.js.org/examples/loader/glTF_clone.html)
    * [osg](https://hilo3d.js.org/examples/loader/osg/osg_loader.html)
    * [smd](https://hilo3d.js.org/examples/loader/smd/smd_loader.html)
    * [tga](https://hilo3d.js.org/examples/loader/tga/tga_loader.html)
    * [khc](https://hilo3d.js.org/examples/loader/khc/khc.html)
    * [shader](https://hilo3d.js.org/examples/loader/shader/shader_loader.html)
    * [draco](https://hilo3d.js.org/examples/loader/draco/draco_loader.html)
  * [compressed_texture](https://hilo3d.js.org/examples/compressed_texture.html)
  * [fog](https://hilo3d.js.org/examples/fog.html)
  * [mesh_picker](https://hilo3d.js.org/examples/mesh_picker.html)
  * [mouse_event](https://hilo3d.js.org/examples/mouse_event.html)
  * [lifegame](https://hilo3d.js.org/examples/lifegame.html)
  * [normal_map](https://hilo3d.js.org/examples/normal_map.html)
  * [pbr](https://hilo3d.js.org/examples/pbr.html)
  * [pbr2](https://hilo3d.js.org/examples/pbr2.html)
  * [polly](https://hilo3d.js.org/examples/polly.html)
  * [post_process](https://hilo3d.js.org/examples/post_process.html)
  * [raycast](https://hilo3d.js.org/examples/raycast.html)
  * [raycast_node](https://hilo3d.js.org/examples/raycast_node.html)
  * [shader_material](https://hilo3d.js.org/examples/shader_material.html)
  * [shadow](https://hilo3d.js.org/examples/shadow.html)
  * [skybox](https://hilo3d.js.org/examples/skybox.html)
  * [sphereEnvMap](https://hilo3d.js.org/examples/sphereEnvMap.html)
  * [spotLight](https://hilo3d.js.org/examples/spotLight.html)
  * [ssao](https://hilo3d.js.org/examples/ssao.html)
  * [texture_data](https://hilo3d.js.org/examples/texture_data.html)
  * [transparent](https://hilo3d.js.org/examples/transparent.html)
  * [video_in_cube](https://hilo3d.js.org/examples/video_in_cube.html)
  * [webgl_support](https://hilo3d.js.org/examples/webgl_support.html)
  * [wireframe](https://hilo3d.js.org/examples/wireframe.html)
  * [geometry_box](https://hilo3d.js.org/examples/geometry_box.html)
  * [geometry_box2](https://hilo3d.js.org/examples/geometry_box2.html)
  * [geometry_color](https://hilo3d.js.org/examples/geometry_color.html)
  * [geometry_custom](https://hilo3d.js.org/examples/geometry_custom.html)
  * [geometry_dynamic](https://hilo3d.js.org/examples/geometry_dynamic.html)
  * [geometry_dynamic2](https://hilo3d.js.org/examples/geometry_dynamic2.html)
  * [geometry_instanced](https://hilo3d.js.org/examples/geometry_instanced.html)
  * [geometry_merge](https://hilo3d.js.org/examples/geometry_merge.html)
  * [geometry_morph](https://hilo3d.js.org/examples/geometry_morph.html)
  * [geometry_sphere](https://hilo3d.js.org/examples/geometry_sphere.html)



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
[cdn-url]: https://cdn.jsdelivr.net/npm/hilo3d@1.15.13/build/Hilo3d.js
