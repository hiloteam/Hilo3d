/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { CubismMath } from '../math/cubismmath';
import { CubismModel, NoParentIndex } from '../model/cubismmodel';
import { csmRect } from '../type/csmrectf';
import { CubismLogError } from '../utils/cubismdebug';
import { updateSize } from '../utils/cubismarrayutils';
import { CubismClippingManager } from './cubismclippingmanager';
import {
  CubismClippingContext,
  CubismRenderer,
  DrawableObjectType
} from './cubismrenderer';
import { CubismShaderManager_WebGL } from './cubismshader_webgl';

const s_invalidValue = -1; // 無効な値を表す定数
/*
 * シェーダをコピーする際に衣装する頂点のインデックス
 */
const s_renderTargetIndexArray: Uint16Array = new Uint16Array([
  0, 1, 2, 2, 1, 3
]);

/**
 * クリッピングマスクの処理を実行するクラス
 */
export class CubismClippingManager_WebGL extends CubismClippingManager<CubismClippingContext_WebGL> {
  /**
   * WebGLレンダリングコンテキストを設定する
   *
   * @param gl WebGLレンダリングコンテキスト
   */
  public setGL(gl: WebGLRenderingContext): void {
    this.gl = gl;
  }

  /**
   * コンストラクタ
   */
  public constructor() {
    super(CubismClippingContext_WebGL);
  }

  /**
   * クリッピングコンテキストを作成する。モデル描画時に実行する。
   *
   * @param model モデルのインスタンス
   * @param renderer レンダラのインスタンス
   * @param lastFbo フレームバッファ
   * @param lastViewport ビューポート
   * @param drawObjectType 描画オブジェクトのタイプ
   */
  public setupClippingContext(
    model: CubismModel,
    renderer: CubismRenderer_WebGL,
    lastFbo: WebGLFramebuffer,
    lastViewport: number[],
    drawObjectType: DrawableObjectType
  ): void {
    // 全てのクリッピングを用意する
    // 同じクリップ（複数の場合はまとめて一つのクリップ）を使う場合は1度だけ設定する
    let usingClipCount = 0;
    for (
      let clipIndex = 0;
      clipIndex < this._clippingContextListForMask.length;
      clipIndex++
    ) {
      // 1つのクリッピングマスクに関して
      const cc: CubismClippingContext_WebGL =
        this._clippingContextListForMask[clipIndex];

      // このクリップを利用する描画オブジェクト群全体を囲む矩形を計算
      switch (drawObjectType) {
        case DrawableObjectType.DrawableObjectType_Drawable:
        default:
          this.calcClippedDrawableTotalBounds(model, cc);
          break;
        case DrawableObjectType.DrawableObjectType_Offscreen:
          this.calcClippedOffscreenTotalBounds(model, cc);
          break;
      }

      if (cc._isUsing) {
        usingClipCount++; // 使用中としてカウント
      }
    }

    if (usingClipCount <= 0) {
      return;
    }

    // 生成したFrameBufferと同じサイズでビューポートを設定
    this.gl.viewport(
      0,
      0,
      this._clippingMaskBufferSize,
      this._clippingMaskBufferSize
    );

    // 後の計算のためにインデックスの最初をセット
    switch (drawObjectType) {
      case DrawableObjectType.DrawableObjectType_Drawable:
      default:
        this._currentMaskBuffer = renderer.getDrawableMaskBuffer(0);
        break;
      case DrawableObjectType.DrawableObjectType_Offscreen:
        this._currentMaskBuffer = renderer.getOffscreenMaskBuffer(0);
        break;
    }

    // ---------- マスク描画処理 ----------
    this._currentMaskBuffer.beginDraw(lastFbo);

    renderer.preDraw(); // バッファをクリアする

    this.setupLayoutBounds(usingClipCount);

    // サイズがレンダーテクスチャの枚数と合わない場合は合わせる
    if (this._clearedMaskBufferFlags.length != this._renderTextureCount) {
      this._clearedMaskBufferFlags.length = 0;
      this._clearedMaskBufferFlags = new Array<boolean>(
        this._renderTextureCount
      );
      for (let i = 0; i < this._clearedMaskBufferFlags.length; i++) {
        this._clearedMaskBufferFlags[i] = false;
      }
    }

    // マスクのクリアフラグを毎フレーム開始時に初期化
    for (let index = 0; index < this._clearedMaskBufferFlags.length; index++) {
      this._clearedMaskBufferFlags[index] = false;
    }

    // 実際にマスクを生成する
    // 全てのマスクをどのようにレイアウトして描くかを決定し、ClipContext, ClippedDrawContextに記憶する
    for (
      let clipIndex = 0;
      clipIndex < this._clippingContextListForMask.length;
      clipIndex++
    ) {
      // --- 実際に1つのマスクを描く ---
      const clipContext: CubismClippingContext_WebGL =
        this._clippingContextListForMask[clipIndex];
      const allClipedDrawRect: csmRect = clipContext._allClippedDrawRect; // このマスクを使う、すべての描画オブジェクトの論理座標上の囲み矩形
      const layoutBoundsOnTex01: csmRect = clipContext._layoutBounds; // この中にマスクを収める
      const margin = 0.05; // モデル座標上の矩形を、適宜マージンを付けて使う
      let scaleX = 0;
      let scaleY = 0;

      // clipContextに設定したレンダーテクスチャをインデックスで取得
      let maskBuffer: CubismRenderTarget_WebGL;
      switch (drawObjectType) {
        case DrawableObjectType.DrawableObjectType_Drawable:
        default:
          maskBuffer = renderer.getDrawableMaskBuffer(clipContext._bufferIndex);
          break;
        case DrawableObjectType.DrawableObjectType_Offscreen:
          maskBuffer = renderer.getOffscreenMaskBuffer(
            clipContext._bufferIndex
          );
          break;
      }

      // 現在のレンダーテクスチャがclipContextのものと異なる場合
      if (this._currentMaskBuffer != maskBuffer) {
        this._currentMaskBuffer.endDraw(); // 前のレンダーテクスチャの描画を終了
        this._currentMaskBuffer = maskBuffer;
        this._currentMaskBuffer.beginDraw(lastFbo); // 新しいレンダーテクスチャの描画を開始

        renderer.preDraw(); // バッファをクリアする
      }

      this._tmpBoundsOnModel.setRect(allClipedDrawRect);
      this._tmpBoundsOnModel.expand(
        allClipedDrawRect.width * margin,
        allClipedDrawRect.height * margin
      );
      //########## 本来は割り当てられた領域の全体を使わず必要最低限のサイズがよい

      // シェーダ用の計算式を求める。回転を考慮しない場合は以下のとおり
      // movePeriod' = movePeriod * scaleX + offX		  [[ movePeriod' = (movePeriod - tmpBoundsOnModel.movePeriod)*scale + layoutBoundsOnTex01.movePeriod ]]
      scaleX = layoutBoundsOnTex01.width / this._tmpBoundsOnModel.width;
      scaleY = layoutBoundsOnTex01.height / this._tmpBoundsOnModel.height;

      //--------- draw時の mask 参照用行列を計算---------
      this.createMatrixForMask(false, layoutBoundsOnTex01, scaleX, scaleY);

      clipContext._matrixForMask.setMatrix(this._tmpMatrixForMask.getArray());
      clipContext._matrixForDraw.setMatrix(this._tmpMatrixForDraw.getArray());

      if (drawObjectType == DrawableObjectType.DrawableObjectType_Offscreen) {
        // clipContext * mvp^-1
        const invertMvp = renderer.getMvpMatrix().getInvert();
        clipContext._matrixForDraw.multiplyByMatrix(invertMvp);
      }

      const clipDrawCount: number = clipContext._clippingIdCount;
      for (let i = 0; i < clipDrawCount; i++) {
        const clipDrawIndex: number = clipContext._clippingIdList[i];

        // 頂点情報が更新されておらず、信頼性がない場合は描画をパスする
        if (
          !model.getDrawableDynamicFlagVertexPositionsDidChange(clipDrawIndex)
        ) {
          continue;
        }

        renderer.setIsCulling(model.getDrawableCulling(clipDrawIndex) != false);

        // マスクがクリアされていないなら処理する
        if (!this._clearedMaskBufferFlags[clipContext._bufferIndex]) {
          // マスクをクリアする
          // (仮仕様) 1が無効（描かれない）領域、0が有効（描かれる）領域。（シェーダーCd*Csで0に近い値をかけてマスクを作る。1をかけると何も起こらない）
          this.gl.clearColor(1.0, 1.0, 1.0, 1.0);
          this.gl.clear(this.gl.COLOR_BUFFER_BIT);
          this._clearedMaskBufferFlags[clipContext._bufferIndex] = true;
        }

        // 今回専用の変換を適用して描く
        // チャンネルも切り替える必要がある(A,R,G,B)
        renderer.setClippingContextBufferForMask(clipContext);

        renderer.drawMeshWebGL(model, clipDrawIndex);
      }
    }

    // --- 後処理 ---
    this._currentMaskBuffer.endDraw(); // マスクの描画を終了
    renderer.setClippingContextBufferForMask(null);

    this.gl.viewport(
      lastViewport[0],
      lastViewport[1],
      lastViewport[2],
      lastViewport[3]
    );
  }

