// @ts-nocheck -- example entry intentionally exercises dynamic engine APIs

Hilo3d.extensions.use('WEBGL_depth_texture');
        var boxGeometry = new Hilo3d.BoxGeometry();
        boxGeometry.setAllRectUV([[0, 1], [1, 1], [1, 0], [0, 0]]);
        var material = new Hilo3d.BasicMaterial({
          lightType: 'NONE',
        });

        var depthNode = new Hilo3d.Node({
          onUpdate: function() {
            this.rotationY += 0.5;
            this.rotationX += 0.5;
          }
        });
        for(let i = 0;i < 20;i ++) {
          depthNode.addChild(new Hilo3d.Mesh({
            material: material,
            geometry: boxGeometry,
            x: (Math.random() * 2 - 1) * 5,
            y: (Math.random() * 2 - 1) * 5,
            z: (Math.random() * 2 - 1) * 5,
            rotationX: Math.random() * 360,
            rotationY: Math.random() * 360,
            rotationZ: Math.random() * 360,
            onUpdate: function() {
              this.rotationY += 0.5;
              this.rotationX += 0.5;
            }
          })).setScale(.1);
        };

        stage.onUpdate = function() {
          framebuffer.bind();
          depthNode.onUpdate();
          stage.renderer.render(depthNode, camera);
          framebuffer.unbind();
        }

        var framebuffer = new Hilo3d.Framebuffer(renderer, {
          colorAttachmentInfos: [],
          depthStencilAttachmentInfo: {
            attachmentType: Hilo3d.Framebuffer.ATTACHMENT_TYPE_TEXTURE,
            attachment: Hilo3d.constants.DEPTH_ATTACHMENT,
            format: Hilo3d.constants.DEPTH_COMPONENT,
            internalFormat: Hilo3d.constants.DEPTH_COMPONENT16,
            type: Hilo3d.constants.UNSIGNED_SHORT,
          }
        });

        renderer.on('afterRender', () => {
          framebuffer.render(0, 0, 1, 1, null, framebuffer.depthStencilAttachmentInfo.texture);
        })
