# Current RHI benchmark baseline report

- Commit: `2f72d916510db137b8e3cbb16161a1b38721c227`
- Captured: 2026-09-01T09:38:18.285Z
- Rig: hilo3d-rhi-perf-macos-m3-max
- Environment fingerprint: `c89bae9e3c047006365f4b6eb260b16c7478b6f60c3d15c09e88578848cdce68`
- Chromium executable: `b1b9e2dd063115031f08eadc10ed381ca0fa05b2284baff8f721d87f5f0f61b7`
- Raw artifact: `current.raw.json.gz` (`5495b2aaed933eaf827d3dd847a8060ad201c2599e2541aaecc1838ea7d1da4b`)

## static-unlit-single-draw / webgl2

Pixel hash: `d0d7836c34cb6999c72c550cfcb16120f4ffcbbeb6558bbca78f4d70366b44c1`; observed draws: 2.

| Metric | Round-median median | Worst p95 | Worst p99 | Median MAD | Median CV | Bootstrap CI envelope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frameBuildCpuMs | 0.20499998 | 0.33999999 | 0.60015001 | 0.024999961 | 0.38004640 | 0.19999999–0.22000000 |
| graphCompileCpuMs | 0.015000001 | 0.035250010 | 0.060150002 | 0.0049999952 | 1.2110532 | 0.015000001–0.019999996 |
| rhiCommandCpuMs | 0.46499999 | 0.59999999 | 0.72559999 | 0.029999986 | 0.12939041 | 0.45999999–0.48000000 |
| rhiExecuteCpuMs | 0.064999998 | 0.089999989 | 0.11505001 | 0.0049999952 | 0.19886414 | 0.064999998–0.069999993 |
| rhiTotalCpuMs | 0.53000000 | 0.68500000 | 0.81540001 | 0.030000001 | 0.12272160 | 0.52499999–0.55000000 |
| rendererCpuMs | 0.82499999 | 1.1250000 | 1.4514000 | 0.059999987 | 0.18014903 | 0.81000000–0.86999999 |
| gpuFrameMs | 0.84160350 | 2.6515202 | 2.9339890 | 0.74604150 | 0.89259990 | 0.64951529–1.1280615 |
| allocationBytesPerFrame | 129228 | 131496 | 131697.60 | 128 | 0.0093768622 | 129100–131748 |
| rhiHotPathAllocationBytesPerFrame | 0 | 0 | 0 | 0 | 0 | 0–0 |
| rhiCommandCount | 21 | 21 | 21 | 0 | 0 | 21–21 |
| actualDrawCount | 2 | 2 | 2 | 0 | 0 | 2–2 |
| nativeStateCallCount | 19 | 19 | 19 | 0 | 0 | 19–19 |
| pipelineCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| bindGroupCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| vaoCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| framebufferCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| heapHighWaterBytes | 60957580 | 61078648 | 61078648 | 0 | 0 | 59434656–61078648 |
| retainedHeapBytes | 20882708 | 20883016 | 20883016 | 0 | 0 | 20882228–20883016 |
| nativeBufferCreateCount | 10 | 10 | 10 | 0 | 0 | 10–10 |
| nativeTextureCreateCount | 2 | 2 | 2 | 0 | 0 | 2–2 |
| nativePipelineCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeBindGroupCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeVaoCreateCount | 2 | 2 | 2 | 0 | 0 | 2–2 |
| nativeProgramCreateCount | 2 | 2 | 2 | 0 | 0 | 2–2 |
| firstComplexFrameCpuMs | 71.945000 | 74.730000 | 74.730000 | 0 | 0 | 70.860000–74.730000 |
| shaderFirstPrepareMs | 44.850000 | 45.085000 | 45.085000 | 0 | 0 | 44.150000–45.085000 |
| pipelineFirstPrepareMs | 8.0850000 | 9.5500000 | 9.5500000 | 0 | 0 | 7.9900000–9.5500000 |

## static-unlit-single-draw / webgpu

Pixel hash: `d0d7836c34cb6999c72c550cfcb16120f4ffcbbeb6558bbca78f4d70366b44c1`; observed draws: 2.

| Metric | Round-median median | Worst p95 | Worst p99 | Median MAD | Median CV | Bootstrap CI envelope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frameBuildCpuMs | 0.21000001 | 0.37025000 | 0.48025002 | 0.030000001 | 0.33359485 | 0.20999999–0.22000000 |
| graphCompileCpuMs | 0.019999996 | 0.040000007 | 0.054999992 | 0.0049999952 | 0.48230684 | 0.015000001–0.019999996 |
| rhiCommandCpuMs | 0.050000012 | 0.12500000 | 0.18010002 | 0.014999986 | 0.54242190 | 0.049999997–0.055000000 |
| rhiExecuteCpuMs | 0.010000005 | 0.025000006 | 0.035150011 | 0.0049999952 | 0.57760536 | 0.010000005–0.010000005 |
| rhiTotalCpuMs | 0.064999998 | 0.14525001 | 0.20520000 | 0.015000001 | 0.51044912 | 0.060000002–0.065000013 |
| rendererCpuMs | 0.31000000 | 0.57075001 | 0.78530001 | 0.049999997 | 0.38036829 | 0.30000000–0.31999999 |
| gpuFrameMs | 0 | 0 | 0 | 0 | 0 | 0–0 |
| allocationBytesPerFrame | 132544 | 133075.20 | 133111.04 | 0 | 0.00045509688 | 132544–133120 |
| rhiHotPathAllocationBytesPerFrame | 0 | 0 | 0 | 0 | 0 | 0–0 |
| rhiCommandCount | 21 | 21 | 21 | 0 | 0.043507029 | 21–21 |
| actualDrawCount | 2 | 2 | 2 | 0 | 0 | 2–2 |
| nativeStateCallCount | 26 | 26 | 26 | 0 | 0.034961493 | 26–26 |
| pipelineCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| bindGroupCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| vaoCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| framebufferCacheHitRate | 0 | 0 | 0 | 0 | 0 | 0–0 |
| heapHighWaterBytes | 61645076 | 61846204 | 61846204 | 0 | 0 | 61352796–61846204 |
| retainedHeapBytes | 21050160 | 21050320 | 21050320 | 0 | 0 | 21050044–21050320 |
| nativeBufferCreateCount | 19 | 19 | 19 | 0 | 0 | 19–19 |
| nativeTextureCreateCount | 4 | 4 | 4 | 0 | 0 | 4–4 |
| nativePipelineCreateCount | 2 | 2 | 2 | 0 | 0 | 2–2 |
| nativeBindGroupCreateCount | 1205 | 1205 | 1205 | 0 | 0 | 1205–1205 |
| nativeVaoCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeProgramCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| firstComplexFrameCpuMs | 71.245000 | 72.630000 | 72.630000 | 0 | 0 | 71.060000–72.630000 |
| shaderFirstPrepareMs | 68.085000 | 68.260000 | 68.260000 | 0 | 0 | 66.645000–68.260000 |
| pipelineFirstPrepareMs | 2.1600000 | 2.2250000 | 2.2250000 | 0 | 0 | 2.1200000–2.2250000 |

## shared-pipeline-1000-draw / webgl2

Pixel hash: `d0d7836c34cb6999c72c550cfcb16120f4ffcbbeb6558bbca78f4d70366b44c1`; observed draws: 1001.