  /**
   * マスクの合計数をカウント
   *
   * @return マスクの合計数を返す
   */
  public getClippingMaskCount(): number {
    return this._clippingContextListForMask.length;
  }

  _currentMaskBuffer: CubismRenderTarget_WebGL; // マスク用オフスクリーンサーフェス

  gl: WebGLRenderingContext; // WebGLレンダリングコンテキスト
}

/**
 * クリッピングマスクのコンテキスト
 */
export class CubismClippingContext_WebGL extends CubismClippingContext {
  /**
   * 引数付きコンストラクタ
   *
   * @param manager マスクを管理しているマネージャのインスタンス
   * @param clippingDrawableIndices クリップしているDrawableのインデックスリスト
   * @param clipCount クリップしているDrawableの個数
   */
  public constructor(
    manager: CubismClippingManager_WebGL,
    clippingDrawableIndices: Int32Array,
    clipCount: number
  ) {
    super(clippingDrawableIndices, clipCount);
    this._owner = manager;
  }

  /**
   * このマスクを管理するマネージャのインスタンスを取得する
   *
   * @return クリッピングマネージャのインスタンス
   */
  public getClippingManager(): CubismClippingManager_WebGL {
    return this._owner;
  }

  /**
   * WebGLレンダリングコンテキストを設定する
   *
   * @param gl WebGLレンダリングコンテキスト
   */
  public setGl(gl: WebGLRenderingContext): void {
    this._owner.setGL(gl);
  }

  private _owner: CubismClippingManager_WebGL; // このマスクを管理しているマネージャのインスタンス
}

/**
 * Cubismモデルを描画する直前のWebGLのステートを保持・復帰させるクラス
 */
export class CubismRendererProfile_WebGL {
  /**
   * WebGLの有効・無効をセットする
   *
   * @param index 有効・無効にする機能
   * @param enabled trueなら有効にする
   */
  private setGlEnable(index: GLenum, enabled: GLboolean): void {
    if (enabled) this.gl.enable(index);
    else this.gl.disable(index);
  }

  /**
   * WebGLのVertex Attribute Array機能の有効・無効をセットする
   *
   * @param   index   有効・無効にする機能
   * @param   enabled trueなら有効にする
   */
  private setGlEnableVertexAttribArray(
    index: GLuint,
    enabled: GLboolean
  ): void {
    if (enabled) this.gl.enableVertexAttribArray(index);
    else this.gl.disableVertexAttribArray(index);
  }

  /**
   * WebGLのステートを保持する
   */
  public save(): void {
    if (this.gl == null) {
      CubismLogError(
        "'gl' is null. WebGLRenderingContext is required.\nPlease call 'CubimRenderer_WebGL.startUp' function."
      );
      return;
    }
    //-- push state --
    this._lastArrayBufferBinding = this.gl.getParameter(
      this.gl.ARRAY_BUFFER_BINDING
    );
    this._lastElementArrayBufferBinding = this.gl.getParameter(
      this.gl.ELEMENT_ARRAY_BUFFER_BINDING
    );
    this._lastProgram = this.gl.getParameter(this.gl.CURRENT_PROGRAM);

    this._lastActiveTexture = this.gl.getParameter(this.gl.ACTIVE_TEXTURE);
    this.gl.activeTexture(this.gl.TEXTURE1); //テクスチャユニット1をアクティブに（以後の設定対象とする）
    this._lastTexture1Binding2D = this.gl.getParameter(
      this.gl.TEXTURE_BINDING_2D
    );

    this.gl.activeTexture(this.gl.TEXTURE0); //テクスチャユニット0をアクティブに（以後の設定対象とする）
    this._lastTexture0Binding2D = this.gl.getParameter(
      this.gl.TEXTURE_BINDING_2D
    );

    this._lastVertexAttribArrayEnabled[0] = this.gl.getVertexAttrib(
      0,
      this.gl.VERTEX_ATTRIB_ARRAY_ENABLED
    );
    this._lastVertexAttribArrayEnabled[1] = this.gl.getVertexAttrib(
      1,
      this.gl.VERTEX_ATTRIB_ARRAY_ENABLED
    );
    this._lastVertexAttribArrayEnabled[2] = this.gl.getVertexAttrib(
      2,
      this.gl.VERTEX_ATTRIB_ARRAY_ENABLED
    );
    this._lastVertexAttribArrayEnabled[3] = this.gl.getVertexAttrib(
      3,
      this.gl.VERTEX_ATTRIB_ARRAY_ENABLED
    );

    this._lastScissorTest = this.gl.isEnabled(this.gl.SCISSOR_TEST);
    this._lastStencilTest = this.gl.isEnabled(this.gl.STENCIL_TEST);
    this._lastDepthTest = this.gl.isEnabled(this.gl.DEPTH_TEST);
    this._lastCullFace = this.gl.isEnabled(this.gl.CULL_FACE);
    this._lastBlend = this.gl.isEnabled(this.gl.BLEND);

    this._lastFrontFace = this.gl.getParameter(this.gl.FRONT_FACE);

    this._lastColorMask = this.gl.getParameter(this.gl.COLOR_WRITEMASK);

    // backup blending
    this._lastBlending[0] = this.gl.getParameter(this.gl.BLEND_SRC_RGB);
    this._lastBlending[1] = this.gl.getParameter(this.gl.BLEND_DST_RGB);
    this._lastBlending[2] = this.gl.getParameter(this.gl.BLEND_SRC_ALPHA);
    this._lastBlending[3] = this.gl.getParameter(this.gl.BLEND_DST_ALPHA);
  }

  /**
   * 保持したWebGLのステートを復帰させる
   */
  public restore(): void {
    if (this.gl == null) {
      CubismLogError(
        "'gl' is null. WebGLRenderingContext is required.\nPlease call 'CubimRenderer_WebGL.startUp' function."
      );
      return;
    }
    this.gl.useProgram(this._lastProgram);

    this.setGlEnableVertexAttribArray(0, this._lastVertexAttribArrayEnabled[0]);
    this.setGlEnableVertexAttribArray(1, this._lastVertexAttribArrayEnabled[1]);
    this.setGlEnableVertexAttribArray(2, this._lastVertexAttribArrayEnabled[2]);
    this.setGlEnableVertexAttribArray(3, this._lastVertexAttribArrayEnabled[3]);

    this.setGlEnable(this.gl.SCISSOR_TEST, this._lastScissorTest);
    this.setGlEnable(this.gl.STENCIL_TEST, this._lastStencilTest);
    this.setGlEnable(this.gl.DEPTH_TEST, this._lastDepthTest);
    this.setGlEnable(this.gl.CULL_FACE, this._lastCullFace);
    this.setGlEnable(this.gl.BLEND, this._lastBlend);

    this.gl.frontFace(this._lastFrontFace);

    this.gl.colorMask(
      this._lastColorMask[0],
      this._lastColorMask[1],
      this._lastColorMask[2],
      this._lastColorMask[3]
    );

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this._lastArrayBufferBinding); //前にバッファがバインドされていたら破棄する必要がある
    this.gl.bindBuffer(
      this.gl.ELEMENT_ARRAY_BUFFER,
      this._lastElementArrayBufferBinding
    );

