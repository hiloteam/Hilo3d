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