| Metric | Round-median median | Worst p95 | Worst p99 | Median MAD | Median CV | Bootstrap CI envelope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frameBuildCpuMs | 8.5625000 | 9.9775000 | 10.770150 | 0.19500001 | 0.051597593 | 8.4575000–8.7600000 |
| graphCompileCpuMs | 0.040000007 | 0.060000002 | 0.075000003 | 0.0049999952 | 0.22857752 | 0.039999999–0.040000007 |
| rhiCommandCpuMs | 2.3100000 | 2.6500000 | 2.9102000 | 0.094999999 | 0.066605256 | 2.2875000–2.3500000 |
| rhiExecuteCpuMs | 0.099999994 | 0.13499999 | 0.18625000 | 0.0050000101 | 0.23289020 | 0.099999994–0.10499999 |
| rhiTotalCpuMs | 2.4150000 | 2.7652500 | 3.0450000 | 0.097500004 | 0.066266562 | 2.3900000–2.4550000 |
| rendererCpuMs | 11.272500 | 12.692250 | 13.621950 | 0.27500000 | 0.049659594 | 11.117500–11.435000 |
| gpuFrameMs | 2.2866660 | 4.6638889 | 5.3649437 | 0.73114550 | 0.42147883 | 1.9994370–2.5206665 |
| allocationBytesPerFrame | 3050140 | 3050409.2 | 3050424.2 | 228 | 0.0074081336 | 3002188–3050428 |
| rhiHotPathAllocationBytesPerFrame | 160 | 592.40000 | 627.28000 | 92 | 0.75815235 | 0–636 |
| rhiCommandCount | 5016 | 5016 | 5016 | 0 | 0 | 5016–5016 |
| actualDrawCount | 1001 | 1001 | 1001 | 0 | 0 | 1001–1001 |
| nativeStateCallCount | 4017 | 4017 | 4017 | 0 | 0 | 4017–4017 |
| pipelineCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| bindGroupCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| vaoCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| framebufferCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| heapHighWaterBytes | 172846433 | 173068221 | 173068221 | 0 | 0 | 157573557–173068221 |
| retainedHeapBytes | 31157128 | 31173980 | 31173980 | 0 | 0 | 31151628–31173980 |
| nativeBufferCreateCount | 1009 | 1009 | 1009 | 0 | 0 | 1009–1009 |
| nativeTextureCreateCount | 2 | 2 | 2 | 0 | 0 | 2–2 |
| nativePipelineCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeBindGroupCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeVaoCreateCount | 2 | 2 | 2 | 0 | 0 | 2–2 |
| nativeProgramCreateCount | 2 | 2 | 2 | 0 | 0 | 2–2 |
| firstComplexFrameCpuMs | 196.61500 | 197.91500 | 197.91500 | 0 | 0 | 192.32500–197.91500 |
| shaderFirstPrepareMs | 52.180000 | 52.595000 | 52.595000 | 0 | 0 | 52.025000–52.595000 |
| pipelineFirstPrepareMs | 11.285000 | 11.765000 | 11.765000 | 0 | 0 | 10.905000–11.765000 |

## shared-pipeline-1000-draw / webgpu

Pixel hash: `d0d7836c34cb6999c72c550cfcb16120f4ffcbbeb6558bbca78f4d70366b44c1`; observed draws: 1001.

| Metric | Round-median median | Worst p95 | Worst p99 | Median MAD | Median CV | Bootstrap CI envelope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frameBuildCpuMs | 8.7550000 | 10.176500 | 11.130750 | 0.18249999 | 0.058239431 | 8.5875000–8.8975000 |
| graphCompileCpuMs | 0.040000007 | 0.064999998 | 0.085050008 | 0.0050000101 | 0.24506063 | 0.039999992–0.045000002 |
| rhiCommandCpuMs | 1.3000000 | 1.6352500 | 1.8006500 | 0.055000007 | 0.090357264 | 1.2800000–1.3250000 |
| rhiExecuteCpuMs | 0.034999996 | 0.050000012 | 0.064999998 | 0.0049999952 | 0.23362335 | 0.034999996–0.035000011 |
| rhiTotalCpuMs | 1.3350000 | 1.6660000 | 1.8606000 | 0.059999995 | 0.090796572 | 1.3150000–1.3600000 |
| rendererCpuMs | 10.260000 | 12.034250 | 13.025400 | 0.23000000 | 0.060422136 | 10.095000–10.430000 |
| gpuFrameMs | 0 | 0 | 0 | 0 | 0 | 0–0 |
| allocationBytesPerFrame | 3270568 | 3276379.2 | 3276424.6 | 5312 | 0.0073436944 | 3222704–3276436 |
| rhiHotPathAllocationBytesPerFrame | 0 | 1296.0000 | 1411.2000 | 0 | 1.4142136 | 0–1440 |
| rhiCommandCount | 5016 | 5016 | 5016 | 0 | 0.00019613785 | 5016–5016 |
| actualDrawCount | 1001 | 1001 | 1001 | 0 | 0 | 1001–1001 |
| nativeStateCallCount | 7019 | 7019 | 7019 | 0 | 0.00014015979 | 7019–7019 |
| pipelineCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| bindGroupCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| vaoCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| framebufferCacheHitRate | 0 | 0 | 0 | 0 | 0 | 0–0 |
| heapHighWaterBytes | 201247744 | 206172556 | 206172556 | 0 | 0 | 198453384–206172556 |
| retainedHeapBytes | 30678336 | 30680960 | 30680960 | 0 | 0 | 30649340–30680960 |
| nativeBufferCreateCount | 1018 | 1018 | 1018 | 0 | 0 | 1018–1018 |
| nativeTextureCreateCount | 4 | 4 | 4 | 0 | 0 | 4–4 |
| nativePipelineCreateCount | 2 | 2 | 2 | 0 | 0 | 2–2 |
| nativeBindGroupCreateCount | 4202 | 4202 | 4202 | 0 | 0 | 4202–4202 |
| nativeVaoCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeProgramCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| firstComplexFrameCpuMs | 135.35000 | 135.84000 | 135.84000 | 0 | 0 | 134.49500–135.84000 |
| shaderFirstPrepareMs | 73.845000 | 74.070000 | 74.070000 | 0 | 0 | 73.090000–74.070000 |
| pipelineFirstPrepareMs | 4.7300000 | 4.8900001 | 4.8900001 | 0 | 0 | 4.6250001–4.8900001 |

## shared-pipeline-10000-draw / webgl2

Pixel hash: `d0d7836c34cb6999c72c550cfcb16120f4ffcbbeb6558bbca78f4d70366b44c1`; observed draws: 10001.

| Metric | Round-median median | Worst p95 | Worst p99 | Median MAD | Median CV | Bootstrap CI envelope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frameBuildCpuMs | 90.325000 | 108.24750 | 113.23665 | 0.55249999 | 0.034379294 | 89.030000–98.355000 |
| graphCompileCpuMs | 0.045000002 | 0.074999988 | 0.084999993 | 0.0049999952 | 0.17916106 | 0.045000002–0.054999992 |
| rhiCommandCpuMs | 14.485000 | 16.512250 | 17.297800 | 0.087499984 | 0.019539844 | 14.400000–15.775000 |
| rhiExecuteCpuMs | 0.52500001 | 0.72500001 | 0.78505001 | 0.015000001 | 0.064653251 | 0.51000001–0.61000000 |
| rhiTotalCpuMs | 15.010000 | 17.155500 | 18.082250 | 0.085000008 | 0.018977198 | 14.925000–16.380000 |
| rendererCpuMs | 106.74750 | 126.47250 | 131.83805 | 0.58749999 | 0.029967982 | 105.48500–116.21000 |
| gpuFrameMs | 22.475749 | 31.859518 | 33.504427 | 2.2619370 | 0.14700064 | 21.593750–28.197582 |
| allocationBytesPerFrame | 28237028 | 28252425 | 28253787 | 17032 | 0.0057739811 | 27499020–28254128 |
| rhiHotPathAllocationBytesPerFrame | 14204 | 14290.400 | 14298.080 | 96 | 0.70711881 | 0–14300 |
| rhiCommandCount | 50016 | 50016 | 50016 | 0 | 0 | 50016–50016 |
| actualDrawCount | 10001 | 10001 | 10001 | 0 | 0 | 10001–10001 |
| nativeStateCallCount | 40017 | 40017 | 40017 | 0 | 0 | 40017–40017 |
| pipelineCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| bindGroupCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| vaoCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| framebufferCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| heapHighWaterBytes | 559261317 | 563642286 | 563642286 | 0 | 0 | 559074581–563642286 |
| retainedHeapBytes | 118267864 | 118359492 | 118359492 | 0 | 0 | 118264776–118359492 |
| nativeBufferCreateCount | 10009 | 10009 | 10009 | 0 | 0 | 10009–10009 |
| nativeTextureCreateCount | 2 | 2 | 2 | 0 | 0 | 2–2 |
| nativePipelineCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeBindGroupCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeVaoCreateCount | 2 | 2 | 2 | 0 | 0 | 2–2 |
| nativeProgramCreateCount | 2 | 2 | 2 | 0 | 0 | 2–2 |
| firstComplexFrameCpuMs | 966.61500 | 1064.9850 | 1064.9850 | 0 | 0 | 956.54000–1064.9850 |
| shaderFirstPrepareMs | 99.600000 | 106.51000 | 106.51000 | 0 | 0 | 99.440001–106.51000 |
| pipelineFirstPrepareMs | 28.540001 | 29.990000 | 29.990000 | 0 | 0 | 27.065001–29.990000 |