    this.gl.activeTexture(this.gl.TEXTURE1); //テクスチャユニット1を復元
    this.gl.bindTexture(this.gl.TEXTURE_2D, this._lastTexture1Binding2D);

    this.gl.activeTexture(this.gl.TEXTURE0); //テクスチャユニット0を復元
    this.gl.bindTexture(this.gl.TEXTURE_2D, this._lastTexture0Binding2D);

    this.gl.activeTexture(this._lastActiveTexture);

    this.gl.blendFuncSeparate(
      this._lastBlending[0],
      this._lastBlending[1],
      this._lastBlending[2],
      this._lastBlending[3]
    );
  }

  /**
   * WebGLレンダリングコンテキストを設定する
   *
   * @param gl WebGLレンダリングコンテキスト
   */
  public setGl(gl: WebGLRenderingContext): void {
    this.gl = gl;
  }

  /**
   * コンストラクタ
   */
  constructor() {
    this._lastVertexAttribArrayEnabled = new Array<GLboolean>(4);
    this._lastColorMask = new Array<GLboolean>(4);
    this._lastBlending = new Array<GLint>(4);
  }

  private _lastArrayBufferBinding: GLint; ///< モデル描画直前の頂点バッファ
  private _lastElementArrayBufferBinding: GLint; ///< モデル描画直前のElementバッファ
  private _lastProgram: GLint; ///< モデル描画直前のシェーダプログラムバッファ
  private _lastActiveTexture: GLint; ///< モデル描画直前のアクティブなテクスチャ
  private _lastTexture0Binding2D: GLint; ///< モデル描画直前のテクスチャユニット0
  private _lastTexture1Binding2D: GLint; ///< モデル描画直前のテクスチャユニット1
  private _lastVertexAttribArrayEnabled: GLboolean[]; ///< モデル描画直前のテクスチャユニット1
  private _lastScissorTest: GLboolean; ///< モデル描画直前のGL_VERTEX_ATTRIB_ARRAY_ENABLEDパラメータ
  private _lastBlend: GLboolean; ///< モデル描画直前のGL_SCISSOR_TESTパラメータ
  private _lastStencilTest: GLboolean; ///< モデル描画直前のGL_STENCIL_TESTパラメータ
  private _lastDepthTest: GLboolean; ///< モデル描画直前のGL_DEPTH_TESTパラメータ
  private _lastCullFace: GLboolean; ///< モデル描画直前のGL_CULL_FACEパラメータ
  private _lastFrontFace: GLint; ///< モデル描画直前のGL_CULL_FACEパラメータ
  private _lastColorMask: GLboolean[]; ///< モデル描画直前のGL_COLOR_WRITEMASKパラメータ
  private _lastBlending: GLint[]; ///< モデル描画直前のカラーブレンディングパラメータ

  gl: WebGLRenderingContext;
}

/**
 * WebGL用の描画命令を実装したクラス
 */
export class CubismRenderer_WebGL extends CubismRenderer {
  /**
   * レンダラの初期化処理を実行する
   * 引数に渡したモデルからレンダラの初期化処理に必要な情報を取り出すことができる
   * NOTE: WebGLコンテキストが初期化されていない可能性があるため、ここではWebGLコンテキストを使う初期化は行わない。
   *
   * @param model モデルのインスタンス
   * @param maskBufferCount バッファの生成数
   */
  public initialize(model: CubismModel, maskBufferCount = 1): void {
    if (model.isUsingMasking()) {
      this._drawableClippingManager = new CubismClippingManager_WebGL(); // クリッピングマスク・バッファ前処理方式を初期化
      this._drawableClippingManager.initializeForDrawable(
        model,
        maskBufferCount
      );
    }

    if (model.isUsingMaskingForOffscreen()) {
      this._offscreenClippingManager = new CubismClippingManager_WebGL(); //クリッピングマスク・バッファ前処理方式を初期化
      this._offscreenClippingManager.initializeForOffscreen(
        model,
        maskBufferCount
      );
    }

    // IndexList と TypeListのサイズをモデルの描画オブジェクト数に合わせる
    updateSize(
      this._sortedObjectsIndexList,
      model.getDrawableCount() +
        (model.getOffscreenCount ? model.getOffscreenCount() : 0),
      0,
      true
    );
    updateSize(
      this._sortedObjectsTypeList,
      model.getDrawableCount() +
        (model.getOffscreenCount ? model.getOffscreenCount() : 0),
      0,
      true
    );

    super.initialize(model); // 親クラスの処理を呼ぶ
  }

  /**
   * オフスクリーンの親を探して設定する
   *
   * @param model モデルのインスタンス
   * @param offscreenCount オフスクリーンの数
   */
  private setupParentOffscreens(
    model: CubismModel,
    offscreenCount: number
  ): void {
    let parentOffscreen: CubismOffscreenRenderTarget_WebGL | null;
    for (
      let offscreenIndex = 0;
      offscreenIndex < offscreenCount;
      ++offscreenIndex
    ) {
      parentOffscreen = null;
      const ownerIndex = model.getOffscreenOwnerIndices()[offscreenIndex];
      let parentIndex = model.getPartParentPartIndices()[ownerIndex];

      // 親のオフスクリーンを探す
      while (parentIndex != NoParentIndex) {
        for (let i = 0; i < offscreenCount; ++i) {
          const ownerIndex =
            model.getOffscreenOwnerIndices()[
              this._offscreenList[i].getOffscreenIndex()
            ];
          if (ownerIndex != parentIndex) {
            continue; //オフスクリーンの所有者がパーツではない場合はスキップ
          }

          parentOffscreen = this._offscreenList[i];
          break;
        }

        if (parentOffscreen != null) {
          break; // 親のオフスクリーンが見つかった場合はループを抜ける
        }

        parentIndex = model.getPartParentPartIndices()[parentIndex];
      }

      // 親のオフスクリーンを設定
      this._offscreenList[offscreenIndex].setParentPartOffscreen(
        parentOffscreen
      );
    }
  }

  /**
   * WebGLテクスチャのバインド処理
   * CubismRendererにテクスチャを設定し、CubismRenderer内でその画像を参照するためのIndex値を戻り値とする
   *
   * @param modelTextureNo セットするモデルテクスチャの番号
   * @param glTextureNo WebGLテクスチャの番号
   */
  public bindTexture(modelTextureNo: number, glTexture: WebGLTexture): void {
    this._textures.set(modelTextureNo, glTexture);
  }

  /**
   * WebGLにバインドされたテクスチャのリストを取得する
   *
   * @return テクスチャのリスト
   */
  public getBindedTextures(): Map<number, WebGLTexture> {
    return this._textures;
  }

