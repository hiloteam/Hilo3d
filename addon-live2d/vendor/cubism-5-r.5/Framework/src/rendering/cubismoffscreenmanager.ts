/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { updateSize } from '../utils/cubismarrayutils';
import { CubismLogError } from '../utils/cubismdebug';
import { CubismRenderTarget_WebGL } from './cubismrendertarget_webgl';

/**
 * フレームバッファなどのコンテナのクラス
 */
class CubismRenderTargetContainer {
  /**
   * Constructor
   *
   * @param colorBuffer カラーバッファ
   * @param renderTexture レンダーテクスチャ
   * @param inUse 使用中かどうか
   */
  public constructor(
    colorBuffer: WebGLTexture = null,
    renderTexture: WebGLFramebuffer = null,
    inUse: boolean = false
  ) {
    this.colorBuffer = colorBuffer;
    this.renderTexture = renderTexture;
    this.inUse = inUse;
  }

  public clear(): void {
    this.colorBuffer = null;
    this.renderTexture = null;
    this.inUse = false;
  }

  /**
   * カラーバッファを取得
   *
   * @returns カラーバッファ
   */
  public getColorBuffer(): WebGLTexture {
    return this.colorBuffer;
  }

  /**
   * レンダーテクスチャを取得
   *
   * @returns レンダーテクスチャ
   */
  public getRenderTexture(): WebGLFramebuffer {
    return this.renderTexture;
  }

  public colorBuffer: WebGLTexture; // colorBuffer
  public renderTexture: WebGLFramebuffer; // renderTarget
  public inUse: boolean; // Whether this container's render target is currently in use
}

/**
 * WebGLContextごとのリソース管理を行う内部クラス
 */
class CubismWebGLContextManager {
  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.gl = gl;
    this.offscreenRenderTargetContainers =
      new Array<CubismRenderTargetContainer>();
    this.previousActiveRenderTextureMaxCount = 0;
    this.currentActiveRenderTextureCount = 0;
    this.hasResetThisFrame = false;
    this.width = 0;
    this.height = 0;
  }

  public release(): void {
    if (this.offscreenRenderTargetContainers != null) {
      for (
        let index = 0;
        index < this.offscreenRenderTargetContainers.length;
        ++index
      ) {
        const container = this.offscreenRenderTargetContainers[index];
        this.gl.deleteTexture(container.colorBuffer);
        this.gl.deleteFramebuffer(container.renderTexture);
      }
      this.offscreenRenderTargetContainers.length = 0;
      this.offscreenRenderTargetContainers = null;
    }
  }

  public gl: WebGLRenderingContext | WebGL2RenderingContext; // WebGLContext
  public offscreenRenderTargetContainers: Array<CubismRenderTargetContainer>; // オフスクリーン描画用レンダーターゲットのリスト
  public previousActiveRenderTextureMaxCount: number; // 直前のアクティブなレンダーターゲットの最大数
  public currentActiveRenderTextureCount: number; // 現在のアクティブなレンダーターゲットの数
  public hasResetThisFrame: boolean; // 今フレームでリセットされたかどうか
  public width: number; // 幅
  public height: number; // 高さ
}

/**
 * WebGL用オフスクリーン描画機能を管理するマネージャ
 * オフスクリーン描画機能に必要なフレームバッファなどを含むコンテナを管理する。
 * 複数のWebGLContextに対応。
 */
export class CubismWebGLOffscreenManager {
  /**
   * コンストラクタ
   */
  private constructor() {
    this._contextManagers = new Map<
      WebGLRenderingContext | WebGL2RenderingContext,
      CubismWebGLContextManager
    >();
  }

  /**
   * デストラクタ相当の処理
   */
  public release(): void {
    if (this._contextManagers != null) {
      for (const manager of this._contextManagers.values()) {
        manager.release();
      }
      this._contextManagers.clear();
      this._contextManagers = null;
    }
    CubismWebGLOffscreenManager._instance = null;
  }

  /**
   * インスタンスの取得
   *
   * @return インスタンス
   */
  public static getInstance(): CubismWebGLOffscreenManager {
    if (this._instance == null) {
      this._instance = new CubismWebGLOffscreenManager();
    }

    return this._instance;
  }

  /**
   * WebGLContextに対応するマネージャーを取得または作成
   *
   * @param gl WebGLRenderingContextまたはWebGL2RenderingContext
   * @return WebGLContextManager
   */
  private getContextManager(
    gl: WebGLRenderingContext | WebGL2RenderingContext
  ): CubismWebGLContextManager {
    if (!this._contextManagers.has(gl)) {
      this._contextManagers.set(gl, new CubismWebGLContextManager(gl));
    }
    return this._contextManagers.get(gl);
  }