## shared-pipeline-10000-draw / webgpu

Pixel hash: `d0d7836c34cb6999c72c550cfcb16120f4ffcbbeb6558bbca78f4d70366b44c1`; observed draws: 10001.

| Metric | Round-median median | Worst p95 | Worst p99 | Median MAD | Median CV | Bootstrap CI envelope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frameBuildCpuMs | 95.372500 | 108.77875 | 117.21315 | 1.4850000 | 0.038328599 | 91.055000–98.727500 |
| graphCompileCpuMs | 0.050000012 | 0.079999998 | 0.094999999 | 0.0050000101 | 0.49199689 | 0.045000002–0.059999987 |
| rhiCommandCpuMs | 11.765000 | 12.805250 | 13.035600 | 0.12000000 | 0.022595182 | 11.050000–12.100000 |
| rhiExecuteCpuMs | 0.049999997 | 0.070000008 | 0.079999998 | 0.0049999952 | 0.18574948 | 0.040000007–0.050000012 |
| rhiTotalCpuMs | 11.810000 | 12.865250 | 13.090600 | 0.12500000 | 0.022748126 | 11.100000–12.155000 |
| rendererCpuMs | 107.86500 | 123.28875 | 132.08640 | 1.5550000 | 0.035218547 | 104.25750–112.38000 |
| gpuFrameMs | 0 | 0 | 0 | 0 | 0 | 0–0 |
| allocationBytesPerFrame | 29038920 | 29070372 | 29071415 | 26188 | 0.0058399032 | 28240796–29071676 |
| rhiHotPathAllocationBytesPerFrame | 4676 | 11502.800 | 12073.040 | 116 | 0.50014011 | 0–12224 |
| rhiCommandCount | 50016 | 50016 | 50016 | 0 | 0.000018969373 | 50014–50016 |
| actualDrawCount | 10001 | 10001 | 10001 | 0 | 0 | 10001–10001 |
| nativeStateCallCount | 70019 | 70019 | 70019 | 0 | 0.000013550157 | 70017–70019 |
| pipelineCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| bindGroupCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| vaoCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| framebufferCacheHitRate | 0 | 0 | 0 | 0 | 0 | 0–0 |
| heapHighWaterBytes | 528561844 | 545196421 | 545196421 | 0 | 0 | 507577837–545196421 |
| retainedHeapBytes | 111697304 | 111705964 | 111705964 | 0 | 0 | 111691760–111705964 |
| nativeBufferCreateCount | 10018 | 10018 | 10018 | 0 | 0 | 10018–10018 |
| nativeTextureCreateCount | 4 | 4 | 4 | 0 | 0 | 4–4 |
| nativePipelineCreateCount | 2 | 2 | 2 | 0 | 0 | 2–2 |
| nativeBindGroupCreateCount | 31202 | 31202 | 31202 | 0 | 0 | 31202–31202 |
| nativeVaoCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeProgramCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| firstComplexFrameCpuMs | 496.68000 | 530.07500 | 530.07500 | 0 | 0 | 479.66000–530.07500 |
| shaderFirstPrepareMs | 115.52500 | 117.38500 | 117.38500 | 0 | 0 | 112.60500–117.38500 |
| pipelineFirstPrepareMs | 18.840000 | 19.675000 | 19.675000 | 0 | 0 | 18.255000–19.675000 |

## state-switch-2000-draw / webgl2

Pixel hash: `41ee9769f01e5f87208ef7f9a086bd1ac86ea68a349c555076a2909fdf68c5c9`; observed draws: 2001.

| Metric | Round-median median | Worst p95 | Worst p99 | Median MAD | Median CV | Bootstrap CI envelope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frameBuildCpuMs | 21.240000 | 23.246500 | 25.385450 | 0.20249999 | 0.039430073 | 20.915000–21.485000 |
| graphCompileCpuMs | 0.035000011 | 0.055000007 | 0.065049998 | 0.0049999952 | 0.20349732 | 0.034999996–0.039999992 |
| rhiCommandCpuMs | 7.4800000 | 7.9905000 | 8.7609000 | 0.099999994 | 0.032533010 | 7.2925000–7.5150000 |
| rhiExecuteCpuMs | 0.12000000 | 0.13499999 | 0.14505001 | 0.0049999952 | 0.063679158 | 0.11999999–0.12000000 |
| rhiTotalCpuMs | 7.6000000 | 8.1150000 | 8.8958000 | 0.10249999 | 0.032425125 | 7.4100000–7.6350000 |
| rendererCpuMs | 29.167500 | 31.616000 | 33.902750 | 0.27250001 | 0.034031471 | 28.652500–29.390000 |
| gpuFrameMs | 3.8252910 | 7.5656306 | 7.7379519 | 0.87937500 | 0.32629690 | 3.6107700–5.5003330 |
| allocationBytesPerFrame | 7684824 | 7750529.6 | 7756371.5 | 17436 | 0.0049717184 | 7667372–7757832 |
| rhiHotPathAllocationBytesPerFrame | 6656 | 7886 | 7986.8000 | 180 | 0.025926236 | 6416–8012 |
| rhiCommandCount | 10023 | 10023 | 10023 | 0 | 0 | 10023–10023 |
| actualDrawCount | 2001 | 2001 | 2001 | 0 | 0 | 2001–2001 |
| nativeStateCallCount | 8253 | 8253 | 8253 | 0 | 0 | 8253–8253 |
| pipelineCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| bindGroupCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| vaoCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| framebufferCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| heapHighWaterBytes | 240436044 | 269848873 | 269848873 | 0 | 0 | 168760782–269848873 |
| retainedHeapBytes | 47054916 | 47117604 | 47117604 | 0 | 0 | 47026276–47117604 |
| nativeBufferCreateCount | 2075 | 2075 | 2075 | 0 | 0 | 2075–2075 |
| nativeTextureCreateCount | 29 | 29 | 29 | 0 | 0 | 29–29 |
| nativePipelineCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeBindGroupCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeVaoCreateCount | 33 | 33 | 33 | 0 | 0 | 33–33 |
| nativeProgramCreateCount | 33 | 33 | 33 | 0 | 0 | 33–33 |
| firstComplexFrameCpuMs | 1449.3850 | 1479.5200 | 1479.5200 | 0 | 0 | 1437.1600–1479.5200 |
| shaderFirstPrepareMs | 1072.6200 | 1074.3750 | 1074.3750 | 0 | 0 | 1064.4650–1074.3750 |
| pipelineFirstPrepareMs | 128.54000 | 157.21500 | 157.21500 | 0 | 0 | 127.66500–157.21500 |

## state-switch-2000-draw / webgpu

Pixel hash: `41ee9769f01e5f87208ef7f9a086bd1ac86ea68a349c555076a2909fdf68c5c9`; observed draws: 2001.