  /**
   * クリッピングマスクバッファのサイズを設定する
   * マスク用のFrameBufferを破棄、再作成する為処理コストは高い
   *
   * @param size クリッピングマスクバッファのサイズ
   */
  public setClippingMaskBufferSize(size: number) {
    // クリッピングマスクを利用しない場合は早期リターン
    if (!this._model.isUsingMasking()) {
      return;
    }

    // インスタンス破棄前にレンダーテクスチャの数を保存
    const renderTextureCount: number =
      this._drawableClippingManager.getRenderTextureCount();

    // FrameBufferのサイズを変更するためにインスタンスを破棄・再作成する
    this._drawableClippingManager.release();
    this._drawableClippingManager = void 0;
    this._drawableClippingManager = null;

    this._drawableClippingManager = new CubismClippingManager_WebGL();

    this._drawableClippingManager.setClippingMaskBufferSize(size);

    this._drawableClippingManager.initializeForDrawable(
      this.getModel(),
      renderTextureCount // インスタンス破棄前に保存したレンダーテクスチャの数
    );
  }

  /**
   * クリッピングマスクバッファのサイズを取得する
   *
   * @return クリッピングマスクバッファのサイズ
   */
  public getClippingMaskBufferSize(): number {
    return this._model.isUsingMasking()
      ? this._drawableClippingManager.getClippingMaskBufferSize()
      : s_invalidValue;
  }

  /**
   * ブレンドモード用のフレームバッファを取得する
   *
   * @return ブレンドモード用のフレームバッファ
   */
  public getModelRenderTarget(index: number): CubismRenderTarget_WebGL {
    return this._modelRenderTargets[index];
  }

  /**
   * レンダーテクスチャの枚数を取得する
   * @return レンダーテクスチャの枚数
   */
  public getRenderTextureCount(): number {
    return this._model.isUsingMasking()
      ? this._drawableClippingManager.getRenderTextureCount()
      : s_invalidValue;
  }

  /**
   * コンストラクタ
   */
  public constructor(width: number, height: number) {
    super(width, height);
    this._clippingContextBufferForMask = null;
    this._clippingContextBufferForDraw = null;
    this._rendererProfile = new CubismRendererProfile_WebGL();
    this._textures = new Map<number, number>();
    this._sortedObjectsIndexList = new Array<number>();
    this._sortedObjectsTypeList = new Array<number>();
    this._bufferData = {
      vertex: (WebGLBuffer = null),
      uv: (WebGLBuffer = null),
      index: (WebGLBuffer = null)
    };
    this._modelRenderTargets = new Array<CubismOffscreenRenderTarget_WebGL>();
    this._drawableMasks = new Array<CubismRenderTarget_WebGL>();
    this._currentFbo = null;
    this._drawableClippingManager = null;
    this._offscreenClippingManager = null;
    this._offscreenMasks = new Array<CubismRenderTarget_WebGL>();
    this._offscreenList = new Array<CubismOffscreenRenderTarget_WebGL>();

    // テクスチャ対応マップの容量を確保しておく
    // this._textures.prepareCapacity(32, true);
  }

  /**
   * デストラクタ相当の処理
   */
  public release(): void {
    if (this._drawableClippingManager) {
      this._drawableClippingManager.release();
      this._drawableClippingManager = void 0;
      this._drawableClippingManager = null;
    }

    if (this.gl == null) {
      return;
    }
    this.gl.deleteBuffer(this._bufferData.vertex);
    this._bufferData.vertex = null;
    this.gl.deleteBuffer(this._bufferData.uv);
    this._bufferData.uv = null;
    this.gl.deleteBuffer(this._bufferData.index);
    this._bufferData.index = null;
    this._bufferData = null;

    this._textures = null;

    for (let i = 0; i < this._modelRenderTargets.length; i++) {
      if (
        this._modelRenderTargets[i] != null &&
        this._modelRenderTargets[i].isValid()
      ) {
        this._modelRenderTargets[i].destroyRenderTarget();
      }
    }
    this._modelRenderTargets.length = 0;
    this._modelRenderTargets = null;

    for (let i = 0; i < this._drawableMasks.length; i++) {
      if (this._drawableMasks[i] != null && this._drawableMasks[i].isValid()) {
        this._drawableMasks[i].destroyRenderTarget();
      }
    }
    this._drawableMasks.length = 0;
    this._drawableMasks = null;

    for (let i = 0; i < this._offscreenMasks.length; i++) {
      if (
        this._offscreenMasks[i] != null &&
        this._offscreenMasks[i].isValid()
      ) {
        this._offscreenMasks[i].destroyRenderTarget();
      }
    }
    this._offscreenMasks.length = 0;
    this._offscreenMasks = null;

    for (let i = 0; i < this._offscreenList.length; i++) {
      if (this._offscreenList[i] != null && this._offscreenList[i].isValid()) {
        this._offscreenList[i].destroyRenderTarget();
      }
    }
    this._offscreenList.length = 0;
    this._offscreenList = null;

    this._offscreenClippingManager = null;
    this._drawableClippingManager = null;
    this._clippingContextBufferForMask = null;
    this._clippingContextBufferForDraw = null;

    this._rendererProfile = null;
    this._sortedObjectsIndexList = null;
    this._sortedObjectsTypeList = null;
    this._currentFbo = null;
    this._model = null;
    this.gl = null;
  }

  /**
   * Shaderの読み込みを行う
   * @param shaderPath シェーダのパス
   */
  public loadShaders(shaderPath: string = null): void {
    if (this.gl == null) {
      CubismLogError(
        "'gl' is null. WebGLRenderingContext is required.\nPlease call 'CubimRenderer_WebGL.startUp' function."
      );
      return;
    }

    if (
      CubismShaderManager_WebGL.getInstance().getShader(this.gl)._shaderSets
        .length == 0 ||
      !CubismShaderManager_WebGL.getInstance().getShader(this.gl)
        ._isShaderLoaded
    ) {
      const shader = CubismShaderManager_WebGL.getInstance().getShader(this.gl);
      if (shaderPath != null) {
        shader.setShaderPath(shaderPath);
      }
      shader.generateShaders();
    }
  }

  /**
   * モデルを描画する実際の処理
   * @param shaderPath シェーダのパス
   */
  public doDrawModel(shaderPath: string = null): void {
    this.loadShaders(shaderPath);
    this.beforeDrawModelRenderTarget();

    const lastFbo = this.gl.getParameter(
      this.gl.FRAMEBUFFER_BINDING
    ) as WebGLFramebuffer;
    const lastViewport = this.gl.getParameter(this.gl.VIEWPORT) as number[];

    // //------------ クリッピングマスク・バッファ前処理方式の場合 ------------
    if (this._drawableClippingManager != null) {
      this.preDraw();
      for (
        let i = 0;
        i < this._drawableClippingManager.getRenderTextureCount();
        ++i
      ) {
        if (
          this._drawableMasks[i].getBufferWidth() !=
            this._drawableClippingManager.getClippingMaskBufferSize() ||
          this._drawableMasks[i].getBufferHeight() !=
            this._drawableClippingManager.getClippingMaskBufferSize()
        ) {
          // クリッピングマスクのサイズが変更された場合は、オフスクリーンサーフェスを再作成する
          this._drawableMasks[i].createRenderTarget(
            this.gl,
            this._drawableClippingManager.getClippingMaskBufferSize(),
            this._drawableClippingManager.getClippingMaskBufferSize(),
            lastFbo
          );
        }
      }

      if (this.isUsingHighPrecisionMask()) {
        this._drawableClippingManager.setupMatrixForHighPrecision(
          this.getModel(),
          false
        );
      } else {
        this._drawableClippingManager.setupClippingContext(
          this.getModel(),
          this,
          lastFbo,
          lastViewport,
          DrawableObjectType.DrawableObjectType_Drawable
        );
      }
    }

    if (this._offscreenClippingManager != null) {
      this.preDraw();

      // サイズが違う場合はここで作成しなおし
      for (
        let i = 0;
        i < this._offscreenClippingManager.getRenderTextureCount();
        ++i
      ) {
        if (
          this._offscreenMasks[i].getBufferWidth() !=
            this._offscreenClippingManager.getClippingMaskBufferSize() ||
          this._offscreenMasks[i].getBufferHeight() !=
            this._offscreenClippingManager.getClippingMaskBufferSize()
        ) {
          this._offscreenMasks[i].createRenderTarget(
            this.gl,
            this._offscreenClippingManager.getClippingMaskBufferSize(),
            this._offscreenClippingManager.getClippingMaskBufferSize(),
            lastFbo
          );
        }
      }

      if (this.isUsingHighPrecisionMask()) {
        this._offscreenClippingManager.setupMatrixForOffscreenHighPrecision(
          this.getModel(),
          false,
          this.getMvpMatrix()
        );
      } else {
        this._offscreenClippingManager.setupClippingContext(
          this.getModel(),
          this,
          lastFbo,
          lastViewport,
          DrawableObjectType.DrawableObjectType_Offscreen
        );
      }
    }

    // 上記クリッピング処理内でも一度PreDrawを呼ぶので注意!!
    this.preDraw();

    this.drawObjectLoop(lastFbo);

    this.afterDrawModelRenderTarget();
  }