  /**
   * 指定されたWebGLContextのマネージャーを削除
   *
   * @param gl WebGLRenderingContextまたはWebGL2RenderingContext
   */
  public removeContext(
    gl: WebGLRenderingContext | WebGL2RenderingContext
  ): void {
    if (this._contextManagers.has(gl)) {
      const manager = this._contextManagers.get(gl);
      manager.release();
      this._contextManagers.delete(gl);
    }
  }

  /**
   * 初期化処理
   *
   * @param gl WebGLRenderingContextまたはWebGL2RenderingContext
   * @param width 幅
   * @param height 高さ
   */
  public initialize(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    width: number,
    height: number
  ): void {
    const contextManager = this.getContextManager(gl);

    // initialize offscreenRenderTargetContainers
    if (contextManager.offscreenRenderTargetContainers != null) {
      for (
        let index = 0;
        index < contextManager.offscreenRenderTargetContainers.length;
        ++index
      ) {
        const container = contextManager.offscreenRenderTargetContainers[index];
        contextManager.gl.deleteTexture(container.colorBuffer);
        contextManager.gl.deleteFramebuffer(container.renderTexture);
        container.clear();
      }
      contextManager.offscreenRenderTargetContainers.length = 0;
    } else {
      contextManager.offscreenRenderTargetContainers =
        new Array<CubismRenderTargetContainer>();
    }

    contextManager.width = width;
    contextManager.height = height;
    contextManager.previousActiveRenderTextureMaxCount = 0;
    contextManager.currentActiveRenderTextureCount = 0;
    contextManager.hasResetThisFrame = false;
  }

  /**
   * モデルを描画する前に呼び出すフレーム開始時の処理を行う
   *
   * @param gl WebGLRenderingContextまたはWebGL2RenderingContext
   */
  public beginFrameProcess(
    gl: WebGLRenderingContext | WebGL2RenderingContext
  ): void {
    const contextManager = this.getContextManager(gl);
    if (contextManager.hasResetThisFrame) {
      return;
    }
    contextManager.previousActiveRenderTextureMaxCount = 0;
    contextManager.hasResetThisFrame = true;
  }

  /**
   * モデルの描画が終わった後に呼び出すフレーム終了時の処理
   *
   * @param gl WebGLRenderingContextまたはWebGL2RenderingContext
   */
  public endFrameProcess(
    gl: WebGLRenderingContext | WebGL2RenderingContext
  ): void {
    const contextManager = this.getContextManager(gl);
    contextManager.hasResetThisFrame = false;
  }

  /**
   * コンテナサイズの取得
   *
   * @param gl WebGLRenderingContextまたはWebGL2RenderingContext
   */
  public getContainerSize(
    gl: WebGLRenderingContext | WebGL2RenderingContext
  ): number {
    const contextManager = this.getContextManager(gl);
    if (contextManager.offscreenRenderTargetContainers == null) {
      return 0;
    }
    return contextManager.offscreenRenderTargetContainers.length;
  }

  /**
   * 使用可能なリソースコンテナの取得
   *
   * @param gl WebGLRenderingContextまたはWebGL2RenderingContext
   * @param width 幅
   * @param height 高さ
   * @param previousFramebuffer 前のフレームバッファ
   * @return 使用可能なリソースコンテナ
   */
  public getOffscreenRenderTargetContainers(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    width: number,
    height: number,
    previousFramebuffer: WebGLFramebuffer
  ): CubismRenderTargetContainer {
    const contextManager = this.getContextManager(gl);

    // コンテナが初期化されていないか、サイズが変わったら初期化し直す
    if (
      contextManager.width != width ||
      contextManager.height != height ||
      contextManager.offscreenRenderTargetContainers == null
    ) {
      this.initialize(gl, width, height);
    }

    // 使用数を更新
    this.updateRenderTargetContainerCount(gl);

    // 使われていないリソースコンテナがあればそれを返す
    const container = this.getUnusedOffscreenRenderTargetContainer(gl);
    if (container != null) {
      return container;
    }

    // 使われていないリソースコンテナがなければ新たに作成する
    const offscreenRenderTextureContainer =
      this.createOffscreenRenderTargetContainer(
        gl,
        width,
        height,
        previousFramebuffer
      );

    return offscreenRenderTextureContainer;
  }