| Metric | Round-median median | Worst p95 | Worst p99 | Median MAD | Median CV | Bootstrap CI envelope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frameBuildCpuMs | 21.225000 | 23.390250 | 27.195700 | 0.23000000 | 0.046478782 | 21.090000–21.335000 |
| graphCompileCpuMs | 0.034999996 | 0.054999992 | 0.064999998 | 0.0049999952 | 0.21598097 | 0.034999996–0.034999996 |
| rhiCommandCpuMs | 2.6400000 | 2.8910000 | 3.4452500 | 0.045000002 | 0.056360979 | 2.6300000–2.6800000 |
| rhiExecuteCpuMs | 0.030000001 | 0.045000002 | 0.054999992 | 0.0049999952 | 0.22321228 | 0.030000001–0.030000001 |
| rhiTotalCpuMs | 2.6700000 | 2.9262500 | 3.4952000 | 0.045000002 | 0.057161655 | 2.6600000–2.7100000 |
| rendererCpuMs | 24.127500 | 26.554250 | 31.021200 | 0.27999999 | 0.046508926 | 24.027500–24.257500 |
| gpuFrameMs | 0 | 0 | 0 | 0 | 0 | 0–0 |
| allocationBytesPerFrame | 8123840 | 8191042.4 | 8196938.1 | 14200 | 0.0046168766 | 8109640–8198412 |
| rhiHotPathAllocationBytesPerFrame | 6212 | 7990.4000 | 8071.6800 | 64 | 0.032177225 | 6148–8092 |
| rhiCommandCount | 10023 | 10023 | 10023 | 0 | 0.000096453012 | 10023–10023 |
| actualDrawCount | 2001 | 2001 | 2001 | 0 | 0 | 2001–2001 |
| nativeStateCallCount | 14089 | 14089 | 14089 | 0 | 0.000068615788 | 14089–14089 |
| pipelineCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| bindGroupCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| vaoCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| framebufferCacheHitRate | 0 | 0 | 0 | 0 | 0 | 0–0 |
| heapHighWaterBytes | 280325808 | 282620420 | 282620420 | 0 | 0 | 279836436–282620420 |
| retainedHeapBytes | 47485488 | 47489448 | 47489448 | 0 | 0 | 47484792–47489448 |
| nativeBufferCreateCount | 2083 | 2083 | 2083 | 0 | 0 | 2083–2083 |
| nativeTextureCreateCount | 31 | 31 | 31 | 0 | 0 | 31–31 |
| nativePipelineCreateCount | 33 | 33 | 33 | 0 | 0 | 33–33 |
| nativeBindGroupCreateCount | 7202 | 7202 | 7202 | 0 | 0 | 7202–7202 |
| nativeVaoCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeProgramCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| firstComplexFrameCpuMs | 1334.2400 | 1355.3850 | 1355.3850 | 0 | 0 | 1332.2750–1355.3850 |
| shaderFirstPrepareMs | 1211.0150 | 1220.5500 | 1220.5500 | 0 | 0 | 1209.6100–1220.5500 |
| pipelineFirstPrepareMs | 16.415000 | 16.585000 | 16.585000 | 0 | 0 | 15.650000–16.585000 |

## large-instancing / webgl2

Pixel hash: `745b9b4db82c2020e1293bd6de48eb88c78884bfbe49c104711676eeb78f2957`; observed draws: 80.

| Metric | Round-median median | Worst p95 | Worst p99 | Median MAD | Median CV | Bootstrap CI envelope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frameBuildCpuMs | 10.025000 | 11.460500 | 13.798450 | 0.26749999 | 0.083801232 | 9.8850000–10.140000 |
| graphCompileCpuMs | 0.030000001 | 0.049999997 | 0.064999998 | 0.0049999952 | 0.24599252 | 0.030000001–0.032499999 |
| rhiCommandCpuMs | 1.0150000 | 1.1350000 | 1.2103500 | 0.030000009 | 0.057887416 | 1–1.0250000 |
| rhiExecuteCpuMs | 0.090000004 | 0.10500000 | 0.12000000 | 0.0049999952 | 0.091099720 | 0.085000008–0.090000004 |
| rhiTotalCpuMs | 1.1050000 | 1.2302500 | 1.3104500 | 0.034999996 | 0.056366783 | 1.0900000–1.1150000 |
| rendererCpuMs | 12.077500 | 13.675000 | 16.377800 | 0.31750000 | 0.075000973 | 11.905000–12.200000 |
| gpuFrameMs | 6.3911865 | 8.9851597 | 11.463443 | 0.49868750 | 0.14385814 | 6.3246040–6.5129160 |
| allocationBytesPerFrame | 3234532 | 3234618.4 | 3234626.1 | 44 | 0.000018071810 | 3234488–3234628 |
| rhiHotPathAllocationBytesPerFrame | 84 | 210 | 221.20000 | 84 | 0.89995409 | 0–224 |
| rhiCommandCount | 646 | 646 | 646 | 0 | 0 | 646–646 |
| actualDrawCount | 80 | 80 | 80 | 0 | 0 | 80–80 |
| nativeStateCallCount | 726 | 726 | 726 | 0 | 0 | 726–726 |
| pipelineCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| bindGroupCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| vaoCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| framebufferCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| heapHighWaterBytes | 281293653 | 285968689 | 285968689 | 0 | 0 | 278299208–285968689 |
| retainedHeapBytes | 49311340 | 49386772 | 49386772 | 0 | 0 | 49282764–49386772 |
| nativeBufferCreateCount | 478 | 478 | 478 | 0 | 0 | 478–478 |
| nativeTextureCreateCount | 2 | 2 | 2 | 0 | 0 | 2–2 |
| nativePipelineCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeBindGroupCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeVaoCreateCount | 80 | 80 | 80 | 0 | 0 | 80–80 |
| nativeProgramCreateCount | 2 | 2 | 2 | 0 | 0 | 2–2 |
| firstComplexFrameCpuMs | 141.44500 | 141.66500 | 141.66500 | 0 | 0 | 140.71500–141.66500 |
| shaderFirstPrepareMs | 45.135000 | 45.205000 | 45.205000 | 0 | 0 | 44.800000–45.205000 |
| pipelineFirstPrepareMs | 8.5900000 | 8.9050000 | 8.9050000 | 0 | 0 | 8.0999999–8.9050000 |

## large-instancing / webgpu

Pixel hash: `745b9b4db82c2020e1293bd6de48eb88c78884bfbe49c104711676eeb78f2957`; observed draws: 80.

| Metric | Round-median median | Worst p95 | Worst p99 | Median MAD | Median CV | Bootstrap CI envelope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frameBuildCpuMs | 12.237500 | 13.375000 | 15.705300 | 0.30000000 | 0.055893058 | 12.155000–12.435000 |
| graphCompileCpuMs | 0.034999996 | 0.049999997 | 0.060050002 | 0.0049999952 | 0.24012422 | 0.030000001–0.034999996 |
| rhiCommandCpuMs | 0.30500001 | 0.40000001 | 0.46010001 | 0.025000013 | 0.14047659 | 0.29500000–0.31500001 |
| rhiExecuteCpuMs | 0.025000006 | 0.039999992 | 0.045050002 | 0.0049999952 | 0.20979704 | 0.025000006–0.030000001 |
| rhiTotalCpuMs | 0.33499999 | 0.43500000 | 0.50005000 | 0.030000001 | 0.13636757 | 0.32500000–0.34250000 |
| rendererCpuMs | 13.425000 | 14.780500 | 17.172200 | 0.34750000 | 0.057709726 | 13.370000–13.680000 |
| gpuFrameMs | 0 | 0 | 0 | 0 | 0 | 0–0 |
| allocationBytesPerFrame | 3288924 | 3289039.2 | 3289049.4 | 0 | 0.000018346120 | 3288900–3289052 |
| rhiHotPathAllocationBytesPerFrame | 0 | 0 | 0 | 0 | 0 | 0–0 |
| rhiCommandCount | 567 | 567 | 567 | 0 | 0.0014275998 | 567–567 |
| actualDrawCount | 80 | 80 | 80 | 0 | 0 | 80–80 |
| nativeStateCallCount | 806 | 806 | 806 | 0 | 0.0010040628 | 806–806 |
| pipelineCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| bindGroupCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| vaoCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| framebufferCacheHitRate | 0 | 0 | 0 | 0 | 0 | 0–0 |
| heapHighWaterBytes | 318222601 | 388620648 | 388620648 | 0 | 0 | 318113125–388620648 |
| retainedHeapBytes | 49255868 | 49257152 | 49257152 | 0 | 0 | 49255472–49257152 |
| nativeBufferCreateCount | 487 | 487 | 487 | 0 | 0 | 487–487 |
| nativeTextureCreateCount | 4 | 4 | 4 | 0 | 0 | 4–4 |
| nativePipelineCreateCount | 2 | 2 | 2 | 0 | 0 | 2–2 |
| nativeBindGroupCreateCount | 1439 | 1439 | 1439 | 0 | 0 | 1439–1439 |
| nativeVaoCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeProgramCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| firstComplexFrameCpuMs | 122.07000 | 123.65000 | 123.65000 | 0 | 0 | 121.66500–123.65000 |
| shaderFirstPrepareMs | 68.400000 | 68.460000 | 68.460000 | 0 | 0 | 67.235000–68.460000 |
| pipelineFirstPrepareMs | 2.4250000 | 2.4400000 | 2.4400000 | 0 | 0 | 2.4049999–2.4400000 |

## pbr-lights-shadows / webgl2

Pixel hash: `b925acb27f55dfdce8a2beb47bc1b4006d9041746c28a7aa7304f07ae38c0374`; observed draws: 513.