  /**
   * 描画オブジェクトのループ処理を行う。
   *
   * @param lastFbo 前回のフレームバッファ
   */
  public drawObjectLoop(lastFbo: WebGLFramebuffer): void {
    const model = this.getModel();
    const drawableCount = model.getDrawableCount();
    const offscreenCount = model.getOffscreenCount();
    const totalCount = drawableCount + offscreenCount;
    const renderOrder = model.getRenderOrders();

    this._currentOffscreen = null; // 現在のオフスクリーンを初期化
    this._currentFbo = lastFbo;
    this._modelRootFbo = lastFbo;

    // インデックスを描画順でソート
    for (let i = 0; i < totalCount; ++i) {
      const order = renderOrder[i];

      if (i < drawableCount) {
        this._sortedObjectsIndexList[order] = i;
        this._sortedObjectsTypeList[order] =
          DrawableObjectType.DrawableObjectType_Drawable;
      } else if (i < totalCount) {
        this._sortedObjectsIndexList[order] = i - drawableCount;
        this._sortedObjectsTypeList[order] =
          DrawableObjectType.DrawableObjectType_Offscreen;
      }
    }

    // 描画
    for (let i = 0; i < totalCount; ++i) {
      const objectIndex = this._sortedObjectsIndexList[i];
      const objectType = this._sortedObjectsTypeList[i];

      this.renderObject(objectIndex, objectType);
    }

    while (this._currentOffscreen != null) {
      // オフスクリーンが残っている場合は親オフスクリーンへの伝搬を行う
      this.submitDrawToParentOffscreen(
        this._currentOffscreen.getOffscreenIndex(),
        DrawableObjectType.DrawableObjectType_Offscreen
      );
    }
  }

  /**
   * 描画オブジェクトを描画する。
   *
   * @param objectIndex 描画対象のオブジェクトのインデックス
   * @param objectType 描画対象のオブジェクトのタイプ
   * @param lastFbo 前回のフレームバッファ
   * @param lastViewport 前回のビューポート
   */
  protected renderObject(
    objectIndex: number,
    objectType: DrawableObjectType
  ): void {
    switch (objectType) {
      case DrawableObjectType.DrawableObjectType_Drawable:
        this.drawDrawable(objectIndex, this._modelRootFbo);
        break;
      case DrawableObjectType.DrawableObjectType_Offscreen:
        this.addOffscreen(objectIndex);
        break;
      default:
        CubismLogError('Unknown object type: ' + objectType);
        break;
    }
  }