  /**
   * リソースコンテナの使用状態を取得
   *
   * @param gl WebGLRenderingContextまたはWebGL2RenderingContext
   * @param renderTexture WebGLFramebuffer
   * @return 使用中はtrue、未使用の場合はfalse
   */
  public getUsingRenderTextureState(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    renderTexture: WebGLFramebuffer
  ): boolean {
    const contextManager = this.getContextManager(gl);
    for (
      let index = 0;
      index < contextManager.offscreenRenderTargetContainers.length;
      ++index
    ) {
      if (
        contextManager.offscreenRenderTargetContainers[index].renderTexture ==
        renderTexture
      ) {
        return contextManager.offscreenRenderTargetContainers[index].inUse;
      }
    }
    return true;
  }

  /**
   * リソースコンテナの使用を開始する。
   *
   * @param gl WebGLRenderingContextまたはWebGL2RenderingContext
   * @param renderTexture WebGLFramebuffer
   */
  public startUsingRenderTexture(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    renderTexture: WebGLFramebuffer
  ): void {
    const contextManager = this.getContextManager(gl);
    for (
      let index = 0;
      index < contextManager.offscreenRenderTargetContainers.length;
      ++index
    ) {
      if (
        contextManager.offscreenRenderTargetContainers[index].renderTexture !=
        renderTexture
      ) {
        continue;
      }

      contextManager.offscreenRenderTargetContainers[index].inUse = true;

      this.updateRenderTargetContainerCount(gl);

      break;
    }
  }

  /**
   * リソースコンテナの使用を終了する。
   *
   * @param gl WebGLRenderingContextまたはWebGL2RenderingContext
   * @param renderTexture WebGLFramebuffer
   */
  public stopUsingRenderTexture(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    renderTexture: WebGLFramebuffer
  ): void {
    const contextManager = this.getContextManager(gl);
    for (
      let index = 0;
      index < contextManager.offscreenRenderTargetContainers.length;
      ++index
    ) {
      if (
        contextManager.offscreenRenderTargetContainers[index].renderTexture !=
        renderTexture
      ) {
        continue;
      }

      contextManager.offscreenRenderTargetContainers[index].inUse = false;

      contextManager.currentActiveRenderTextureCount--;
      if (contextManager.currentActiveRenderTextureCount < 0) {
        contextManager.currentActiveRenderTextureCount = 0;
      }
      break;
    }
  }

  /**
   * リソースコンテナの使用を全て終了する。
   *
   * @param gl WebGLRenderingContextまたはWebGL2RenderingContext
   */
  public stopUsingAllRenderTextures(
    gl: WebGLRenderingContext | WebGL2RenderingContext
  ): void {
    const contextManager = this.getContextManager(gl);
    for (
      let index = 0;
      index < contextManager.offscreenRenderTargetContainers.length;
      ++index
    ) {
      contextManager.offscreenRenderTargetContainers[index].inUse = false;
    }

    contextManager.currentActiveRenderTextureCount = 0;
  }

  /**
   * 使用されていないリソースコンテナを解放する。
   *
   * @param gl WebGLRenderingContextまたはWebGL2RenderingContext
   */
  public releaseStaleRenderTextures(
    gl: WebGLRenderingContext | WebGL2RenderingContext
  ): void {
    const contextManager = this.getContextManager(gl);
    const listSize = contextManager.offscreenRenderTargetContainers.length;

    if (contextManager.hasResetThisFrame || listSize === 0) {
      // 使用する量が変化する場合は開放しない
      return;
    }

    // 未使用な場所を開放して直前の最大数までリサイズする
    let findPos = 0;
    let resize = contextManager.previousActiveRenderTextureMaxCount;
    for (
      let i = listSize;
      contextManager.previousActiveRenderTextureMaxCount < i;
      --i
    ) {
      const index = i - 1;
      if (contextManager.offscreenRenderTargetContainers[index].inUse) {
        // 空いている場所探して移動させる
        let isFind = false;
        for (
          ;
          findPos < contextManager.previousActiveRenderTextureMaxCount;
          ++findPos
        ) {
          if (!contextManager.offscreenRenderTargetContainers[findPos].inUse) {
            const tempContainer =
              contextManager.offscreenRenderTargetContainers[findPos];
            contextManager.offscreenRenderTargetContainers[findPos] =
              contextManager.offscreenRenderTargetContainers[index];
            contextManager.offscreenRenderTargetContainers[findPos].inUse =
              true;
            contextManager.offscreenRenderTargetContainers[index] =
              tempContainer;
            contextManager.offscreenRenderTargetContainers[index].inUse = false;
            isFind = true;
            break;
          }
        }
        if (!isFind) {
          // 空いている場所が見つからなかったら現状のサイズでリサイズする
          resize = i;
          break;
        }
      }
      const container = contextManager.offscreenRenderTargetContainers[index];
      contextManager.gl.bindTexture(contextManager.gl.TEXTURE_2D, null);
      contextManager.gl.deleteTexture(container.colorBuffer);
      contextManager.gl.bindFramebuffer(contextManager.gl.FRAMEBUFFER, null);
      contextManager.gl.deleteFramebuffer(container.renderTexture);
      container.clear();
    }
    updateSize(contextManager.offscreenRenderTargetContainers, resize);
  }