| Metric | Round-median median | Worst p95 | Worst p99 | Median MAD | Median CV | Bootstrap CI envelope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frameBuildCpuMs | 5.7800000 | 6.5012500 | 7.1001500 | 0.094999999 | 0.044527056 | 5.7175000–5.8025000 |
| graphCompileCpuMs | 0.025000006 | 0.040000007 | 0.055000007 | 0.0049999952 | 0.29051772 | 0.024999991–0.025000006 |
| rhiCommandCpuMs | 2.2050000 | 2.4052500 | 2.5652500 | 0.049999997 | 0.042154964 | 2.1800000–2.2300000 |
| rhiExecuteCpuMs | 0.079999998 | 0.090000004 | 0.10005001 | 0.0049999952 | 0.082802743 | 0.079999998–0.079999998 |
| rhiTotalCpuMs | 2.2800000 | 2.4900000 | 2.6453500 | 0.049999997 | 0.041757599 | 2.2550000–2.3075000 |
| rendererCpuMs | 8.2000000 | 9.0622500 | 9.7953000 | 0.13499999 | 0.040627401 | 8.1550000–8.2600000 |
| gpuFrameMs | 3.0371450 | 5.3857812 | 6.2037875 | 0.69025050 | 0.33314376 | 3.0107495–3.1110830 |
| allocationBytesPerFrame | 2331624 | 2338842 | 2339483.6 | 200 | 0.0016402301 | 2331400–2339644 |
| rhiHotPathAllocationBytesPerFrame | 0 | 100.80000 | 109.76000 | 0 | 1.4142136 | 0–112 |
| rhiCommandCount | 2582 | 2582 | 2582 | 0 | 0 | 2582–2582 |
| actualDrawCount | 513 | 513 | 513 | 0 | 0 | 513–513 |
| nativeStateCallCount | 2172 | 2172 | 2172 | 0 | 0 | 2172–2172 |
| pipelineCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| bindGroupCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| vaoCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| framebufferCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| heapHighWaterBytes | 147281242 | 162255351 | 162255351 | 0 | 0 | 142895304–162255351 |
| retainedHeapBytes | 30310124 | 30317560 | 30317560 | 0 | 0 | 30308352–30317560 |
| nativeBufferCreateCount | 542 | 542 | 542 | 0 | 0 | 542–542 |
| nativeTextureCreateCount | 23 | 23 | 23 | 0 | 0 | 23–23 |
| nativePipelineCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeBindGroupCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeVaoCreateCount | 11 | 11 | 11 | 0 | 0 | 11–11 |
| nativeProgramCreateCount | 11 | 11 | 11 | 0 | 0 | 11–11 |
| firstComplexFrameCpuMs | 700.70000 | 712.86500 | 712.86500 | 0 | 0 | 692.30500–712.86500 |
| shaderFirstPrepareMs | 521.84000 | 522.03500 | 522.03500 | 0 | 0 | 518.48000–522.03500 |
| pipelineFirstPrepareMs | 73.170000 | 85.895000 | 85.895000 | 0 | 0 | 72.420000–85.895000 |

## pbr-lights-shadows / webgpu

Pixel hash: `b925acb27f55dfdce8a2beb47bc1b4006d9041746c28a7aa7304f07ae38c0374`; observed draws: 513.

| Metric | Round-median median | Worst p95 | Worst p99 | Median MAD | Median CV | Bootstrap CI envelope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frameBuildCpuMs | 5.8225000 | 6.4200000 | 7.0891500 | 0.070000000 | 0.026915349 | 5.7750000–6.1050000 |
| graphCompileCpuMs | 0.024999991 | 0.039999992 | 0.049999997 | 0.0049999952 | 0.28498833 | 0.024999991–0.025000006 |
| rhiCommandCpuMs | 0.82500000 | 0.92000000 | 1.0207000 | 0.019999996 | 0.042217889 | 0.81500000–0.83500001 |
| rhiExecuteCpuMs | 0.015000001 | 0.030000001 | 0.035000011 | 0.0049999952 | 0.27009259 | 0.015000001–0.019999996 |
| rhiTotalCpuMs | 0.84500000 | 0.94000000 | 1.0605500 | 0.020000011 | 0.043595304 | 0.83000001–0.85500000 |
| rendererCpuMs | 6.7575000 | 7.4452500 | 8.2205000 | 0.092500009 | 0.028681088 | 6.7050000–7.0450000 |
| gpuFrameMs | 0 | 0 | 0 | 0 | 0 | 0–0 |
| allocationBytesPerFrame | 2448404 | 2449104.8 | 2449120.2 | 180 | 0.000070269413 | 2448164–2449124 |
| rhiHotPathAllocationBytesPerFrame | 184 | 259.60000 | 266.32000 | 84 | 0.45966624 | 72–268 |
| rhiCommandCount | 2582 | 2582 | 2582 | 0 | 0.00038462911 | 2582–2582 |
| actualDrawCount | 513 | 513 | 513 | 0 | 0 | 513–513 |
| nativeStateCallCount | 3623 | 3623 | 3623 | 0 | 0.00027408642 | 3623–3623 |
| pipelineCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| bindGroupCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| vaoCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| framebufferCacheHitRate | 0 | 0 | 0 | 0 | 0 | 0–0 |
| heapHighWaterBytes | 197088431 | 197212451 | 197212451 | 0 | 0 | 195478431–197212451 |
| retainedHeapBytes | 31517260 | 31517660 | 31517660 | 0 | 0 | 31509072–31517660 |
| nativeBufferCreateCount | 550 | 550 | 550 | 0 | 0 | 550–550 |
| nativeTextureCreateCount | 25 | 25 | 25 | 0 | 0 | 25–25 |
| nativePipelineCreateCount | 11 | 11 | 11 | 0 | 0 | 11–11 |
| nativeBindGroupCreateCount | 4277 | 4277 | 4277 | 0 | 0 | 4277–4277 |
| nativeVaoCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeProgramCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| firstComplexFrameCpuMs | 655.08000 | 656.99500 | 656.99500 | 0 | 0 | 653.15000–656.99500 |
| shaderFirstPrepareMs | 595.65500 | 595.79000 | 595.79000 | 0 | 0 | 592.97000–595.79000 |
| pipelineFirstPrepareMs | 9.1150001 | 9.2399999 | 9.2399999 | 0 | 0 | 9.0899997–9.2399999 |

## mrt-msaa-postprocess / webgl2

Pixel hash: `2cdffd0a307b27b6344c9d348f8c3d35a59f139a3b7d9917cd506f3f1238125b`; observed draws: 257.

| Metric | Round-median median | Worst p95 | Worst p99 | Median MAD | Median CV | Bootstrap CI envelope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frameBuildCpuMs | 0.76500000 | 1.0700000 | 1.3350500 | 0.029999994 | 0.21399669 | 0.75500000–0.77000001 |
| graphCompileCpuMs | 0.045000002 | 0.075000003 | 0.17675001 | 0.0049999952 | 0.69150864 | 0.040000007–0.045000002 |
| rhiCommandCpuMs | 1.1250000 | 1.3102500 | 1.5054500 | 0.030000001 | 0.056471350 | 1.1200000–1.1425000 |
| rhiExecuteCpuMs | 0.060000002 | 0.074999989 | 0.085100008 | 0.0049999952 | 0.12023188 | 0.060000002–0.060000002 |
| rhiTotalCpuMs | 1.1850000 | 1.3752500 | 1.5754500 | 0.030000001 | 0.056175520 | 1.1800000–1.2050000 |
| rendererCpuMs | 2.0800000 | 2.5650000 | 3.0200500 | 0.059999987 | 0.11071743 | 2.0650000–2.0950000 |
| gpuFrameMs | 4.5172700 | 7.8555666 | 8.7837515 | 1.1793745 | 0.33802645 | 4.3778535–4.9810830 |
| allocationBytesPerFrame | 380428 | 380636.80 | 380655.36 | 128 | 0.00037774345 | 380300–380660 |
| rhiHotPathAllocationBytesPerFrame | 0 | 0 | 0 | 0 | 0 | 0–0 |
| rhiCommandCount | 547 | 547 | 547 | 0 | 0 | 547–547 |
| actualDrawCount | 257 | 257 | 257 | 0 | 0 | 257–257 |
| nativeStateCallCount | 61 | 61 | 61 | 0 | 0 | 61–61 |
| pipelineCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| bindGroupCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| vaoCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| framebufferCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| heapHighWaterBytes | 111430272 | 111719860 | 111719860 | 0 | 0 | 110880776–111719860 |
| retainedHeapBytes | 22805440 | 22809956 | 22809956 | 0 | 0 | 22795476–22809956 |
| nativeBufferCreateCount | 4 | 4 | 4 | 0 | 0 | 4–4 |
| nativeTextureCreateCount | 8 | 8 | 8 | 0 | 0 | 8–8 |
| nativePipelineCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeBindGroupCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeVaoCreateCount | 5 | 5 | 5 | 0 | 0 | 5–5 |
| nativeProgramCreateCount | 5 | 5 | 5 | 0 | 0 | 5–5 |
| firstComplexFrameCpuMs | 45.575000 | 45.760000 | 45.760000 | 0 | 0 | 44.240000–45.760000 |
| shaderFirstPrepareMs | 7.8400000 | 8.0499998 | 8.0499998 | 0 | 0 | 7.7700002–8.0499998 |
| pipelineFirstPrepareMs | 9.8999999 | 10.815000 | 10.815000 | 0 | 0 | 9.4350001–10.815000 |

