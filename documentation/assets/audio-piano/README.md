# NOCTURNE showcase captures

These reviewed documentation images were captured from the working piano example on 2026-10-05. They
are screenshots of repository code, with no compositing or generated-image treatment.

| Image                                | View                                                      |
| ------------------------------------ | --------------------------------------------------------- |
| [idle.png](./idle.png)               | Silent instrument, 1280 × 800 viewport.                   |
| [performance.png](./performance.png) | Default Call of Silence performance, 1280 × 800 viewport. |
| [mobile.png](./mobile.png)           | The same performance in a 390 × 844 narrow viewport.      |

The browser used native Apple Metal WebGPU, with a non-fallback adapter and production 1.5× scene
sampling. Captures used `?backend=webgpu&test=1&quality=production` and the shared stable-capture
helper after real render submissions. The page resumed after capture; input and final resource
teardown were also checked. The narrow image verifies responsive layout on the desktop browser, not
performance on a physical phone.

These images are documentation assets, not automated visual-test baselines or screenshots of the
external artistic reference. The source arrangement and its provenance are recorded in
[the score directory](../../../examples/audio/README.md).
