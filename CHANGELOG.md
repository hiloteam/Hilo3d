## [1.18.1-shadow.0](https://github.com/hiloteam/Hilo3d/compare/1.18.0...1.18.1-shadow.0) (2023-04-23)


### Bug Fixes

* Implement the transpose function only in webgl1 ([012a4f7](https://github.com/hiloteam/Hilo3d/commit/012a4f7cda33b76a03932c17525b5fafc40c0efc))


### Features

* Add the ability to visualize shadow camera for debug ([c49a701](https://github.com/hiloteam/Hilo3d/commit/c49a701000ebb379967bf722448251d63bd963bf))
* Add the enableShadow property to lightManager to control whether to generate shadow map ([b448944](https://github.com/hiloteam/Hilo3d/commit/b448944b448ba2ac91f929b9d170dfcc280bc654))
* Add the ILightManager interface, which allows users to implement their own lighting controls ([c39d3de](https://github.com/hiloteam/Hilo3d/commit/c39d3dec339237c076affee96acb4871a74d24c8))
* Add the onlySyncQuaternion attribute of Node to optimize performance ([0739e6a](https://github.com/hiloteam/Hilo3d/commit/0739e6ad9198cd6b91e6cd381986a8686b936a76))
* Add worldMatrixVersion attribute to node for performance optimization ([6f8d76b](https://github.com/hiloteam/Hilo3d/commit/6f8d76b70ae563c69c5d1d89549e7f638dd663d6))
* Store shadow map Z in four channels to optimize precision ([481f260](https://github.com/hiloteam/Hilo3d/commit/481f26015e0f14f16279eb1fd7e156446bd59d52))


### Performance Improvements

* Optimize the performance of node transform changes ([5a263cf](https://github.com/hiloteam/Hilo3d/commit/5a263cfdb4366295c9b749a1d205fb56495a4c98))



# [1.18.0](https://github.com/hiloteam/Hilo3d/compare/1.17.0...1.18.0) (2023-01-29)


### Bug Fixes

* Fix Texture reset internalFormat bug ([2b3f534](https://github.com/hiloteam/Hilo3d/commit/2b3f534a4af77e3c3ee717879776b5feab5b591e))
* framebuffer resize should resize all attachments ([2b8aa0b](https://github.com/hiloteam/Hilo3d/commit/2b8aa0b38df7b0ec745d40c3861733cea6e7595a))


### Features

* add framebuffer drawBuffers ([2f68dc1](https://github.com/hiloteam/Hilo3d/commit/2f68dc101b9848d3252e4112fbea9eb441870f10))
* add uniform buffer object support ([03d2fa3](https://github.com/hiloteam/Hilo3d/commit/03d2fa3630664c04b79a163c969e443e95594070))



# [1.17.0](https://github.com/hiloteam/Hilo3d/compare/1.16.4...1.17.0) (2022-12-19)


### Features

* Add WebGL2 support ([#40](https://github.com/hiloteam/Hilo3d/issues/40)) ([3dc82ec](https://github.com/hiloteam/Hilo3d/commit/3dc82ec8f0ce8880413e6e756a57108baa81b77e))



## [1.16.4](https://github.com/hiloteam/Hilo3d/compare/1.16.3...1.16.4) (2022-11-14)


### Bug Fixes

* add TypedArray forEach polyfill to fix iOS9 bug ([59bf238](https://github.com/hiloteam/Hilo3d/commit/59bf238e12a63fc58e937f083ed77f2204e0bbce))
* Fix the bug of destroying mesh when using multiple materials ([e9e0175](https://github.com/hiloteam/Hilo3d/commit/e9e0175036631ec7649aaf16bac06b4a5e9599a9))
* wrong value in get shadow pcf while pos out of range ([#39](https://github.com/hiloteam/Hilo3d/issues/39)) ([f8a425a](https://github.com/hiloteam/Hilo3d/commit/f8a425a0aaf4ad7cc8f177af9ead230f90902e0e))



## [1.16.3](https://github.com/hiloteam/Hilo3d/compare/1.16.2...1.16.3) (2022-08-24)


### Bug Fixes

* Fix animation normalization bug ([35b5d19](https://github.com/hiloteam/Hilo3d/commit/35b5d194777e8d7fc3b5b3c1adc853a372e50d68))
* Fix pointerChildren value judgment error during node raycast ([4eee579](https://github.com/hiloteam/Hilo3d/commit/4eee5798cc5eefe7451af8d8317ecc1fe3d6e333))
* Fix frontface should be set in all cases ([6ccc39d](https://github.com/hiloteam/Hilo3d/commit/6ccc39de8ad048acd2602e5005c942422ac320fe))
* Fix in some cases, detecting the supportTransform property will report an error ([9215ba6](https://github.com/hiloteam/Hilo3d/commit/9215ba663bb44a4838cfe71ddf300be0dd8ef2b4))


### Features

* add lightManager.updateCustomInfo ([cc6d95b](https://github.com/hiloteam/Hilo3d/commit/cc6d95bae1b1d8732e066314a7511a13dbe71991))



## [1.16.2](https://github.com/hiloteam/Hilo3d/compare/1.16.1...1.16.2) (2022-03-24)


### Bug Fixes

* in KHR_techniques_webgl, premultiplyAlpha of material default value should be false ([bdf4100](https://github.com/hiloteam/Hilo3d/commit/bdf41003b803c50fad7e43ec9992c6fc33a14111))



## [1.16.1](https://github.com/hiloteam/Hilo3d/compare/1.16.0...1.16.1) (2022-03-23)


### Features

* add _Time semantic ([4a9a43d](https://github.com/hiloteam/Hilo3d/commit/4a9a43de486e295a50863d3c064e6687098a44f1))
* add material.shaderName ([25b1880](https://github.com/hiloteam/Hilo3d/commit/25b1880aaf56c6e0b172e19c984741cc7a17a0b0))
* imporve parsing of glTF KHR_techniques_webgl extension ([ca69682](https://github.com/hiloteam/Hilo3d/commit/ca6968209eada71714591122a3ee64d74a482c71))



# [1.16.0](https://github.com/hiloteam/Hilo3d/compare/1.15.20...1.16.0) (2022-01-04)


### Bug Fixes

* KHR_techniques_webgl parse texture bug ([f45879e](https://github.com/hiloteam/Hilo3d/commit/f45879ed7b826eb6049e14069120f0c2e3192f6b))
* pbr shader texture lod bug ([8256991](https://github.com/hiloteam/Hilo3d/commit/825699140ccc44bf7b9bbc83769526a5fac9584c))
* the nextTick callback of ticker should pass in the dt parameter ([db267cb](https://github.com/hiloteam/Hilo3d/commit/db267cb06d40bdb8ad63a3db7d14ca3ed1a43f71))
* unlit material transparency bug ([1006c60](https://github.com/hiloteam/Hilo3d/commit/1006c60340c511a908fd90d5ef8f331b1749d468))


### Features

* add JOINT & WEIGHT semantic ([2a9da6a](https://github.com/hiloteam/Hilo3d/commit/2a9da6aa59113c8e5f0d7cd4df46a938cd2e7d15))
* Add the function of dynamically modifying the targetFPS of the ticker ([e41f6cf](https://github.com/hiloteam/Hilo3d/commit/e41f6cf521040b0ffa0bf32b980eca1de0c15f84))



## [1.15.20](https://github.com/hiloteam/Hilo3d/compare/1.15.19...1.15.20) (2021-07-19)


### Bug Fixes

* the webglContextLost & webglContextRestored event should be triggered last ([87c9d2d](https://github.com/hiloteam/Hilo3d/commit/87c9d2d8ed9b2005f990db6acdab2e1e107058d9))



## [1.15.19](https://github.com/hiloteam/Hilo3d/compare/1.15.18...1.15.19) (2021-05-20)


### Features

* add wrapS & wrapT property of the framebuffer ([eaae512](https://github.com/hiloteam/Hilo3d/commit/eaae5129fc4324ece40d652bf7b76c625ef36d9b))



## [1.15.18](https://github.com/hiloteam/Hilo3d/compare/1.15.17...1.15.18) (2021-05-14)
* update doc & .d.ts 


## [1.15.17](https://github.com/hiloteam/Hilo3d/compare/1.15.16...1.15.17) (2021-02-22)


### Bug Fixes

* glTF texture should ignore texture colorspace conversion, fix [#32](https://github.com/hiloteam/Hilo3d/issues/32) ([08f1252](https://github.com/hiloteam/Hilo3d/commit/08f1252e4658131f425419f25c21313859645aea))


### Features

* add colorSpaceConversion property of the texture ([ddd170b](https://github.com/hiloteam/Hilo3d/commit/ddd170be451b7f76103f54d31ab934398254da2b))
* add PBRMaterial emissionFactor support ([de7cf25](https://github.com/hiloteam/Hilo3d/commit/de7cf25fd36cbc845fa829f7270f95e8f7aaa795))



## [1.15.16](https://github.com/hiloteam/Hilo3d/compare/1.15.15...1.15.16) (2021-01-20)

* update doc & .d.ts 
* refactor: optimize multiple destroy framebuffer ([c68599e](https://github.com/hiloteam/Hilo3d/commit/c68599e131c2f1b258d5675884cdcc06fcdda279))

## [1.15.15](https://github.com/hiloteam/Hilo3d/compare/1.15.14...1.15.15) (2021-01-05)


### Bug Fixes

* Animation.clipTime should be updated while updating the animStatesList ([447ae1e](https://github.com/hiloteam/Hilo3d/commit/447ae1e75a2213865a9ed42ac08a048ecf0ac9a5))



## [1.15.14](https://github.com/hiloteam/Hilo3d/compare/1.15.13...1.15.14) (2020-12-15)


### Features

* add LoadCache.getLoaded ([302c690](https://github.com/hiloteam/Hilo3d/commit/302c690b341c30537510f8b1b56cccc491a217b8))
* add Loader.preHandlerUrl ([ed7ff87](https://github.com/hiloteam/Hilo3d/commit/ed7ff8715701bbd5d81278985d88b76597297171))



## [1.15.13](https://github.com/hiloteam/Hilo3d/compare/1.15.12...1.15.13) (2020-11-18)


### Bug Fixes

* RenderList.useInstanced should update after renderer init ([d91293e](https://github.com/hiloteam/Hilo3d/commit/d91293ec2cefb7041ceb727aa07db7b37f229ba4))



## [1.15.12](https://github.com/hiloteam/Hilo3d/compare/1.15.11...1.15.12) (2020-11-05)


### Bug Fixes

* Semantic Tangent data should also be returned when there is no normal map ([c7b261b](https://github.com/hiloteam/Hilo3d/commit/c7b261b08803b6c4a0b185a9bac26e8725cf3e5d))


### Features

* Add GLTFLoader KHR_materials_clearcoat extension support ([0cfa90c](https://github.com/hiloteam/Hilo3d/commit/0cfa90c5109f8cd06aaa0478cc93fae1e4aeed00))
* Add material stencil support, close [#30](https://github.com/hiloteam/Hilo3d/issues/30) ([6dbb2c1](https://github.com/hiloteam/Hilo3d/commit/6dbb2c1530e47ba8a5ab5e148cdc4565a921cded))
* Add PBRMaterial Clearcoat support, close [#15](https://github.com/hiloteam/Hilo3d/issues/15) ([b83cbe6](https://github.com/hiloteam/Hilo3d/commit/b83cbe62dd243e1987573ab85871c5f64aaef68e))



## [1.15.11](https://github.com/hiloteam/Hilo3d/compare/1.15.10...1.15.11) (2020-10-19)


### Bug Fixes

* attribute pointer should use GeometryData.size ([bdab767](https://github.com/hiloteam/Hilo3d/commit/bdab767f621b17cb5fdd00ce633c1571383f91b0))



## [1.15.10](https://github.com/hiloteam/Hilo3d/compare/1.15.9...1.15.10) (2020-10-13)


### Bug Fixes

* Add light.isDirty and fix the bug that directionalLight lignt shadow does not update ([d808a89](https://github.com/hiloteam/Hilo3d/commit/d808a8992366c9d7537a26836f472bfd4ae1d051))


### Features

* add material.frontFace ([ef85b56](https://github.com/hiloteam/Hilo3d/commit/ef85b56f2eb1170ac2763deee2d059d514c08297))



## [1.15.9](https://github.com/hiloteam/Hilo3d/compare/1.15.8...1.15.9) (2020-09-10)


### Bug Fixes

* capabilities remove duplicate MAX_COMBINED_TEXTURE_IMAGE_UNITS ([f601071](https://github.com/hiloteam/Hilo3d/commit/f6010717e78dcf3e96e482797016bf71143e8d32))


### Features

* add userData property to Node,Geometry,Material and Skeleton ([40db285](https://github.com/hiloteam/Hilo3d/commit/40db285bfd5e3299b8e94931bed453b2a583d964))



## [1.15.8](https://github.com/hiloteam/Hilo3d/compare/1.15.7...1.15.8) (2020-09-01)
* update doc & .d.ts 



## [1.15.7](https://github.com/hiloteam/Hilo3d/compare/1.15.6...1.15.7) (2020-08-31)


### Bug Fixes

* iOS 9 doesn't support TypedArray slice, add polyfill ([7ad428a](https://github.com/hiloteam/Hilo3d/commit/7ad428ac71cd8a72ed8f601dd8e43097de7075ee))



## [1.15.6](https://github.com/hiloteam/Hilo3d/compare/1.15.5...1.15.6) (2020-08-26)
* update doc & .d.ts 


## [1.15.5](https://github.com/hiloteam/Hilo3d/compare/1.15.4...1.15.5) (2020-07-31)


### Bug Fixes

* vao.getResources miss checking whether the attribute is empty ([40ea681](https://github.com/hiloteam/Hilo3d/commit/40ea681bc8189081a784600522977d17e48a8486))


### Features

* add pbrMaterial.isSpecularEnvMapIncludeMipmaps ([#23](https://github.com/hiloteam/Hilo3d/issues/23)) ([fea3cdf](https://github.com/hiloteam/Hilo3d/commit/fea3cdfaded3c34452ba7bcf2273e74fd5fa76cb))



## [1.15.4](https://github.com/hiloteam/Hilo3d/compare/1.15.3...1.15.4) (2020-07-07)


### Bug Fixes

* skeleton.clone should also clone jointNames ([8168c64](https://github.com/hiloteam/Hilo3d/commit/8168c6457fb51f5d5df1119dde202956b0a5ac8e))



## [1.15.3](https://github.com/hiloteam/Hilo3d/compare/1.15.2...1.15.3) (2020-07-03)


### Bug Fixes

* skinnedMesh bone position is wrong under special circumstances ([cccd91e](https://github.com/hiloteam/Hilo3d/commit/cccd91e0dc2c552922c0083293532530ee56428d))



## [1.15.2](https://github.com/hiloteam/Hilo3d/compare/1.15.1...1.15.2) (2020-06-30)


### Bug Fixes

* ResourceManager.destroyUnsuedResource parameter become optional ([3e15fbe](https://github.com/hiloteam/Hilo3d/commit/3e15fbe9d6c141e580e85bfe97bd11cb253c4d0d))



## [1.15.1](https://github.com/hiloteam/Hilo3d/compare/1.15.0...1.15.1) (2020-06-24)


### Features

* add skeleton.resetJointNamesByNodeName ([91418e4](https://github.com/hiloteam/Hilo3d/commit/91418e4e3521a33e9b3dcf5a05df0da7f4460dee))



# [1.15.0](https://github.com/hiloteam/Hilo3d/compare/1.14.0...1.15.0) (2020-06-24)


### Bug Fixes

* cubic spline interpolation for quaternions is wrong ([47a93ab](https://github.com/hiloteam/Hilo3d/commit/47a93abef05435236dab150146e37031476c113c))
* geometryData bindLayout change should repoint attribute ([25d1282](https://github.com/hiloteam/Hilo3d/commit/25d12826b77dbfdff51ff647aaca90dcbea0be93))


### Features

* Add easier log level control ([b0a2870](https://github.com/hiloteam/Hilo3d/commit/b0a28708be3fbfa5714c4daeee6bbd1965d4a094))
* add Skeleton ([#9](https://github.com/hiloteam/Hilo3d/issues/9)) ([7944d70](https://github.com/hiloteam/Hilo3d/commit/7944d70eed88a694875e4a8842c53131a490f982))
* add SkinedMesh.resetJointNamesByNodeName ([14f095b](https://github.com/hiloteam/Hilo3d/commit/14f095b49de7a8819563b2ddc331069019e0bbeb))
* add skinedMesh.resetSkinIndices ([b7df689](https://github.com/hiloteam/Hilo3d/commit/b7df689785484f731fb1952ad9783926850d8ee8))


### Performance Improvements

* improve resource management performance ([#10](https://github.com/hiloteam/Hilo3d/issues/10)) ([6ff8cbd](https://github.com/hiloteam/Hilo3d/commit/6ff8cbd73f622ac2d47a895e797dabfca37084aa))



# [1.14.0](https://github.com/hiloteam/Hilo3d/compare/1.13.47...1.14.0) (2020-05-06)


### Bug Fixes

* GLTFParser.getImageType use indexOf check support type ([262dfb8](https://github.com/hiloteam/Hilo3d/commit/262dfb8d931b421a0d56b2bb7ef1522e6c6f8682))


### Features

* add GeometryData.getCopy ([4a03269](https://github.com/hiloteam/Hilo3d/commit/4a0326911c0cd83dcb362ef5c2d19a0c9614ab36))
* AnimationStates support custom State handler register ([cda1d01](https://github.com/hiloteam/Hilo3d/commit/cda1d012e0596c7114a0f8eac9ab3e83f7ad1141))



## [1.13.47](https://github.com/hiloteam/Hilo3d/compare/1.13.46...1.13.47) (2020-01-07)


### Bug Fixes

* LazyTexture release ktx image buffer data has not work ([321f017](https://github.com/hiloteam/Hilo3d/commit/321f017c20f6ef49b91704def1901831626f3b4a))



## [1.13.46](https://github.com/hiloteam/Hilo3d/compare/1.13.45...1.13.46) (2019-12-31)


### Performance Improvements

* optimize Buffer.uploadGeometryData ([152ec21](https://github.com/hiloteam/Hilo3d/commit/152ec2156002b02ca11a3a4dd8d23ce735176d44))