## mrt-msaa-postprocess / webgpu

Pixel hash: `2cdffd0a307b27b6344c9d348f8c3d35a59f139a3b7d9917cd506f3f1238125b`; observed draws: 257.

| Metric | Round-median median | Worst p95 | Worst p99 | Median MAD | Median CV | Bootstrap CI envelope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frameBuildCpuMs | 0.79250000 | 0.91000000 | 1.1201000 | 0.025000021 | 0.077897630 | 0.78500001–0.79999998 |
| graphCompileCpuMs | 0.040000007 | 0.060000002 | 0.069999993 | 0.0049999952 | 0.34381959 | 0.040000007–0.045000002 |
| rhiCommandCpuMs | 0.13000000 | 0.17500001 | 0.22499999 | 0.010000020 | 0.17801758 | 0.12500000–0.13499999 |
| rhiExecuteCpuMs | 0.010000005 | 0.015000001 | 0.025049991 | 0.0049999952 | 0.57177644 | 0.0099999905–0.010000005 |
| rhiTotalCpuMs | 0.14000000 | 0.19000001 | 0.23505000 | 0.015000001 | 0.18174991 | 0.13499999–0.14000000 |
| rendererCpuMs | 1 | 1.1800000 | 1.4751500 | 0.035000004 | 0.093567284 | 0.98999999–1.0100000 |
| gpuFrameMs | 0 | 0 | 0 | 0 | 0 | 0–0 |
| allocationBytesPerFrame | 384508 | 384623.20 | 384633.44 | 0 | 0.00014220101 | 384508–384636 |
| rhiHotPathAllocationBytesPerFrame | 0 | 0 | 0 | 0 | 0 | 0–0 |
| rhiCommandCount | 544 | 544 | 544 | 0 | 0.0013687789 | 544–544 |
| actualDrawCount | 257 | 257 | 257 | 0 | 0 | 257–257 |
| nativeStateCallCount | 300 | 300 | 300 | 0 | 0.0024832857 | 300–300 |
| pipelineCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| bindGroupCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| vaoCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| framebufferCacheHitRate | 0 | 0 | 0 | 0 | 0 | 0–0 |
| heapHighWaterBytes | 81494194 | 81576354 | 81576354 | 0 | 0 | 81466942–81576354 |
| retainedHeapBytes | 22663164 | 22663740 | 22663740 | 0 | 0 | 22661280–22663740 |
| nativeBufferCreateCount | 10 | 10 | 10 | 0 | 0 | 10–10 |
| nativeTextureCreateCount | 31 | 31 | 31 | 0 | 0 | 31–31 |
| nativePipelineCreateCount | 5 | 5 | 5 | 0 | 0 | 5–5 |
| nativeBindGroupCreateCount | 1205 | 1205 | 1205 | 0 | 0 | 1205–1205 |
| nativeVaoCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeProgramCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| firstComplexFrameCpuMs | 34.495000 | 34.505000 | 34.505000 | 0 | 0 | 34.400000–34.505000 |
| shaderFirstPrepareMs | 23.085000 | 23.315000 | 23.315000 | 0 | 0 | 21.780000–23.315000 |
| pipelineFirstPrepareMs | 3.2500001 | 3.3000001 | 3.3000001 | 0 | 0 | 3.2099999–3.3000001 |

## dynamic-geometry-texture-upload / webgl2

Pixel hash: `006faceeedd4279602cc4b439608fc9551838cfbd2f2c58fd2fc37a4a276496f`; observed draws: 513.

| Metric | Round-median median | Worst p95 | Worst p99 | Median MAD | Median CV | Bootstrap CI envelope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frameBuildCpuMs | 4.2050000 | 4.7450000 | 5.3360500 | 0.072499998 | 0.052703316 | 4.1800000–4.3100000 |
| graphCompileCpuMs | 0.019999996 | 0.034999996 | 0.049999997 | 0.0049999952 | 0.79125635 | 0.019999996–0.020000003 |
| rhiCommandCpuMs | 1.3750000 | 1.5250000 | 1.7351000 | 0.030000016 | 0.062362324 | 1.3650000–1.3850000 |
| rhiExecuteCpuMs | 0.075000003 | 0.090000004 | 0.10000001 | 0.0049999952 | 0.083356925 | 0.075000003–0.079999998 |
| rhiTotalCpuMs | 1.4500000 | 1.6100000 | 1.8251000 | 0.030000016 | 0.060607552 | 1.4400000–1.4600000 |
| rendererCpuMs | 5.8050000 | 6.5110000 | 7.1354500 | 0.10250000 | 0.049782776 | 5.7650000–5.9150000 |
| gpuFrameMs | 1.4684990 | 2.3200038 | 2.4534065 | 0.014000500 | 0.21963382 | 1.4651660–1.4740205 |
| allocationBytesPerFrame | 1816872 | 1824433.2 | 1825104.2 | 156 | 0.0021934772 | 1816648–1825272 |
| rhiHotPathAllocationBytesPerFrame | 0 | 151.20000 | 164.64000 | 0 | 1.4142136 | 0–168 |
| rhiCommandCount | 2578 | 2578 | 2578 | 0 | 0 | 2578–2578 |
| actualDrawCount | 513 | 513 | 513 | 0 | 0 | 513–513 |
| nativeStateCallCount | 2073 | 2073 | 2073 | 0 | 0 | 2073–2073 |
| pipelineCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| bindGroupCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| vaoCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| framebufferCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| heapHighWaterBytes | 142069178 | 157303518 | 157303518 | 0 | 0 | 140389414–157303518 |
| retainedHeapBytes | 26961472 | 26977304 | 26977304 | 0 | 0 | 26960084–26977304 |
| nativeBufferCreateCount | 524 | 524 | 524 | 0 | 0 | 524–524 |
| nativeTextureCreateCount | 2 | 2 | 2 | 0 | 0 | 2–2 |
| nativePipelineCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeBindGroupCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeVaoCreateCount | 3 | 3 | 3 | 0 | 0 | 3–3 |
| nativeProgramCreateCount | 3 | 3 | 3 | 0 | 0 | 3–3 |
| firstComplexFrameCpuMs | 170.55500 | 171.81000 | 171.81000 | 0 | 0 | 170.24000–171.81000 |
| shaderFirstPrepareMs | 80.475000 | 80.675000 | 80.675000 | 0 | 0 | 80.045000–80.675000 |
| pipelineFirstPrepareMs | 12.690000 | 13.120000 | 13.120000 | 0 | 0 | 12.540000–13.120000 |

## dynamic-geometry-texture-upload / webgpu

Pixel hash: `006faceeedd4279602cc4b439608fc9551838cfbd2f2c58fd2fc37a4a276496f`; observed draws: 513.

