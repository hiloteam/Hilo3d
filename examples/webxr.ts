// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

renderer.useVao = true;
    // renderer.clearColor = new Hilo3d.Color(0, 0, 0, 0);

    function rand(min, max) {
      return Math.random() * (max - min) + min;
    }

    function randArr(arr) {
      return arr[Math.floor(Math.random() * arr.length)];
    }

    const container = new Hilo3d.Node();
    stage.addChild(container);
    var loader = new Hilo3d.BasicLoader();
    loader.load({
      src: '//gw.alicdn.com/tfs/TB1T1wEizTpK1RjSZKPXXa3UpXa-512-512.png',
      crossOrigin: 'anonymous',
      useInstanced: true
    }).then(function (image) {
      return new Hilo3d.Texture({ image: image });
    }, function (err) {
      return new Hilo3d.Color(1, 0, 0);
    }).then(function (diffuse) {
      var textureMaterial = new Hilo3d.BasicMaterial({
        diffuse: diffuse,
        side: Hilo3d.constants.FRONT_AND_BACK
      });
      var colorMaterial = new Hilo3d.BasicMaterial({
        diffuse: new Hilo3d.Color(0.3, 0.6, 0.9),
        side: Hilo3d.constants.FRONT_AND_BACK
      });
      var planeGeometry = new Hilo3d.PlaneGeometry();
      var sphereGeometry = new Hilo3d.SphereGeometry({
        radius: 0.3
      });
      var boxGeometry = new Hilo3d.BoxGeometry({
        width: 0.3,
        height: 0.3,
        depth: 0.3
      });
      boxGeometry.setAllRectUV([[0, 1], [1, 1], [1, 0], [0, 0]]);

      var geometryes = [planeGeometry, sphereGeometry, boxGeometry];
      var materials = [colorMaterial, textureMaterial];

      for (var i = 0; i < 100; i++) {
        let r = 1;
        var rect = new Hilo3d.Mesh({
          frustumTest: true,
          geometry: randArr(geometryes),
          material: randArr(materials),
          x: rand(-r * 2, r * 2),
          y: rand(-r * 2, r * 2),
          z: rand(-r * 2, r * 2)
        });
        rect.rotationX = Math.random() * 360;
        rect.rotationY = Math.random() * 360;
        rect.rotationZ = Math.random() * 360;
        rect.setScale(rand(0.2, 0.3));
        rect.onUpdate = function () {
          if (this !== xrSelectedInfo.mesh) {
            this.rotationX += 0.5;
            this.rotationY += 0.5;
            this.rotationZ += 0.5;
          }
        };
        container.addChild(rect);
      }
    });


    async function initXR() {
      const supported = await navigator.xr.isSessionSupported('immersive-ar');
      if (supported) {
        var enterXrBtn = document.createElement("button");
        enterXrBtn.innerHTML = "Enter AR";
        enterXrBtn.style.cssText = "position: absolute; bottom: 10px; left: 50%; z-index: 9999;";
        enterXrBtn.addEventListener("click", beginXRSession);
        document.body.appendChild(enterXrBtn);
      } else {
        console.log("Session not supported: " + reason);
      }
    }

    let xrSession = null;
    let xrReferenceSpace = null;
    const xrSelectedInfo = {
      started: false,
      mesh: null,
      meshPos: null,
      point: null,
      distance: 0,
    };
    async function beginXRSession() {
      xrSession = await navigator.xr.requestSession('immersive-ar');
      xrSession.addEventListener('end', () => {
        xrSession = null;
        camera.updateProjectionMatrix();
        camera.position.set(0, 0, 3);
        renderer.clearColor.set(0.3, 0.35, 0.35, 1);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, renderer.width, renderer.height);
        onXRFrame(0);
      });
      xrSession.addEventListener('selectstart', (evt) => {
        updateHandLine(evt.frame);
        const hitInfo = hitTest()?.[0];
        if (!hitInfo) {
          return;
        }
        xrSelectedInfo.started = true;
        xrSelectedInfo.mesh = hitInfo.mesh;
        xrSelectedInfo.meshPos = hitInfo.mesh.worldMatrix.getTranslation();
        xrSelectedInfo.point = hitInfo.point;
        xrSelectedInfo.distance = hitInfo.distance;
        console.log('hit', hitInfo.mesh.id, hitInfo.point.toArray().join(','), xrSelectedInfo);
      });
      xrSession.addEventListener('selectend', () => {
        xrSelectedInfo.started = false;
        xrSelectedInfo.mesh = null;
        console.log('selectend');
      });

      xrSession.addEventListener('inputsourceschange', (evt) => {
        // drawHandLine(evt.frame);
      });

      xrReferenceSpace = await xrSession.requestReferenceSpace('local');
      await renderer.gl.makeXRCompatible();

      const xrWebGLBaseLayer = new XRWebGLLayer(xrSession, renderer.gl);

      xrSession.updateRenderState({
        baseLayer: xrWebGLBaseLayer,
      });
      xrSession.requestAnimationFrame(onXRFrame);
    }

    const line = new Hilo3d.Mesh({
      geometry: new Hilo3d.Geometry({
        mode: Hilo3d.constants.LINES,
        vertices: new Hilo3d.GeometryData(new Float32Array([
          0, 0, 0,
          0, 0, -10
        ]), 3),
        colors: new Hilo3d.GeometryData(new Float32Array([
          1, 0, 0, 1,
          1, 0, 0, 1
        ]), 4),
      }),
      material: new Hilo3d.BasicMaterial({
        lightType: 'NONE',
        side: Hilo3d.constants.FRONT_AND_BACK
      })
    });
    const lineContainer = new Hilo3d.Node();
    lineContainer.addChild(line);
    stage.addChild(lineContainer);

    function updateHandLine(frame) {
      const inputSource = frame.session.inputSources[0];
      let targetRayPose = frame.getPose(inputSource.targetRaySpace, xrReferenceSpace);
      if (!targetRayPose) {
        return;
      }
      // console.log('inputSource', targetRayPose.transform.matrix.join(','));
      lineContainer.matrix.fromArray(targetRayPose.transform.matrix);
      lineContainer.matrix.mul(stage.matrix.clone().invert(), lineContainer.matrix);
      
      if (xrSelectedInfo.started) {
        const newPoint = new Hilo3d.Vector3(0, 0, -xrSelectedInfo.distance);
        newPoint.transformMat4(lineContainer.worldMatrix);
        newPoint.sub(xrSelectedInfo.point);
        const newWorldPos = xrSelectedInfo.meshPos.clone().add(newPoint);
        newWorldPos.transformMat4(xrSelectedInfo.mesh.parent.worldMatrix.clone().invert());
        xrSelectedInfo.mesh.position.copy(newWorldPos);
        line.setScale(1, 1, xrSelectedInfo.distance / 10);
      } else {
        hitTest();
      }
    }

    // alert(1);
    const ray = new Hilo3d.Ray();
    function hitTest() {
      ray.origin.set(0, 0, 0);
      ray.direction.set(0, 0, -1);
      lineContainer.updateMatrixWorld();
      ray.transformMat4(lineContainer.worldMatrix);
      const hitTestStartTime = Date.now();
      var hitResult = container.raycast(ray);
      hitResult?.forEach(hitInfo => {
        hitInfo.distance = ray.distance(hitInfo.point);
      });
      hitResult?.sort((a, b) => a.distance - b.distance);
      // console.log('hitTest', Date.now() - hitTestStartTime);
      if (!xrSelectedInfo.started) {
        if (hitResult && hitResult.length) {
          line.setScale(1, 1, hitResult[0].distance / 10);
        } else {
          line.setScale(1, 1, 1);
        }
      }
      return hitResult;
    }

    let lastTS = 0;
    function onXRFrame(ts, xrFrame) {
      const gl = renderer.gl;
      if (xrSession && xrFrame) {
        renderer.clearColor.set(0, 0, 0, 0);
        updateHandLine(xrFrame);
        let glLayer = xrSession.renderState.baseLayer;
        gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
        let pose = xrFrame.getViewerPose(xrReferenceSpace);
        if (pose) {
          for (let i = 0; i < 2; i++) {
            const view = pose.views[i];
            if (!view) {
              continue;
            }
            let viewport = glLayer.getViewport(view);
            // console.log('viewport', [viewport.x, viewport.y, viewport.width, viewport.height].join(','));
            gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);

            camera.matrix.fromArray(view.transform.matrix);
            camera.projectionMatrix.fromArray(view.projectionMatrix);
            camera.updateMatrixWorld();
            camera.updateViewProjectionMatrix();

            if (i === 0) {
              stage.tick(ts - lastTS);
            } else {
              renderer.renderScene();
            }
          }
        }
      } else if (gl) {
        stage.tick(ts - lastTS);
      }

      lastTS = ts;

      if (xrSession && xrFrame) {
        xrSession.requestAnimationFrame(onXRFrame);
      } else {
        requestAnimationFrame(onXRFrame);
      }
    }

    ticker.removeTick(stage);
    renderer.initContext();
    requestAnimationFrame(onXRFrame);

    initXR();