  /**
   * 直前のアクティブなレンダーターゲットの最大数を取得
   *
   * @param gl WebGLRenderingContextまたはWebGL2RenderingContext
   * @returns 直前のアクティブなレンダーターゲットの最大数
   */
  public getPreviousActiveRenderTextureCount(
    gl: WebGLRenderingContext | WebGL2RenderingContext
  ): number {
    const contextManager = this.getContextManager(gl);
    return contextManager.previousActiveRenderTextureMaxCount;
  }

  /**
   * 現在のアクティブなレンダーターゲットの数を取得
   *
   * @param gl WebGLRenderingContextまたはWebGL2RenderingContext
   * @returns 現在のアクティブなレンダーターゲットの数
   */
  public getCurrentActiveRenderTextureCount(
    gl: WebGLRenderingContext | WebGL2RenderingContext
  ): number {
    const contextManager = this.getContextManager(gl);
    return contextManager.currentActiveRenderTextureCount;
  }

  /**
   * 現在のアクティブなレンダーターゲットの数を更新
   *
   * @param gl WebGLRenderingContextまたはWebGL2RenderingContext
   */
  public updateRenderTargetContainerCount(
    gl: WebGLRenderingContext | WebGL2RenderingContext
  ): void {
    const contextManager = this.getContextManager(gl);
    ++contextManager.currentActiveRenderTextureCount;

    // 最大数更新
    contextManager.previousActiveRenderTextureMaxCount =
      contextManager.currentActiveRenderTextureCount >
      contextManager.previousActiveRenderTextureMaxCount
        ? contextManager.currentActiveRenderTextureCount
        : contextManager.previousActiveRenderTextureMaxCount;
  }

  /**
   * 使用されていないリソースコンテナの取得
   *
   * @param gl WebGLRenderingContextまたはWebGL2RenderingContext
   * @return 使用されていないリソースコンテナ
   */
  public getUnusedOffscreenRenderTargetContainer(
    gl: WebGLRenderingContext | WebGL2RenderingContext
  ): CubismRenderTargetContainer {
    const contextManager = this.getContextManager(gl);
    // 使われていないリソースコンテナがあればそれを返す
    for (
      let index = 0;
      index < contextManager.offscreenRenderTargetContainers.length;
      ++index
    ) {
      const container = contextManager.offscreenRenderTargetContainers[index];
      if (container.inUse == false) {
        container.inUse = true;
        return container;
      }
    }
    return null;
  }

  /**
   * 新たにリソースコンテナを作成する。
   *
   * @param gl WebGLRenderingContextまたはWebGL2RenderingContext
   * @param width 幅
   * @param height 高さ
   * @param previousFramebuffer 前のフレームバッファ
   * @return 作成されたリソースコンテナ
   */
  public createOffscreenRenderTargetContainer(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    width: number,
    height: number,
    previousFramebuffer: WebGLFramebuffer
  ): CubismRenderTargetContainer {
    const renderTarget = new CubismRenderTarget_WebGL();

    if (
      !renderTarget.createRenderTarget(gl, width, height, previousFramebuffer)
    ) {
      CubismLogError('Failed to create offscreen render texture.');
      return null;
    }

    const offscreenRenderTextureContainer = new CubismRenderTargetContainer(
      renderTarget.getColorBuffer(),
      renderTarget.getRenderTexture(),
      true
    );

    const contextManager = this.getContextManager(gl);
    contextManager.offscreenRenderTargetContainers.push(
      offscreenRenderTextureContainer
    );

    return offscreenRenderTextureContainer;
  }

  private static _instance: CubismWebGLOffscreenManager; // オフスクリーン描画用レンダーターゲットマネージャ
  private _contextManagers: Map<
    WebGLRenderingContext | WebGL2RenderingContext,
    CubismWebGLContextManager
  >; // WebGLContextごとのマネージャー
}