| Metric | Round-median median | Worst p95 | Worst p99 | Median MAD | Median CV | Bootstrap CI envelope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frameBuildCpuMs | 4.4100000 | 4.7852500 | 5.3013000 | 0.075000003 | 0.049800868 | 4.3350000–4.4300000 |
| graphCompileCpuMs | 0.019999996 | 0.035000011 | 0.045000002 | 0.0049999952 | 0.32815634 | 0.019999996–0.019999996 |
| rhiCommandCpuMs | 0.55499999 | 0.63000000 | 0.70019999 | 0.019999996 | 0.077061093 | 0.55000000–0.56000001 |
| rhiExecuteCpuMs | 0.015000001 | 0.025000006 | 0.034999996 | 0.0049999952 | 0.32937943 | 0.015000001–0.015000001 |
| rhiTotalCpuMs | 0.56999999 | 0.65500000 | 0.73024999 | 0.019999996 | 0.079412772 | 0.56500000–0.58000000 |
| rendererCpuMs | 5.0700000 | 5.5257500 | 6.1417000 | 0.094999999 | 0.053987567 | 4.9850000–5.1050000 |
| gpuFrameMs | 0 | 0 | 0 | 0 | 0 | 0–0 |
| allocationBytesPerFrame | 1929960 | 1931658 | 1931810 | 592 | 0.00028410009 | 1929212–1931848 |
| rhiHotPathAllocationBytesPerFrame | 552 | 1744 | 1827.2000 | 256 | 0.74373973 | 0–1848 |
| rhiCommandCount | 2578 | 2578 | 2578 | 0 | 0.00038351657 | 2576–2578 |
| actualDrawCount | 513 | 513 | 513 | 0 | 0 | 513–513 |
| nativeStateCallCount | 3608 | 3608 | 3608 | 0 | 0.00027400578 | 3606–3608 |
| pipelineCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| bindGroupCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| vaoCacheHitRate | 0 | 0 | 0 | 0 | 0 | 0–0 |
| framebufferCacheHitRate | 0 | 0 | 0 | 0 | 0 | 0–0 |
| heapHighWaterBytes | 188357228 | 194254800 | 194254800 | 0 | 0 | 187732728–194254800 |
| retainedHeapBytes | 26900980 | 26903984 | 26903984 | 0 | 0 | 26879372–26903984 |
| nativeBufferCreateCount | 533 | 533 | 533 | 0 | 0 | 533–533 |
| nativeTextureCreateCount | 4 | 4 | 4 | 0 | 0 | 4–4 |
| nativePipelineCreateCount | 3 | 3 | 3 | 0 | 0 | 3–3 |
| nativeBindGroupCreateCount | 2738 | 2738 | 2738 | 0 | 0 | 2738–2738 |
| nativeVaoCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeProgramCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| firstComplexFrameCpuMs | 146.28500 | 146.63500 | 146.63500 | 0 | 0 | 145.27000–146.63500 |
| shaderFirstPrepareMs | 109.41000 | 109.96000 | 109.96000 | 0 | 0 | 108.52500–109.96000 |
| pipelineFirstPrepareMs | 4.1450001 | 4.3350000 | 4.3350000 | 0 | 0 | 4.0100000–4.3350000 |

## first-complex-frame / webgl2

Pixel hash: `c4ddcf763fafb7caddc7749498bdb3190e24ecdbad78e79301694ad43fc50bab`; observed draws: 512.

| Metric | Round-median median | Worst p95 | Worst p99 | Median MAD | Median CV | Bootstrap CI envelope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frameBuildCpuMs | 8.3200000 | 8.9065000 | 9.9312000 | 0.095000029 | 0.039666291 | 8.2600000–8.3850000 |
| graphCompileCpuMs | 0.055000007 | 0.075000003 | 0.094999999 | 0.0049999952 | 0.25600763 | 0.054999992–0.060000002 |
| rhiCommandCpuMs | 29.202500 | 30.180250 | 31.040250 | 0.27750002 | 0.017391215 | 28.680000–29.267500 |
| rhiExecuteCpuMs | 0.080000006 | 0.094999999 | 0.10505000 | 0.0049999952 | 0.081326842 | 0.079999998–0.084999993 |
| rhiTotalCpuMs | 29.282500 | 30.266250 | 31.140400 | 0.28250001 | 0.017392516 | 28.765000–29.350000 |
| rendererCpuMs | 37.842500 | 39.075000 | 40.950300 | 0.30999999 | 0.017538101 | 37.350000–37.965000 |
| gpuFrameMs | 13.749166 | 14.984309 | 15.191012 | 0.51447950 | 0.070562182 | 13.698208–13.799354 |
| allocationBytesPerFrame | 2897440 | 2905860.4 | 2906608.9 | 1032 | 0.0014740921 | 2896408–2906796 |
| rhiHotPathAllocationBytesPerFrame | 660 | 8472 | 9073.6000 | 56 | 1.1585733 | 604–9224 |
| rhiCommandCount | 2916 | 2916 | 2916 | 0 | 0 | 2916–2916 |
| actualDrawCount | 512 | 512 | 512 | 0 | 0 | 512–512 |
| nativeStateCallCount | 6675 | 6675 | 6675 | 0 | 0 | 6675–6675 |
| pipelineCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| bindGroupCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| vaoCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| framebufferCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| heapHighWaterBytes | 200479925 | 227323199 | 227323199 | 0 | 0 | 157174201–227323199 |
| retainedHeapBytes | 36832268 | 36978892 | 36978892 | 0 | 0 | 36829456–36978892 |
| nativeBufferCreateCount | 649 | 649 | 649 | 0 | 0 | 649–649 |
| nativeTextureCreateCount | 30 | 30 | 30 | 0 | 0 | 30–30 |
| nativePipelineCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeBindGroupCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeVaoCreateCount | 67 | 67 | 67 | 0 | 0 | 67–67 |
| nativeProgramCreateCount | 67 | 67 | 67 | 0 | 0 | 67–67 |
| firstComplexFrameCpuMs | 4271.3200 | 4374.5500 | 4374.5500 | 0 | 0 | 4269.1000–4374.5500 |
| shaderFirstPrepareMs | 3549.6400 | 3563.1500 | 3563.1500 | 0 | 0 | 3549.0350–3563.1500 |
| pipelineFirstPrepareMs | 549.14000 | 638.75500 | 638.75500 | 0 | 0 | 548.76500–638.75500 |

## first-complex-frame / webgpu

Pixel hash: `c4ddcf763fafb7caddc7749498bdb3190e24ecdbad78e79301694ad43fc50bab`; observed draws: 512.

| Metric | Round-median median | Worst p95 | Worst p99 | Median MAD | Median CV | Bootstrap CI envelope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frameBuildCpuMs | 8.1200000 | 8.7505000 | 10.250100 | 0.12500001 | 0.041090706 | 7.9750000–8.3450000 |
| graphCompileCpuMs | 0.049999997 | 0.070000008 | 0.090000004 | 0.0049999952 | 0.32167941 | 0.049999997–0.049999997 |
| rhiCommandCpuMs | 5.2000000 | 5.3450000 | 5.5854500 | 0.040000007 | 0.016400441 | 5.1850000–5.2050000 |
| rhiExecuteCpuMs | 0.030000001 | 0.044999988 | 0.049999997 | 0.0049999952 | 0.20849541 | 0.029999986–0.030000001 |
| rhiTotalCpuMs | 5.2300000 | 5.3752500 | 5.6304000 | 0.040000007 | 0.016807093 | 5.2150000–5.2350000 |
| rendererCpuMs | 13.470000 | 14.205500 | 16.071700 | 0.15500000 | 0.030097291 | 13.325000–13.695000 |
| gpuFrameMs | 0 | 0 | 0 | 0 | 0 | 0–0 |
| allocationBytesPerFrame | 3040604 | 3044404.4 | 3044704.9 | 728 | 0.00039365485 | 3039876–3044780 |
| rhiHotPathAllocationBytesPerFrame | 3396 | 7410 | 7709.2000 | 1296 | 0.39262816 | 2100–7784 |
| rhiCommandCount | 2913 | 2913 | 2913 | 0 | 0.00032138972 | 2913–2913 |
| actualDrawCount | 512 | 512 | 512 | 0 | 0 | 512–512 |
| nativeStateCallCount | 4702 | 4702 | 4702 | 0 | 0.00019909167 | 4702–4702 |
| pipelineCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| bindGroupCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| vaoCacheHitRate | 0 | 0 | 0 | 0 | 0 | 0–0 |
| framebufferCacheHitRate | 0.40000000 | 0.40000000 | 0.40000000 | 0 | 8.7430063e-15 | 0.40000000–0.40000000 |
| heapHighWaterBytes | 211013954 | 234472099 | 234472099 | 0 | 0 | 202066462–234472099 |
| retainedHeapBytes | 47188980 | 47190784 | 47190784 | 0 | 0 | 47185168–47190784 |
| nativeBufferCreateCount | 660 | 660 | 660 | 0 | 0 | 660–660 |
| nativeTextureCreateCount | 37 | 37 | 37 | 0 | 0 | 37–37 |
| nativePipelineCreateCount | 67 | 67 | 67 | 0 | 0 | 67–67 |
| nativeBindGroupCreateCount | 1783 | 1783 | 1783 | 0 | 0 | 1783–1783 |
| nativeVaoCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeProgramCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| firstComplexFrameCpuMs | 4149.8000 | 4191.2300 | 4191.2300 | 0 | 0 | 4142.2700–4191.2300 |
| shaderFirstPrepareMs | 4056.2100 | 4090.6600 | 4090.6600 | 0 | 0 | 4044.0450–4090.6600 |
| pipelineFirstPrepareMs | 26.415000 | 27.880000 | 27.880000 | 0 | 0 | 26.055000–27.880000 |