  /**
   * 描画オブジェクト（アートメッシュ）を描画する。
   *
   * @param model 描画対象のモデル
   * @param index 描画対象のメッシュのインデックス
   */
  public drawDrawable(drawableIndex: number, rootFbo: WebGLFramebuffer): void {
    // Drawableが表示状態でなければ処理をパスする
    if (!this.getModel().getDrawableDynamicFlagIsVisible(drawableIndex)) {
      return;
    }

    this.submitDrawToParentOffscreen(
      drawableIndex,
      DrawableObjectType.DrawableObjectType_Drawable
    );

    const clipContext =
      this._drawableClippingManager != null
        ? this._drawableClippingManager.getClippingContextListForDraw()[
            drawableIndex
          ]
        : null;

    if (clipContext != null && this.isUsingHighPrecisionMask()) {
      // 描くことになっていた
      if (clipContext._isUsing) {
        // 生成したFrameBufferと同じサイズでビューポートを設定
        this.gl.viewport(
          0,
          0,
          this._drawableClippingManager.getClippingMaskBufferSize(),
          this._drawableClippingManager.getClippingMaskBufferSize()
        );

        this.preDraw(); // バッファをクリアする

        // ---------- マスク描画処理 ----------
        // マスク用RenderTextureをactiveにセット
        this.getDrawableMaskBuffer(clipContext._bufferIndex).beginDraw(
          this._currentFbo
        );

        // マスクをクリアする
        // (仮仕様) 1が無効（描かれない）領域、0が有効（描かれる）領域。（シェーダーCd*Csで0に近い値をかけてマスクを作る。1をかけると何も起こらない）
        this.gl.clearColor(1.0, 1.0, 1.0, 1.0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      }

      {
        const clipDrawCount: number = clipContext._clippingIdCount;

        for (let index = 0; index < clipDrawCount; index++) {
          const clipDrawIndex: number = clipContext._clippingIdList[index];

          // 頂点情報が更新されておらず、信頼性がない場合は描画をパスする
          if (
            !this._model.getDrawableDynamicFlagVertexPositionsDidChange(
              clipDrawIndex
            )
          ) {
            continue;
          }

          this.setIsCulling(
            this._model.getDrawableCulling(clipDrawIndex) != false
          );

          // 今回専用の変換を適用して描く
          // チャンネルも切り替える必要がある(A,R,G,B)
          this.setClippingContextBufferForMask(clipContext);

          this.drawMeshWebGL(this._model, clipDrawIndex);
        }

        // --- 後処理 ---
        this.getDrawableMaskBuffer(clipContext._bufferIndex).endDraw();
        this.setClippingContextBufferForMask(null);

        this.gl.viewport(
          0,
          0,
          this._modelRenderTargetWidth,
          this._modelRenderTargetHeight
        );

        this.preDraw(); // バッファをクリアする
      }
    }

    // クリッピングマスクをセットする
    this.setClippingContextBufferForDrawable(clipContext);

    this.setIsCulling(this.getModel().getDrawableCulling(drawableIndex));

    this.drawMeshWebGL(this._model, drawableIndex);
  }

  /**
   * 描画オブジェクト（アートメッシュ）を描画する。
   *
   * @param model 描画対象のモデル
   * @param index 描画対象のメッシュのインデックス
   */
  public drawMeshWebGL(model: Readonly<CubismModel>, index: number): void {
    // 裏面描画の有効・無効
    if (this.isCulling()) {
      this.gl.enable(this.gl.CULL_FACE);
    } else {
      this.gl.disable(this.gl.CULL_FACE);
    }

    this.gl.frontFace(this.gl.CCW); // Cubism SDK OpenGLはマスク・アートメッシュ共にCCWが表面

    if (this.isGeneratingMask()) {
      CubismShaderManager_WebGL.getInstance()
        .getShader(this.gl)
        .setupShaderProgramForMask(this, model, index);
    } else {
      CubismShaderManager_WebGL.getInstance()
        .getShader(this.gl)
        .setupShaderProgramForDrawable(this, model, index);
    }

    if (
      !CubismShaderManager_WebGL.getInstance().getShader(this.gl)
        ._isShaderLoaded
    ) {
      // シェーダーがロードされていない場合は描画を行わない
      // NOTE: Cubism 5.2 以前のモデル描画時にのみ、マスク無しのモデルが描画されてしまうためここで早期リターン
      return;
    }

    {
      const indexCount: number = model.getDrawableVertexIndexCount(index);
      this.gl.drawElements(
        this.gl.TRIANGLES,
        indexCount,
        this.gl.UNSIGNED_SHORT,
        0
      );
    }

    // 後処理
    this.gl.useProgram(null);
    this.setClippingContextBufferForDrawable(null);
    this.setClippingContextBufferForMask(null);
  }

  /**
   * オフスクリーンを親のオフスクリーンにコピーする。
   *
   * @param objectIndex オブジェクトのインデックス
   * @param objectType  オブジェクトの種類
   */
  submitDrawToParentOffscreen(
    objectIndex: number,
    objectType: DrawableObjectType
  ): void {
    if (this._currentOffscreen == null || objectIndex == s_invalidValue) {
      return;
    }

    const currentOwnerIndex =
      this.getModel().getOffscreenOwnerIndices()[
        this._currentOffscreen.getOffscreenIndex()
      ];

    // オーナーが不明な場合は処理を終了
    if (currentOwnerIndex == s_invalidValue) {
      return;
    }

    let targetParentIndex = NoParentIndex;

    switch (objectType) {
      case DrawableObjectType.DrawableObjectType_Drawable:
        targetParentIndex =
          this.getModel().getDrawableParentPartIndex(objectIndex);
        break;
      case DrawableObjectType.DrawableObjectType_Offscreen:
        targetParentIndex =
          this.getModel().getPartParentPartIndices()[
            this.getModel().getOffscreenOwnerIndices()[objectIndex]
          ];
        break;
      default:
        // 不明なタイプだった場合は処理を終了
        return;
    }
    while (targetParentIndex != NoParentIndex) {
      // オブジェクトの親が現在のオーナーと同じ場合は処理を終了
      if (targetParentIndex == currentOwnerIndex) {
        return;
      }

      targetParentIndex =
        this.getModel().getPartParentPartIndices()[targetParentIndex];
    }

    // 描画
    this.drawOffscreen(this._currentOffscreen);

    // さらに親のオフスクリーンに伝搬可能なら伝搬する
    this.submitDrawToParentOffscreen(objectIndex, objectType);
  }

  /**
   * 描画オブジェクト（オフスクリーン）を追加する。
   *
   * @param offscreenIndex オフスクリーンのインデックス
   */
  public addOffscreen(offscreenIndex: number): void {
    // 以前のオフスクリーンレンダリングターゲットを親に伝搬する処理を追加する
    if (
      this._currentOffscreen != null &&
      this._currentOffscreen.getOffscreenIndex() != offscreenIndex
    ) {
      let isParent = false;
      const ownerIndex =
        this.getModel().getOffscreenOwnerIndices()[offscreenIndex];
      let parentIndex = this.getModel().getPartParentPartIndices()[ownerIndex];

      const currentOffscreenIndex = this._currentOffscreen.getOffscreenIndex();
      const currentOffscreenOwnerIndex =
        this.getModel().getOffscreenOwnerIndices()[currentOffscreenIndex];
      while (parentIndex != NoParentIndex) {
        if (parentIndex == currentOffscreenOwnerIndex) {
          isParent = true;
          break;
        }
        parentIndex = this.getModel().getPartParentPartIndices()[parentIndex];
      }

      if (!isParent) {
        // 現在のオフスクリーンレンダリングターゲットがあるなら、親に伝搬する
        this.submitDrawToParentOffscreen(
          offscreenIndex,
          DrawableObjectType.DrawableObjectType_Offscreen
        );
      }
    }

    const offscreen = this._offscreenList[offscreenIndex];

    // レンダーターゲットが未生成、レンダーテクスチャ使用中、もしくはサイズが異なるなら新しいオフスクリーンレンダリングターゲットを作成
    if (
      offscreen.getRenderTexture() == null ||
      offscreen.getBufferWidth() != this._modelRenderTargetWidth ||
      offscreen.getBufferHeight() != this._modelRenderTargetHeight ||
      offscreen.getUsingRenderTextureState()
    ) {
      offscreen.setOffscreenRenderTarget(
        this.gl,
        this._modelRenderTargetWidth,
        this._modelRenderTargetHeight,
        this._currentFbo
      );
    } else {
      // 既存のRenderTextureを使用するので使用フラグを立てる。
      offscreen.startUsingRenderTexture();
    }

    // 以前のオフスクリーンレンダリングターゲットを取得
    const oldOffscreen = offscreen.getParentPartOffscreen();
    offscreen.setOldOffscreen(oldOffscreen);

    let oldFBO: WebGLFramebuffer = null;
    if (oldOffscreen != null) {
      oldFBO = oldOffscreen.getRenderTexture();
    }
    if (oldFBO == null) {
      oldFBO = this._modelRootFbo; // ルートのFBOを使用
    }

    // 別バッファに描画を開始
    offscreen.beginDraw(oldFBO);
    this.gl.viewport(
      0,
      0,
      this._modelRenderTargetWidth,
      this._modelRenderTargetHeight
    );
    offscreen.clear(0.0, 0.0, 0.0, 0.0);

    // 現在のオフスクリーンレンダリングターゲットを設定
    this._currentOffscreen = offscreen;
    this._currentFbo = offscreen.getRenderTexture();
  }

  /**
   * オフスクリーン描画を行う。
   *
   * @param offscreen オフスクリーンレンダリングターゲット
   */
  public drawOffscreen(offscreen: CubismOffscreenRenderTarget_WebGL): void {
    const offscreenIndex = offscreen.getOffscreenIndex();

    // クリッピングマスク
    const clipContext =
      this._offscreenClippingManager != null
        ? this._offscreenClippingManager.getClippingContextListForOffscreen()[
            offscreenIndex
          ]
        : null;

    if (clipContext != null && this.isUsingHighPrecisionMask()) {
      // マスクを書く必要がある
      if (clipContext._isUsing) {
        // 書くことになっていた
        // 生成したRenderTargetと同じサイズでビューポートを設定
        this.gl.viewport(
          0,
          0,
          this._offscreenClippingManager.getClippingMaskBufferSize(),
          this._offscreenClippingManager.getClippingMaskBufferSize()
        );

        this.preDraw(); // バッファをクリアする

        // ---------- マスク描画処理 ----------
        // マスク用RenderTextureをactiveにセット
        this.getOffscreenMaskBuffer(clipContext._bufferIndex).beginDraw(
          this._currentFbo
        );

        // マスクをクリアする
        // 1が無効（描かれない）領域、0が有効（描かれる）領域。（シェーダで Cd*Csで0に近い値をかけてマスクを作る。1をかけると何も起こらない）
        this.gl.clearColor(1.0, 1.0, 1.0, 1.0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      }

      {
        const clipDrawCount = clipContext._clippingIdCount;
        for (let index = 0; index < clipDrawCount; index++) {
          const clipDrawIndex = clipContext._clippingIdList[index];

          // 頂点情報が更新されておらず、信頼性がない場合は描画をパスする
          if (
            !this.getModel().getDrawableDynamicFlagVertexPositionsDidChange(
              clipDrawIndex
            )
          ) {
            continue;
          }

          this.setIsCulling(
            this.getModel().getDrawableCulling(clipDrawIndex) != false
          );

          // 今回専用の変換を適用して描く
          // チャンネルも切り替える必要がある(A,R,G,B)
          this.setClippingContextBufferForMask(clipContext);

          this.drawMeshWebGL(this.getModel(), clipDrawIndex);
        }
      }

      {
        // --- 後処理 ---
        this.getOffscreenMaskBuffer(clipContext._bufferIndex).endDraw();
        this.setClippingContextBufferForMask(null);
        this.gl.viewport(
          0,
          0,
          this._modelRenderTargetWidth,
          this._modelRenderTargetHeight
        );

        this.preDraw(); // バッファをクリアする
      }
    }

    // クリッピングマスクをセットする
    this.setClippingContextBufferForOffscreen(clipContext);

    this.setIsCulling(this._model.getOffscreenCulling(offscreenIndex) != false);

    this.drawOffscreenWebGL(this.getModel(), offscreen);
  }

  /**
   * オフスクリーン描画のWebGL実装
   *
   * @param model モデル
   * @param index オフスクリーンインデックス
   */
  public drawOffscreenWebGL(
    model: Readonly<CubismModel>,
    offscreen: CubismOffscreenRenderTarget_WebGL
  ): void {
    // 裏面描画の有効・無効
    if (this.isCulling()) {
      this.gl.enable(this.gl.CULL_FACE);
    } else {
      this.gl.disable(this.gl.CULL_FACE);
    }

    this.gl.frontFace(this.gl.CCW); // Cubism SDK OpenGLはマスク・アートメッシュ共にCCWが表面

    CubismShaderManager_WebGL.getInstance()
      .getShader(this.gl)
      .setupShaderProgramForOffscreen(this, model, offscreen);

    offscreen.endDraw();
    this._currentOffscreen = this._currentOffscreen.getOldOffscreen();
    this._currentFbo = offscreen.getOldFBO();
    if (this._currentFbo == null) {
      this._currentOffscreen = this._modelRenderTargets[0];
      this._currentFbo = this._modelRenderTargets[0].getRenderTexture();
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this._currentFbo);
    }

    // ポリゴンメッシュを描画する
    {
      // インデックスバッファの作成とバインド
      const indexBuffer = this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      this.gl.bufferData(
        this.gl.ELEMENT_ARRAY_BUFFER,
        s_renderTargetIndexArray,
        this.gl.STATIC_DRAW
      );

      // 描画
      this.gl.drawElements(
        this.gl.TRIANGLES,
        s_renderTargetIndexArray.length,
        this.gl.UNSIGNED_SHORT,
        0
      );
      this.gl.deleteBuffer(indexBuffer);
    }

    // 後処理
    offscreen.stopUsingRenderTexture();
    this.gl.useProgram(null);
    this.setClippingContextBufferForMask(null);
    this.setClippingContextBufferForOffscreen(null);
  }

  /**
   * モデル描画直前のレンダラのステートを保持する
   */
  protected saveProfile(): void {
    this._rendererProfile.save();
  }

  /**
   * モデル描画直前のレンダラのステートを復帰させる
   */
  protected restoreProfile(): void {
    this._rendererProfile.restore();
  }

  /**
   * モデル描画直前のオフスクリーン設定を行う
   */
  public beforeDrawModelRenderTarget(): void {
    if (this._modelRenderTargets.length == 0) {
      return;
    }

    // オフスクリーンのバッファのサイズが違う場合は作り直し
    for (let i = 0; i < this._modelRenderTargets.length; ++i) {
      if (
        this._modelRenderTargets[i].getBufferWidth() !=
          this._modelRenderTargetWidth ||
        this._modelRenderTargets[i].getBufferHeight() !=
          this._modelRenderTargetHeight
      ) {
        this._modelRenderTargets[i].createRenderTarget(
          this.gl,
          this._modelRenderTargetWidth,
          this._modelRenderTargetHeight,
          this._currentFbo
        );
      }
    }

    // 別バッファに描画を開始
    this._modelRenderTargets[0].beginDraw();
    this._modelRenderTargets[0].clear(0.0, 0.0, 0.0, 0.0);
  }

  /**
   * モデル描画後のオフスクリーン設定を行う
   */
  public afterDrawModelRenderTarget(): void {
    if (this._modelRenderTargets.length == 0) {
      return;
    }

    // 元のバッファに描画する
    this._modelRenderTargets[0].endDraw();

    CubismShaderManager_WebGL.getInstance()
      .getShader(this.gl)
      .setupShaderProgramForOffscreenRenderTarget(this);

    if (
      CubismShaderManager_WebGL.getInstance().getShader(this.gl)._isShaderLoaded
    ) {
      // インデックスバッファの作成とバインド
      const indexBuffer = this.gl.createBuffer();
      this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      this.gl.bufferData(
        this.gl.ELEMENT_ARRAY_BUFFER,
        s_renderTargetIndexArray,
        this.gl.STATIC_DRAW
      );

      // 描画
      this.gl.drawElements(
        this.gl.TRIANGLES,
        s_renderTargetIndexArray.length,
        this.gl.UNSIGNED_SHORT,
        0
      );
      this.gl.deleteBuffer(indexBuffer);
    }

    this.gl.useProgram(null);
  }

  /**
   * オフスクリーンのクリッピングマスクのバッファを取得する
   *
   * @param index オフスクリーンのクリッピングマスクのバッファのインデックス
   *
   * @return オフスクリーンのクリッピングマスクのバッファへのポインタ
   */
  getOffscreenMaskBuffer(index: number): CubismRenderTarget_WebGL {
    return this._offscreenMasks[index];
  }

  /**
   * レンダラが保持する静的なリソースを解放する
   * WebGLの静的なシェーダープログラムを解放する
   */
  public static doStaticRelease(): void {
    CubismShaderManager_WebGL.deleteInstance();
  }

  /**
   * レンダーステートを設定する
   *
   * @param fbo アプリケーション側で指定しているフレームバッファ
   * @param viewport ビューポート
   */
  public setRenderState(fbo: WebGLFramebuffer, viewport: number[]): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fbo);
    this.gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);

    if (
      this._modelRenderTargetWidth != viewport[2] ||
      this._modelRenderTargetHeight != viewport[3]
    ) {
      this._modelRenderTargetWidth = viewport[2];
      this._modelRenderTargetHeight = viewport[3];
    }
  }

  /**
   * 描画開始時の追加処理
   * モデルを描画する前にクリッピングマスクに必要な処理を実装している
   */
  public preDraw(): void {
    this.gl.disable(this.gl.SCISSOR_TEST);
    this.gl.disable(this.gl.STENCIL_TEST);
    this.gl.disable(this.gl.DEPTH_TEST);

    // カリング（1.0beta3）
    this.gl.frontFace(this.gl.CW);

    this.gl.enable(this.gl.BLEND);
    this.gl.colorMask(true, true, true, true);

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null); // 前にバッファがバインドされていたら破棄する必要がある
    this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, null);

    // 異方性フィルタリングを適用する
    if (this.getAnisotropy() > 0.0 && this._extension) {
      for (let i = 0; i < this._textures.size; ++i) {
        this.gl.bindTexture(this.gl.TEXTURE_2D, this._textures.get(i));
        this.gl.texParameterf(
          this.gl.TEXTURE_2D,
          this._extension.TEXTURE_MAX_ANISOTROPY_EXT,
          this.getAnisotropy()
        );
      }
    }
  }

  /**
   * Drawableのマスク用のオフスクリーンサーフェースを取得する
   *
   * @param index オフスクリーンサーフェースのインデックス
   *
   * @return マスク用のオフスクリーンサーフェース
   */
  public getDrawableMaskBuffer(index: number): CubismRenderTarget_WebGL {
    return this._drawableMasks[index];
  }

  /**
   * マスクテクスチャに描画するクリッピングコンテキストをセットする
   */
  public setClippingContextBufferForMask(clip: CubismClippingContext_WebGL) {
    this._clippingContextBufferForMask = clip;
  }

  /**
   * マスクテクスチャに描画するクリッピングコンテキストを取得する
   *
   * @return マスクテクスチャに描画するクリッピングコンテキスト
   */
  public getClippingContextBufferForMask(): CubismClippingContext_WebGL {
    return this._clippingContextBufferForMask;
  }

  /**
   * Drawableの画面上に描画するクリッピングコンテキストをセットする
   *
   * @param clip drawableで画面上に描画するクリッピングコンテキスト
   */
  public setClippingContextBufferForDrawable(
    clip: CubismClippingContext_WebGL
  ): void {
    this._clippingContextBufferForDraw = clip;
  }

  /**
   * Drawableの画面上に描画するクリッピングコンテキストを取得する
   *
   * @return Drawableの画面上に描画するクリッピングコンテキスト
   */
  public getClippingContextBufferForDrawable(): CubismClippingContext_WebGL {
    return this._clippingContextBufferForDraw;
  }

  /**
   * offscreenで画面上に描画するクリッピングコンテキストをセットする。
   *
   * @param clip offscreenで画面上に描画するクリッピングコンテキスト
   */
  public setClippingContextBufferForOffscreen(
    clip: CubismClippingContext_WebGL
  ): void {
    this._clippingContextBufferForOffscreen = clip;
  }

  /**
   * offscreenで画面上に描画するクリッピングコンテキストを取得する。
   *
   * @return offscreenで画面上に描画するクリッピングコンテキスト
   */
  public getClippingContextBufferForOffscreen(): CubismClippingContext_WebGL {
    return this._clippingContextBufferForOffscreen;
  }

  /**
   * マスク生成時かを判定する
   *
   * @return 判定値
   */
  public isGeneratingMask() {
    return this.getClippingContextBufferForMask() != null;
  }

  /**
   * glの設定
   */
  public startUp(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.gl = gl;

    if (this._drawableClippingManager) {
      this._drawableClippingManager.setGL(gl);
    }

    if (this._offscreenClippingManager) {
      this._offscreenClippingManager.setGL(gl);
    }

    CubismShaderManager_WebGL.getInstance().setGlContext(gl);
    this._rendererProfile.setGl(gl);

    // 異方性フィルタリングが使用できるかチェック
    this._extension =
      this.gl.getExtension('EXT_texture_filter_anisotropic') ||
      this.gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
      this.gl.getExtension('MOZ_EXT_texture_filter_anisotropic');

    if (this._model.isUsingMasking()) {
      this._drawableMasks.length =
        this._drawableClippingManager.getRenderTextureCount();
      for (let i = 0; i < this._drawableMasks.length; ++i) {
        const renderTarget = new CubismRenderTarget_WebGL();
        renderTarget.createRenderTarget(
          this.gl,
          this._drawableClippingManager.getClippingMaskBufferSize(),
          this._drawableClippingManager.getClippingMaskBufferSize(),
          this._currentFbo
        );
        this._drawableMasks[i] = renderTarget;
      }
    }

    if (this._model.isBlendModeEnabled()) {
      // オフスクリーンの作成
      this._modelRenderTargets.length = 0;

      // TextureBarrierの代替用にオフスクリーンを2つ作成する
      const createSize = 3;
      this._modelRenderTargets.length = createSize;
      for (let i = 0; i < createSize; ++i) {
        const offscreenRenderTarget: CubismOffscreenRenderTarget_WebGL =
          new CubismOffscreenRenderTarget_WebGL();
        offscreenRenderTarget.createRenderTarget(
          this.gl,
          this._modelRenderTargetWidth,
          this._modelRenderTargetHeight,
          this._currentFbo
        );
        this._modelRenderTargets[i] = offscreenRenderTarget;
      }

      if (this._model.isUsingMaskingForOffscreen()) {
        this._offscreenMasks.length =
          this._offscreenClippingManager.getRenderTextureCount();
        for (let i = 0; i < this._offscreenMasks.length; ++i) {
          const offscreenMask = new CubismRenderTarget_WebGL();
          offscreenMask.createRenderTarget(
            this.gl,
            this._offscreenClippingManager.getClippingMaskBufferSize(),
            this._offscreenClippingManager.getClippingMaskBufferSize(),
            this._currentFbo
          );
          this._offscreenMasks[i] = offscreenMask;
        }
      }

      const offscreenCount = this._model.getOffscreenCount();
      // オフスクリーンの数が0の場合は何もしない
      if (offscreenCount > 0) {
        this._offscreenList = new Array<CubismOffscreenRenderTarget_WebGL>(
          offscreenCount
        );
        for (
          let offscreenIndex = 0;
          offscreenIndex < offscreenCount;
          ++offscreenIndex
        ) {
          const offscreenRenderTarget = new CubismOffscreenRenderTarget_WebGL();
          offscreenRenderTarget.setOffscreenIndex(offscreenIndex);
          this._offscreenList[offscreenIndex] = offscreenRenderTarget;
        }

        // 全てのオフスクリーンを登録し終わってから行う
        this.setupParentOffscreens(this._model, offscreenCount);
      }
    }

    // 描画対象を初期状態に戻す
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this._currentFbo);
  }

  _textures: Map<number, WebGLTexture>; // モデルが参照するテクスチャとレンダラでバインドしているテクスチャとのマップ
  _sortedObjectsIndexList: Array<number>; // 描画オブジェクトのインデックスを描画順に並べたリスト
  _sortedObjectsTypeList: Array<number>; // 描画オブジェクトのオブジェクトタイプを描画順に並べたリスト
  _rendererProfile: CubismRendererProfile_WebGL;
  _drawableClippingManager: CubismClippingManager_WebGL; // クリッピングマスク管理オブジェクト
  _clippingContextBufferForMask: CubismClippingContext_WebGL; // マスクテクスチャに描画するためのクリッピングコンテキスト
  _clippingContextBufferForDraw: CubismClippingContext_WebGL; // 画面上描画するためのクリッピングコンテキスト
  _clippingContextBufferForOffscreen: CubismClippingContext_WebGL; // オフスクリーン描画用のクリッピングコンテキスト
  _offscreenClippingManager: CubismClippingManager_WebGL; // オフスクリーン描画用のクリッピングマスク管理オブジェクト

  _modelRenderTargets: Array<CubismOffscreenRenderTarget_WebGL>; ///< モデル全体を描画する先のフレームバッファ

  _drawableMasks: Array<CubismRenderTarget_WebGL>; // マスク用のオフスクリーンサーフェースのリスト
  _offscreenMasks: Array<CubismRenderTarget_WebGL>; ///< オフスクリーン機能マスク描画用のフレームバッファ

  _offscreenList: Array<CubismOffscreenRenderTarget_WebGL>; ///< モデルのオフスクリーン
  _currentFbo: WebGLFramebuffer; ///< 現在のフレームバッファオブジェクト
  _currentOffscreen: CubismOffscreenRenderTarget_WebGL | null; // 現在のオフスクリーン

  _modelRootFbo: WebGLFramebuffer; // モデルのルートフレームバッファ

  _bufferData: {
    vertex: WebGLBuffer;
    uv: WebGLBuffer;
    index: WebGLBuffer;
  }; // 頂点バッファデータ
  _extension: any; // 拡張機能
  gl: WebGLRenderingContext | WebGL2RenderingContext; // webglコンテキスト
}

/**
 * レンダラが保持する静的なリソースを開放する
 */
CubismRenderer.staticRelease = (): void => {
  CubismRenderer_WebGL.doStaticRelease();
};

// Namespace definition for compatibility.
import * as $ from './cubismrenderer_webgl';
import { CubismRenderTarget_WebGL as CubismRenderTarget_WebGL } from './cubismrendertarget_webgl';
import { CubismOffscreenRenderTarget_WebGL as CubismOffscreenRenderTarget_WebGL } from './cubismoffscreenrendertarget_webgl';
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Live2DCubismFramework {
  export const CubismClippingContext = $.CubismClippingContext_WebGL;
  export type CubismClippingContext = $.CubismClippingContext_WebGL;
  export const CubismClippingManager_WebGL = $.CubismClippingManager_WebGL;
  export type CubismClippingManager_WebGL = $.CubismClippingManager_WebGL;
  export const CubismRenderer_WebGL = $.CubismRenderer_WebGL;
  export type CubismRenderer_WebGL = $.CubismRenderer_WebGL;
}