## scene-churn-10000-frame / webgl2

Pixel hash: `d0d7836c34cb6999c72c550cfcb16120f4ffcbbeb6558bbca78f4d70366b44c1`; observed draws: 257.

| Metric | Round-median median | Worst p95 | Worst p99 | Median MAD | Median CV | Bootstrap CI envelope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frameBuildCpuMs | 7.0075000 | 7.7807500 | 8.4601500 | 0.15000002 | 0.075755224 | 6.9650000–7.0475000 |
| graphCompileCpuMs | 0.034999996 | 0.049999997 | 0.064999998 | 0.0049999952 | 0.18594100 | 0.034999996–0.035000011 |
| rhiCommandCpuMs | 22.065000 | 22.720250 | 23.458700 | 0.22500001 | 0.11951603 | 21.830000–22.192500 |
| rhiExecuteCpuMs | 0.085000008 | 0.099999994 | 0.10500000 | 0.0049999952 | 0.082180924 | 0.084999993–0.085000008 |
| rhiTotalCpuMs | 22.150000 | 22.810250 | 23.548650 | 0.22999999 | 0.11920791 | 21.915000–22.282500 |
| rendererCpuMs | 29.415000 | 30.591250 | 32.354250 | 0.34250001 | 0.10076485 | 29.150000–29.542500 |
| gpuFrameMs | 0.28087400 | 0.74016150 | 1.3673493 | 0.026021000 | 0.68474590 | 0.27150000–0.32445800 |
| allocationBytesPerFrame | 2588872 | 2592344.8 | 2592654.6 | 3228 | 0.0011189061 | 2585632–2592732 |
| rhiHotPathAllocationBytesPerFrame | 224 | 270.80000 | 274.96000 | 52 | 0.41651495 | 84–276 |
| rhiCommandCount | 2123 | 2125 | 2135 | 1 | 0.044164551 | 2123–2123 |
| actualDrawCount | 257 | 257 | 257 | 0 | 0 | 257–257 |
| nativeStateCallCount | 3375 | 3383 | 3404.0100 | 3 | 0.080291638 | 3375–3375 |
| pipelineCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| bindGroupCacheHitRate | 0.99609375 | 0.99609375 | 0.99609375 | 0 | 0 | 0.99609375–0.99609375 |
| vaoCacheHitRate | 0.99610895 | 0.99610895 | 0.99610895 | 0 | 3.3436795e-15 | 0.99610895–0.99610895 |
| framebufferCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| heapHighWaterBytes | 314655772 | 315700573 | 315700573 | 0 | 0 | 313855743–315700573 |
| retainedHeapBytes | 158297260 | 158376228 | 158376228 | 0 | 0 | 158201288–158376228 |
| nativeBufferCreateCount | 72799 | 72799 | 72799 | 0 | 0 | 72799–72799 |
| nativeTextureCreateCount | 27 | 27 | 27 | 0 | 0 | 27–27 |
| nativePipelineCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeBindGroupCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeVaoCreateCount | 10019 | 10019 | 10019 | 0 | 0 | 10019–10019 |
| nativeProgramCreateCount | 19 | 19 | 19 | 0 | 0 | 19–19 |
| firstComplexFrameCpuMs | 749.27500 | 776.24000 | 776.24000 | 0 | 0 | 745.87000–776.24000 |
| shaderFirstPrepareMs | 586.17000 | 593.12500 | 593.12500 | 0 | 0 | 583.61000–593.12500 |
| pipelineFirstPrepareMs | 85.375000 | 100.49500 | 100.49500 | 0 | 0 | 84.365000–100.49500 |

## scene-churn-10000-frame / webgpu

Pixel hash: `d0d7836c34cb6999c72c550cfcb16120f4ffcbbeb6558bbca78f4d70366b44c1`; observed draws: 257.

| Metric | Round-median median | Worst p95 | Worst p99 | Median MAD | Median CV | Bootstrap CI envelope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frameBuildCpuMs | 6.2750000 | 6.9755000 | 7.9204000 | 0.15000000 | 0.064989575 | 6.2200000–6.3950000 |
| graphCompileCpuMs | 0.030000001 | 0.045000002 | 0.060000002 | 0.0049999952 | 0.53918705 | 0.030000001–0.030000001 |
| rhiCommandCpuMs | 0.58000000 | 0.70999999 | 0.93005001 | 0.034999996 | 0.098415830 | 0.57499999–0.59500000 |
| rhiExecuteCpuMs | 0.019999996 | 0.034999996 | 0.039999992 | 0.0049999952 | 0.24973235 | 0.019999996–0.020000011 |
| rhiTotalCpuMs | 0.60000001 | 0.73500000 | 0.96510000 | 0.034999996 | 0.099479473 | 0.59500000–0.61499999 |
| rendererCpuMs | 7.0100000 | 7.8410000 | 9.1506500 | 0.19000001 | 0.064412262 | 6.9350000–7.1500000 |
| gpuFrameMs | 0 | 0 | 0 | 0 | 0 | 0–0 |
| allocationBytesPerFrame | 2917696 | 2973328 | 2978272 | 61812 | 0.020498784 | 2832716–2979508 |
| rhiHotPathAllocationBytesPerFrame | 0 | 0 | 0 | 0 | 0 | 0–0 |
| rhiCommandCount | 2121 | 2124 | 2133.0100 | 2 | 0.044206217 | 2120–2121 |
| actualDrawCount | 257 | 257 | 257 | 0 | 0 | 257–257 |
| nativeStateCallCount | 3712 | 3716 | 3718 | 2 | 0.062544469 | 3712–3712 |
| pipelineCacheHitRate | 1 | 1 | 1 | 0 | 0 | 1–1 |
| bindGroupCacheHitRate | 0.99609375 | 0.99609375 | 0.99609375 | 0 | 0 | 0.99609375–0.99609375 |
| vaoCacheHitRate | 0.98823529 | 0.98823529 | 0.98823529 | 0 | 0.15035600 | 0.98823529–0.98823529 |
| framebufferCacheHitRate | 0 | 0 | 0 | 0 | 0 | 0–0 |
| heapHighWaterBytes | 375622076 | 383446852 | 383446852 | 0 | 0 | 334490274–383446852 |
| retainedHeapBytes | 158016160 | 158016664 | 158016664 | 0 | 0 | 158014552–158016664 |
| nativeBufferCreateCount | 72807 | 72807 | 72807 | 0 | 0 | 72807–72807 |
| nativeTextureCreateCount | 29 | 29 | 29 | 0 | 0 | 29–29 |
| nativePipelineCreateCount | 19 | 19 | 19 | 0 | 0 | 19–19 |
| nativeBindGroupCreateCount | 40762 | 40762 | 40762 | 0 | 0 | 40762–40762 |
| nativeVaoCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| nativeProgramCreateCount | 0 | 0 | 0 | 0 | 0 | 0–0 |
| firstComplexFrameCpuMs | 730.83000 | 732.31500 | 732.31500 | 0 | 0 | 724.15000–732.31500 |
| shaderFirstPrepareMs | 685.35000 | 687.01500 | 687.01500 | 0 | 0 | 682.17500–687.01500 |
| pipelineFirstPrepareMs | 9.4100000 | 9.8550001 | 9.8550001 | 0 | 0 | 9.1650001–9.8550001 |

