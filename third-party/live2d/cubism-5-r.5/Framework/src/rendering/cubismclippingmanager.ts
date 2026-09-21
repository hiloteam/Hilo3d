/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { Constant } from '../live2dcubismframework';
import { csmRect } from '../type/csmrectf';
import { CubismMatrix44 } from '../math/cubismmatrix44';
import { CubismModel } from '../model/cubismmodel';
import { CubismClippingContext, CubismTextureColor } from './cubismrenderer';
import { CubismLogError, CubismLogWarning } from '../utils/cubismdebug';

const ColorChannelCount = 4; // 実験時に1チャンネルの場合は1、RGBだけの場合は3、アルファも含める場合は4
const ClippingMaskMaxCountOnDefault = 36; // 通常のフレームバッファ一枚あたりのマスク最大数
const ClippingMaskMaxCountOnMultiRenderTexture = 32; // フレームバッファが2枚以上ある場合のフレームバッファ一枚あたりのマスク最大数

export type ClippingContextConstructor<
  T_ClippingContext extends CubismClippingContext
> = new (
  manager: CubismClippingManager<T_ClippingContext>,
  drawableMasks: Int32Array,
  drawableMaskCounts: number
) => T_ClippingContext;

export interface ICubismClippingManager {
  getClippingMaskBufferSize(): number;
}

export abstract class CubismClippingManager<
  T_ClippingContext extends CubismClippingContext
> implements ICubismClippingManager {
  /**
   * コンストラクタ
   */
  public constructor(
    clippingContextFactory: ClippingContextConstructor<T_ClippingContext>
  ) {
    this._renderTextureCount = 0;
    this._clippingMaskBufferSize = 256;
    this._clippingContextListForMask = new Array<T_ClippingContext>();
    this._clippingContextListForDraw = new Array<T_ClippingContext>();
    this._clippingContextListForOffscreen = new Array<T_ClippingContext>();
    this._tmpBoundsOnModel = new csmRect();
    this._tmpMatrix = new CubismMatrix44();
    this._tmpMatrixForMask = new CubismMatrix44();
    this._tmpMatrixForDraw = new CubismMatrix44();
    this._clearedMaskBufferFlags = new Array<boolean>();

    this._clippingContexttConstructor = clippingContextFactory;

    this._channelColors = [
      new CubismTextureColor(1.0, 0.0, 0.0, 0.0),
      new CubismTextureColor(0.0, 1.0, 0.0, 0.0),
      new CubismTextureColor(0.0, 0.0, 1.0, 0.0),
      new CubismTextureColor(0.0, 0.0, 0.0, 1.0)
    ];
  }

  /**
   * デストラクタ相当の処理
   */
  public release(): void {
    for (let i = 0; i < this._clippingContextListForMask.length; i++) {
      if (this._clippingContextListForMask[i]) {
        this._clippingContextListForMask[i].release();
        this._clippingContextListForMask[i] = void 0;
      }
      this._clippingContextListForMask[i] = null;
    }
    this._clippingContextListForMask = null;

    // _clippingContextListForDrawは_clippingContextListForMaskにあるインスタンスを指している。上記の処理により要素ごとのDELETEは不要。
    for (let i = 0; i < this._clippingContextListForDraw.length; i++) {
      this._clippingContextListForDraw[i] = null;
    }
    this._clippingContextListForDraw = null;

    for (let i = 0; i < this._channelColors.length; i++) {
      this._channelColors[i] = null;
    }

    this._channelColors = null;

    if (this._clearedMaskBufferFlags != null) {
      this._clearedMaskBufferFlags.length = 0;
    }
    this._clearedMaskBufferFlags = null;
  }

  /**
   * マネージャの初期化処理
   * クリッピングマスクを使う描画オブジェクトの登録を行う
   * @param model モデルのインスタンス
   * @param renderTextureCount バッファの生成数
   */
  public initializeForDrawable(
    model: CubismModel,
    renderTextureCount: number
  ): void {
    // レンダーテクスチャの合計枚数の設定
    // 1以上の整数でない場合はそれぞれ警告を出す
    if (renderTextureCount % 1 != 0) {
      CubismLogWarning(
        'The number of render textures must be specified as an integer. The decimal point is rounded down and corrected to an integer.'
      );
      // 小数点以下を除去
      renderTextureCount = ~~renderTextureCount;
    }
    if (renderTextureCount < 1) {
      CubismLogWarning(
        'The number of render textures must be an integer greater than or equal to 1. Set the number of render textures to 1.'
      );
    }
    // 負の値が使われている場合は強制的に1枚と設定する
    this._renderTextureCount = renderTextureCount < 1 ? 1 : renderTextureCount;

    this._clearedMaskBufferFlags = new Array<boolean>(this._renderTextureCount);

    // クリッピングマスクを使う描画オブジェクトをすべて登録する
    // クリッピングマスクは、通常数個程度に限定して使うものとする
    this._clippingContextListForDraw.length = model.getDrawableCount();
    for (let i = 0; i < model.getDrawableCount(); i++) {
      if (model.getDrawableMaskCounts()[i] <= 0) {
        // クリッピングマスクが使用されていないアートメッシュ（多くの場合使用しない）
        this._clippingContextListForDraw[i] = null;
        continue;
      }

      // 既にあるClipContextと同じかチェックする
      let clippingContext: T_ClippingContext = this.findSameClip(
        model.getDrawableMasks()[i],
        model.getDrawableMaskCounts()[i]
      );
      if (clippingContext == null) {
        // 同一のマスクが存在していない場合は生成する

        clippingContext = new this._clippingContexttConstructor(
          this,
          model.getDrawableMasks()[i],
          model.getDrawableMaskCounts()[i]
        );
        this._clippingContextListForMask.push(clippingContext);
      }

      clippingContext.addClippedDrawable(i);

      this._clippingContextListForDraw[i] = clippingContext;
    }
  }

  /**
   * オフスクリーン用の初期化処理
   *
   * @param model モデルのインスタンス
   * @param maskBufferCount オフスクリーン用のマスクバッファの数
   */
  public initializeForOffscreen(
    model: CubismModel,
    maskBufferCount: number
  ): void {
    this._renderTextureCount = maskBufferCount;

    // レンダーテクスチャのクリアフラグの設定
    this._clearedMaskBufferFlags.length = this._renderTextureCount;
    for (let i = 0; i < this._renderTextureCount; ++i) {
      this._clearedMaskBufferFlags[i] = false;
    }

    //クリッピングマスクを使う描画オブジェクトを全て登録する
    //クリッピングマスクは、通常数個程度に限定して使うものとする
    this._clippingContextListForOffscreen.length = model.getOffscreenCount();
    for (let i = 0; i < model.getOffscreenCount(); ++i) {
      if (model.getOffscreenMaskCounts()[i] <= 0) {
        //クリッピングマスクが使用されていないオフスクリーン（多くの場合使用しない）
        this._clippingContextListForOffscreen.push(null);
        continue;
      }

      // 既にあるClipContextと同じかチェックする
      let cc = this.findSameClip(
        model.getOffscreenMasks()[i],
        model.getOffscreenMaskCounts()[i]
      );
      if (cc == null) {
        // 同一のマスクが存在していない場合は生成する
        cc = new this._clippingContexttConstructor(
          this,
          model.getOffscreenMasks()[i],
          model.getOffscreenMaskCounts()[i]
        );
        this._clippingContextListForMask.push(cc);
      }

      cc.addClippedOffscreen(i);

      this._clippingContextListForOffscreen[i] = cc;
    }
  }

  /**
   * 既にマスクを作っているかを確認
   * 作っている様であれば該当するクリッピングマスクのインスタンスを返す
   * 作っていなければNULLを返す
   * @param drawableMasks 描画オブジェクトをマスクする描画オブジェクトのリスト
   * @param drawableMaskCounts 描画オブジェクトをマスクする描画オブジェクトの数
   * @return 該当するクリッピングマスクが存在すればインスタンスを返し、なければNULLを返す
   */
  public findSameClip(
    drawableMasks: Int32Array,
    drawableMaskCounts: number
  ): T_ClippingContext {
    // 作成済みClippingContextと一致するか確認
    for (let i = 0; i < this._clippingContextListForMask.length; i++) {
      const clippingContext: T_ClippingContext =
        this._clippingContextListForMask[i];
      const count: number = clippingContext._clippingIdCount;

      // 個数が違う場合は別物
      if (count != drawableMaskCounts) {
        continue;
      }

      let sameCount = 0;

      // 同じIDを持つか確認。配列の数が同じなので、一致した個数が同じなら同じ物を持つとする
      for (let j = 0; j < count; j++) {
        const clipId: number = clippingContext._clippingIdList[j];

        for (let k = 0; k < count; k++) {
          if (drawableMasks[k] == clipId) {
            sameCount++;
            break;
          }
        }
      }

      if (sameCount == count) {
        return clippingContext;
      }
    }

    return null; // 見つからなかった
  }

  /**
   * 高精細マスク処理用の行列を計算する
   * @param model モデルのインスタンス
   * @param isRightHanded 処理が右手系であるか
   */
  public setupMatrixForHighPrecision(
    model: CubismModel,
    isRightHanded: boolean
  ): void {
    // 全てのクリッピングを用意する
    // 同じクリップ（複数の場合はまとめて一つのクリップ）を使う場合は1度だけ設定する
    let usingClipCount = 0;
    for (
      let clipIndex = 0;
      clipIndex < this._clippingContextListForMask.length;
      clipIndex++
    ) {
      // １つのクリッピングマスクに関して
      const cc: T_ClippingContext = this._clippingContextListForMask[clipIndex];

      // このクリップを利用する描画オブジェクト群全体を囲む矩形を計算
      this.calcClippedDrawableTotalBounds(model, cc);

      if (cc._isUsing) {
        usingClipCount++; // 使用中としてカウント
      }
    }

    // マスク行列作成処理
    if (usingClipCount > 0) {
      this.setupLayoutBounds(0);

      // サイズがレンダーテクスチャの枚数と合わない場合は合わせる
      if (this._clearedMaskBufferFlags.length != this._renderTextureCount) {
        this._clearedMaskBufferFlags.length = this._renderTextureCount;
        for (let i = 0; i < this._renderTextureCount; i++) {
          this._clearedMaskBufferFlags[i] = false;
        }
      } else {
        // マスクのクリアフラグを毎フレーム開始時に初期化
        for (let i = 0; i < this._renderTextureCount; i++) {
          this._clearedMaskBufferFlags[i] = false;
        }
      }

      // 実際にマスクを生成する
      // 全てのマスクをどの様にレイアウトして描くかを決定し、ClipContext , ClippedDrawContext に記憶する
      for (
        let clipIndex = 0;
        clipIndex < this._clippingContextListForMask.length;
        clipIndex++
      ) {
        // --- 実際に１つのマスクを描く ---
        const clipContext: T_ClippingContext =
          this._clippingContextListForMask[clipIndex];
        const allClippedDrawRect: csmRect = clipContext._allClippedDrawRect; //このマスクを使う、全ての描画オブジェクトの論理座標上の囲み矩形
        const layoutBoundsOnTex01 = clipContext._layoutBounds; //この中にマスクを収める
        const margin = 0.05;
        let scaleX = 0.0;
        let scaleY = 0.0;
        const ppu: number = model.getPixelsPerUnit();
        const maskPixelSize: number = clipContext
          .getClippingManager()
          .getClippingMaskBufferSize();
        const physicalMaskWidth: number =
          layoutBoundsOnTex01.width * maskPixelSize;
        const physicalMaskHeight: number =
          layoutBoundsOnTex01.height * maskPixelSize;

        this._tmpBoundsOnModel.setRect(allClippedDrawRect);
        if (this._tmpBoundsOnModel.width * ppu > physicalMaskWidth) {
          this._tmpBoundsOnModel.expand(allClippedDrawRect.width * margin, 0.0);
          scaleX = layoutBoundsOnTex01.width / this._tmpBoundsOnModel.width;
        } else {
          scaleX = ppu / physicalMaskWidth;
        }

        if (this._tmpBoundsOnModel.height * ppu > physicalMaskHeight) {
          this._tmpBoundsOnModel.expand(
            0.0,
            allClippedDrawRect.height * margin
          );
          scaleY = layoutBoundsOnTex01.height / this._tmpBoundsOnModel.height;
        } else {
          scaleY = ppu / physicalMaskHeight;
        }

        // マスク生成時に使う行列を求める
        this.createMatrixForMask(
          isRightHanded,
          layoutBoundsOnTex01,
          scaleX,
          scaleY
        );

        clipContext._matrixForMask.setMatrix(this._tmpMatrixForMask.getArray());
        clipContext._matrixForDraw.setMatrix(this._tmpMatrixForDraw.getArray());
      }
    }
  }

  /**
   * オフスクリーンの高精細マスク処理用の行列を計算する
   *
   * @param model モデルのインスタンス
   * @param isRightHanded 処理が右手系であるか
   * @param mvp モデルビュー投影行列
   */
  public setupMatrixForOffscreenHighPrecision(
    model: CubismModel,
    isRightHanded: boolean,
    mvp: CubismMatrix44
  ): void {
    // 全てのクリッピングを用意する
    // 同じクリップ（複数の場合はまとめて１つのクリップ）を使う場合は１度だけ設定する
    let usingClipCount = 0;
    for (
      let clipIndex = 0;
      clipIndex < this._clippingContextListForMask.length;
      clipIndex++
    ) {
      // １つのクリッピングマスクに関して
      const cc: T_ClippingContext = this._clippingContextListForMask[clipIndex];

      // このクリップを利用する描画オブジェクト群全体を囲む矩形を計算
      this.calcClippedOffscreenTotalBounds(model, cc);

      if (cc._isUsing) {
        usingClipCount++; //使用中としてカウント
      }
    }

    if (usingClipCount <= 0) {
      return;
    }
    // マスク行列作成処理
    this.setupLayoutBounds(0);

    // サイズがレンダーテクスチャの枚数と合わない場合は合わせる
    if (this._clearedMaskBufferFlags.length != this._renderTextureCount) {
      this._clearedMaskBufferFlags.length = this._renderTextureCount;

      for (let i = 0; i < this._renderTextureCount; ++i) {
        this._clearedMaskBufferFlags[i] = false;
      }
    } else {
      // マスクのクリアフラグを毎フレーム開始時に初期化
      for (let i = 0; i < this._renderTextureCount; ++i) {
        this._clearedMaskBufferFlags[i] = false;
      }
    }

    // 実際にマスクを生成する
    // 全てのマスクをどの様にレイアウトして描くかを決定し、ClipContext , ClippedDrawContext に記憶する
    for (
      let clipIndex = 0;
      clipIndex < this._clippingContextListForMask.length;
      clipIndex++
    ) {
      // --- 実際に１つのマスクを描く ---
      const clipContext = this._clippingContextListForMask[clipIndex];
      const allClippedDrawRect = clipContext._allClippedDrawRect; //このマスクを使う、全ての描画オブジェクトの論理座標上の囲み矩形
      const layoutBoundsOnTex01 = clipContext._layoutBounds; //この中にマスクを収める
      const margin = 0.05;
      let scaleX = 0.0;
      let scaleY = 0.0;
      const ppu = model.getPixelsPerUnit();
      const maskPixel = clipContext
        .getClippingManager()
        .getClippingMaskBufferSize();
      const physicalMaskWidth = layoutBoundsOnTex01.width * maskPixel;
      const physicalMaskHeight = layoutBoundsOnTex01.height * maskPixel;

      this._tmpBoundsOnModel.setRect(allClippedDrawRect);
      if (this._tmpBoundsOnModel.width * ppu > physicalMaskWidth) {
        this._tmpBoundsOnModel.expand(allClippedDrawRect.width * margin, 0.0);
        scaleX = layoutBoundsOnTex01.width / this._tmpBoundsOnModel.width;
      } else {
        scaleX = ppu / physicalMaskWidth;
      }

      if (this._tmpBoundsOnModel.height * ppu > physicalMaskHeight) {
        this._tmpBoundsOnModel.expand(0.0, allClippedDrawRect.height * margin);
        scaleY = layoutBoundsOnTex01.height / this._tmpBoundsOnModel.height;
      } else {
        scaleY = ppu / physicalMaskHeight;
      }

      // マスク生成時に使う行列を求める
      this.createMatrixForMask(
        isRightHanded,
        layoutBoundsOnTex01,
        scaleX,
        scaleY
      );

      clipContext._matrixForMask.setMatrix(this._tmpMatrixForMask.getArray());
      clipContext._matrixForDraw.setMatrix(this._tmpMatrixForDraw.getArray());

      // clipContext * mvp^-1
      const invertMvp = mvp.getInvert();
      clipContext._matrixForDraw.multiplyByMatrix(invertMvp);
    }
  }

  /**
   * マスクを使う描画オブジェクトの全体の矩形を計算する。
   *
   * @param model モデルのインスタンス
   * @param clippingContext クリッピングコンテキスト
   */
  public calcClippedOffscreenTotalBounds(
    model: CubismModel,
    clippingContext: T_ClippingContext
  ): void {
    // 被クリッピングマスク（マスクされる描画オブジェクト）の全体の矩形
    let clippedDrawTotalMinX = Number.MAX_VALUE,
      clippedDrawTotalMinY = Number.MAX_VALUE;
    let clippedDrawTotalMaxX = -Number.MAX_VALUE,
      clippedDrawTotalMaxY = -Number.MAX_VALUE;

    // このマスクが実際に必要か判定する
    // このクリッピングを利用する「描画オブジェクト」がひとつでも使用可能であればマスクを生成する必要がある
    const clippedOffscreenCount =
      clippingContext._clippedOffscreenIndexList.length;

    const clippedOffscreenChildDrawableIndexList = new Array<number>();
    for (
      let clippedOffscreenIndex = 0;
      clippedOffscreenIndex < clippedOffscreenCount;
      clippedOffscreenIndex++
    ) {
      // マスクを使用する描画オブジェクトの描画される矩形を求める
      const offscreenIndex =
        clippingContext._clippedOffscreenIndexList[clippedOffscreenIndex];

      this.getOffscreenChildDrawableIndexList(
        model,
        offscreenIndex,
        clippedOffscreenChildDrawableIndexList
      );
    }

    const childDrawableCount = clippedOffscreenChildDrawableIndexList.length;
    for (
      let childDrawableIndex = 0;
      childDrawableIndex < childDrawableCount;
      childDrawableIndex++
    ) {
      const drawableVertexCount = model.getDrawableVertexCount(
        clippedOffscreenChildDrawableIndexList[childDrawableIndex]
      );
      const drawableVertexes = model.getDrawableVertices(
        clippedOffscreenChildDrawableIndexList[childDrawableIndex]
      );

      let minX = Number.MAX_VALUE,
        minY = Number.MAX_VALUE;
      let maxX = -Number.MAX_VALUE,
        maxY = -Number.MAX_VALUE;

      const loop = drawableVertexCount * Constant.vertexStep;
      for (
        let pi = Constant.vertexOffset;
        pi < loop;
        pi += Constant.vertexStep
      ) {
        const x = drawableVertexes[pi];
        const y = drawableVertexes[pi + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      if (minX == Number.MAX_VALUE) continue; //有効な点がひとつも取れなかったのでスキップする

      // 全体の矩形に反映
      if (minX < clippedDrawTotalMinX) clippedDrawTotalMinX = minX;
      if (minY < clippedDrawTotalMinY) clippedDrawTotalMinY = minY;
      if (maxX > clippedDrawTotalMaxX) clippedDrawTotalMaxX = maxX;
      if (maxY > clippedDrawTotalMaxY) clippedDrawTotalMaxY = maxY;
    }

    if (clippedDrawTotalMinX == Number.MAX_VALUE) {
      clippingContext._allClippedDrawRect.x = 0.0;
      clippingContext._allClippedDrawRect.y = 0.0;
      clippingContext._allClippedDrawRect.width = 0.0;
      clippingContext._allClippedDrawRect.height = 0.0;
      clippingContext._isUsing = false;
    } else {
      clippingContext._isUsing = true;
      const w = clippedDrawTotalMaxX - clippedDrawTotalMinX;
      const h = clippedDrawTotalMaxY - clippedDrawTotalMinY;
      clippingContext._allClippedDrawRect.x = clippedDrawTotalMinX;
      clippingContext._allClippedDrawRect.y = clippedDrawTotalMinY;
      clippingContext._allClippedDrawRect.width = w;
      clippingContext._allClippedDrawRect.height = h;
    }
  }

  /**
   * マスクを使う描画オブジェクトの全体の矩形を計算する。
   *
   * @param model モデルのインスタンス
   * @param offscreenIndex オフスクリーンのインデックス
   * @param childDrawableIndexList オフスクリーンの子Drawableのインデックスリスト
   */
  public getOffscreenChildDrawableIndexList(
    model: CubismModel,
    offscreenIndex: number,
    childDrawableIndexList: Array<number>
  ): void {
    // 親オブジェクトを取得
    const ownerIndex = model.getOffscreenOwnerIndices()[offscreenIndex];

    // パーツのみ
    this.getPartChildDrawableIndexList(
      model,
      ownerIndex,
      childDrawableIndexList
    );
  }

  /**
   * パーツの子Drawableのインデックスリストを取得する。
   *
   * @param model モデルのインスタンス
   * @param partIndex パーツのインデックス
   * @param childDrawableIndexList パーツの子Drawableのインデックスリスト
   */
  public getPartChildDrawableIndexList(
    model: CubismModel,
    partIndex: number,
    childDrawableIndexList: Array<number>
  ): void {
    const childDrawObjects =
      model.getPartsHierarchy()[partIndex].childDrawObjects;
    childDrawableIndexList.push(...childDrawObjects.drawableIndices);

    for (let i = 0; i < childDrawObjects.offscreenIndices.length; ++i) {
      this.getOffscreenChildDrawableIndexList(
        model,
        childDrawObjects.offscreenIndices[i],
        childDrawableIndexList
      );
    }
  }

  /**
   * マスク作成・描画用の行列を作成する。
   * @param isRightHanded 座標を右手系として扱うかを指定
   * @param layoutBoundsOnTex01 マスクを収める領域
   * @param scaleX 描画オブジェクトの伸縮率
   * @param scaleY 描画オブジェクトの伸縮率
   */
  public createMatrixForMask(
    isRightHanded: boolean,
    layoutBoundsOnTex01: csmRect,
    scaleX: number,
    scaleY: number
  ): void {
    this._tmpMatrix.loadIdentity();
    {
      // Layout0..1 を -1..1に変換
      this._tmpMatrix.translateRelative(-1.0, -1.0);
      this._tmpMatrix.scaleRelative(2.0, 2.0);
    }
    {
      // view to Layout0..1
      this._tmpMatrix.translateRelative(
        layoutBoundsOnTex01.x,
        layoutBoundsOnTex01.y
      ); //new = [translate]
      this._tmpMatrix.scaleRelative(scaleX, scaleY); //new = [translate][scale]
      this._tmpMatrix.translateRelative(
        -this._tmpBoundsOnModel.x,
        -this._tmpBoundsOnModel.y
      ); //new = [translate][scale][translate]
    }
    // tmpMatrixForMask が計算結果
    this._tmpMatrixForMask.setMatrix(this._tmpMatrix.getArray());

    this._tmpMatrix.loadIdentity();
    {
      this._tmpMatrix.translateRelative(
        layoutBoundsOnTex01.x,
        layoutBoundsOnTex01.y * (isRightHanded ? -1.0 : 1.0)
      ); //new = [translate]
      this._tmpMatrix.scaleRelative(
        scaleX,
        scaleY * (isRightHanded ? -1.0 : 1.0)
      ); //new = [translate][scale]
      this._tmpMatrix.translateRelative(
        -this._tmpBoundsOnModel.x,
        -this._tmpBoundsOnModel.y
      ); //new = [translate][scale][translate]
    }

    this._tmpMatrixForDraw.setMatrix(this._tmpMatrix.getArray());
  }

  /**
   * クリッピングコンテキストを配置するレイアウト
   * 指定された数のレンダーテクスチャを極力いっぱいに使ってマスクをレイアウトする
   * マスクグループの数が4以下ならRGBA各チャンネルに一つずつマスクを配置し、5以上6以下ならRGBAを2,2,1,1と配置する。
   *
   * @param usingClipCount 配置するクリッピングコンテキストの数
   */
  public setupLayoutBounds(usingClipCount: number): void {
    const useClippingMaskMaxCount =
      this._renderTextureCount <= 1
        ? ClippingMaskMaxCountOnDefault
        : ClippingMaskMaxCountOnMultiRenderTexture * this._renderTextureCount;

    if (usingClipCount <= 0 || usingClipCount > useClippingMaskMaxCount) {
      if (usingClipCount > useClippingMaskMaxCount) {
        // マスクの制限数の警告を出す
        CubismLogError(
          'not supported mask count : {0}\n[Details] render texture count : {1}, mask count : {2}',
          usingClipCount - useClippingMaskMaxCount,
          this._renderTextureCount,
          usingClipCount
        );
      }
      // この場合は一つのマスクターゲットを毎回クリアして使用する
      for (
        let index = 0;
        index < this._clippingContextListForMask.length;
        index++
      ) {
        const clipContext: T_ClippingContext =
          this._clippingContextListForMask[index];
        clipContext._layoutChannelIndex = 0; // どうせ毎回消すので固定
        clipContext._layoutBounds.x = 0.0;
        clipContext._layoutBounds.y = 0.0;
        clipContext._layoutBounds.width = 1.0;
        clipContext._layoutBounds.height = 1.0;
        clipContext._bufferIndex = 0;
      }
      return;
    }

    // レンダーテクスチャが1枚なら9分割する（最大36枚）
    const layoutCountMaxValue = this._renderTextureCount <= 1 ? 9 : 8;

    // 指定された数のレンダーテクスチャを極力いっぱいに使ってマスクをレイアウトする（デフォルトなら1）。
    // マスクグループの数が4以下ならRGBA各チャンネルに1つずつマスクを配置し、5以上6以下ならRGBAを2,2,1,1と配置する。
    let countPerSheetDiv: number = usingClipCount / this._renderTextureCount; // レンダーテクスチャ1枚あたり何枚割り当てるか。
    const reduceLayoutTextureCount: number =
      usingClipCount % this._renderTextureCount; // レイアウトの数を1枚減らすレンダーテクスチャの数（この数だけのレンダーテクスチャが対象）。

    // 1枚に割り当てるマスクの分割数を取りたいため、小数点は切り上げる
    countPerSheetDiv = Math.ceil(countPerSheetDiv);

    // RGBAを順番に使っていく
    let divCount: number = countPerSheetDiv / ColorChannelCount; // 1チャンネルに配置する基本のマスク
    const modCount: number = countPerSheetDiv % ColorChannelCount; // 余り、この番号のチャンネルまでに一つずつ配分する（インデックスではない）

    // 小数点は切り捨てる
    divCount = ~~divCount;

    // RGBAそれぞれのチャンネルを用意していく（0:R, 1:G, 2:B, 3:A）
    let curClipIndex = 0; // 順番に設定していく

    for (
      let renderTextureIndex = 0;
      renderTextureIndex < this._renderTextureCount;
      renderTextureIndex++
    ) {
      for (
        let channelIndex = 0;
        channelIndex < ColorChannelCount;
        channelIndex++
      ) {
        // このチャンネルにレイアウトする数
        // NOTE: レイアウト数 = 1チャンネルに配置する基本のマスク + 余りのマスクを置くチャンネルなら1つ追加
        let layoutCount: number = divCount + (channelIndex < modCount ? 1 : 0);

        // レイアウトの数を1枚減らす場合にそれを行うチャンネルを決定
        // divが0の時は正常なインデックスの範囲内になるように調整
        const checkChannelIndex = modCount + (divCount < 1 ? -1 : 0);

        // 今回が対象のチャンネルかつ、レイアウトの数を1枚減らすレンダーテクスチャが存在する場合
        if (channelIndex == checkChannelIndex && reduceLayoutTextureCount > 0) {
          // 現在のレンダーテクスチャが、対象のレンダーテクスチャであればレイアウトの数を1枚減らす。
          layoutCount -= !(renderTextureIndex < reduceLayoutTextureCount)
            ? 1
            : 0;
        }

        // 分割方法を決定する
        if (layoutCount == 0) {
          // 何もしない
        } else if (layoutCount == 1) {
          // 全てをそのまま使う
          const clipContext: T_ClippingContext =
            this._clippingContextListForMask[curClipIndex++];
          clipContext._layoutChannelIndex = channelIndex;
          clipContext._layoutBounds.x = 0.0;
          clipContext._layoutBounds.y = 0.0;
          clipContext._layoutBounds.width = 1.0;
          clipContext._layoutBounds.height = 1.0;
          clipContext._bufferIndex = renderTextureIndex;
        } else if (layoutCount == 2) {
          for (let i = 0; i < layoutCount; i++) {
            let xpos: number = i % 2;

            // 小数点は切り捨てる
            xpos = ~~xpos;

            const cc: T_ClippingContext =
              this._clippingContextListForMask[curClipIndex++];
            cc._layoutChannelIndex = channelIndex;

            // UVを2つに分解して使う
            cc._layoutBounds.x = xpos * 0.5;
            cc._layoutBounds.y = 0.0;
            cc._layoutBounds.width = 0.5;
            cc._layoutBounds.height = 1.0;
            cc._bufferIndex = renderTextureIndex;
          }
        } else if (layoutCount <= 4) {
          // 4分割して使う
          for (let i = 0; i < layoutCount; i++) {
            let xpos: number = i % 2;
            let ypos: number = i / 2;

            // 小数点は切り捨てる
            xpos = ~~xpos;
            ypos = ~~ypos;

            const cc = this._clippingContextListForMask[curClipIndex++];
            cc._layoutChannelIndex = channelIndex;

            cc._layoutBounds.x = xpos * 0.5;
            cc._layoutBounds.y = ypos * 0.5;
            cc._layoutBounds.width = 0.5;
            cc._layoutBounds.height = 0.5;
            cc._bufferIndex = renderTextureIndex;
          }
        } else if (layoutCount <= layoutCountMaxValue) {
          // 9分割して使う
          for (let i = 0; i < layoutCount; i++) {
            let xpos = i % 3;
            let ypos = i / 3;

            // 小数点は切り捨てる
            xpos = ~~xpos;
            ypos = ~~ypos;

            const cc: T_ClippingContext =
              this._clippingContextListForMask[curClipIndex++];
            cc._layoutChannelIndex = channelIndex;

            cc._layoutBounds.x = xpos / 3.0;
            cc._layoutBounds.y = ypos / 3.0;
            cc._layoutBounds.width = 1.0 / 3.0;
            cc._layoutBounds.height = 1.0 / 3.0;
            cc._bufferIndex = renderTextureIndex;
          }
        } else {
          // マスクの制限枚数を超えた場合の処理
          CubismLogError(
            'not supported mask count : {0}\n[Details] render texture count : {1}, mask count : {2}',
            usingClipCount - useClippingMaskMaxCount,
            this._renderTextureCount,
            usingClipCount
          );

          // SetupShaderProgramでオーバーアクセスが発生するので仮で数値を入れる
          // もちろん描画結果は正しいものではなくなる
          for (let index = 0; index < layoutCount; index++) {
            const cc: T_ClippingContext =
              this._clippingContextListForMask[curClipIndex++];

            cc._layoutChannelIndex = 0;

            cc._layoutBounds.x = 0.0;
            cc._layoutBounds.y = 0.0;
            cc._layoutBounds.width = 1.0;
            cc._layoutBounds.height = 1.0;
            cc._bufferIndex = 0;
          }
        }
      }
    }
  }

  /**
   * マスクされる描画オブジェクト群全体を囲む矩形（モデル座標系）を計算する
   * @param model モデルのインスタンス
   * @param clippingContext クリッピングマスクのコンテキスト
   */
  public calcClippedDrawableTotalBounds(
    model: CubismModel,
    clippingContext: T_ClippingContext
  ): void {
    // 被クリッピングマスク（マスクされる描画オブジェクト）の全体の矩形
    let clippedDrawTotalMinX: number = Number.MAX_VALUE;
    let clippedDrawTotalMinY: number = Number.MAX_VALUE;
    let clippedDrawTotalMaxX: number = Number.MIN_VALUE;
    let clippedDrawTotalMaxY: number = Number.MIN_VALUE;

    // このマスクが実際に必要か判定する
    // このクリッピングを利用する「描画オブジェクト」がひとつでも使用可能であればマスクを生成する必要がある
    const clippedDrawCount: number =
      clippingContext._clippedDrawableIndexList.length;

    for (
      let clippedDrawableIndex = 0;
      clippedDrawableIndex < clippedDrawCount;
      clippedDrawableIndex++
    ) {
      // マスクを使用する描画オブジェクトの描画される矩形を求める
      const drawableIndex: number =
        clippingContext._clippedDrawableIndexList[clippedDrawableIndex];

      const drawableVertexCount: number =
        model.getDrawableVertexCount(drawableIndex);
      const drawableVertexes: Float32Array =
        model.getDrawableVertices(drawableIndex);

      let minX: number = Number.MAX_VALUE;
      let minY: number = Number.MAX_VALUE;
      let maxX: number = -Number.MAX_VALUE;
      let maxY: number = -Number.MAX_VALUE;

      const loop: number = drawableVertexCount * Constant.vertexStep;
      for (
        let pi: number = Constant.vertexOffset;
        pi < loop;
        pi += Constant.vertexStep
      ) {
        const x: number = drawableVertexes[pi];
        const y: number = drawableVertexes[pi + 1];

        if (x < minX) {
          minX = x;
        }
        if (x > maxX) {
          maxX = x;
        }
        if (y < minY) {
          minY = y;
        }
        if (y > maxY) {
          maxY = y;
        }
      }

      // 有効な点が一つも取れなかったのでスキップ
      if (minX == Number.MAX_VALUE) {
        continue;
      }

      // 全体の矩形に反映
      if (minX < clippedDrawTotalMinX) {
        clippedDrawTotalMinX = minX;
      }
      if (minY < clippedDrawTotalMinY) {
        clippedDrawTotalMinY = minY;
      }
      if (maxX > clippedDrawTotalMaxX) {
        clippedDrawTotalMaxX = maxX;
      }
      if (maxY > clippedDrawTotalMaxY) {
        clippedDrawTotalMaxY = maxY;
      }

      if (clippedDrawTotalMinX == Number.MAX_VALUE) {
        clippingContext._allClippedDrawRect.x = 0.0;
        clippingContext._allClippedDrawRect.y = 0.0;
        clippingContext._allClippedDrawRect.width = 0.0;
        clippingContext._allClippedDrawRect.height = 0.0;
        clippingContext._isUsing = false;
      } else {
        clippingContext._isUsing = true;
        const w: number = clippedDrawTotalMaxX - clippedDrawTotalMinX;
        const h: number = clippedDrawTotalMaxY - clippedDrawTotalMinY;
        clippingContext._allClippedDrawRect.x = clippedDrawTotalMinX;
        clippingContext._allClippedDrawRect.y = clippedDrawTotalMinY;
        clippingContext._allClippedDrawRect.width = w;
        clippingContext._allClippedDrawRect.height = h;
      }
    }
  }

  /**
   * 画面描画に使用するクリッピングマスクのリストを取得する
   * @return 画面描画に使用するクリッピングマスクのリスト
   */
  public getClippingContextListForDraw(): Array<T_ClippingContext> {
    return this._clippingContextListForDraw;
  }

  public getClippingContextListForOffscreen(): Array<T_ClippingContext> {
    return this._clippingContextListForOffscreen;
  }

  /**
   * クリッピングマスクバッファのサイズを取得する
   * @return クリッピングマスクバッファのサイズ
   */
  public getClippingMaskBufferSize(): number {
    return this._clippingMaskBufferSize;
  }

  /**
   * このバッファのレンダーテクスチャの枚数を取得する
   * @return このバッファのレンダーテクスチャの枚数
   */
  public getRenderTextureCount(): number {
    return this._renderTextureCount;
  }

  /**
   * カラーチャンネル（RGBA）のフラグを取得する
   * @param channelNo カラーチャンネル（RGBA）の番号（0:R, 1:G, 2:B, 3:A）
   */
  public getChannelFlagAsColor(channelNo: number): CubismTextureColor {
    return this._channelColors[channelNo];
  }

  /**
   * クリッピングマスクバッファのサイズを設定する
   * @param size クリッピングマスクバッファのサイズ
   */
  public setClippingMaskBufferSize(size: number): void {
    this._clippingMaskBufferSize = size;
  }

  protected _clearedMaskBufferFlags: Array<boolean>; //マスクのクリアフラグの配列

  protected _channelColors: Array<CubismTextureColor>;
  protected _clippingContextListForMask: Array<T_ClippingContext>; // マスク用クリッピングコンテキストのリスト
  protected _clippingContextListForDraw: Array<T_ClippingContext>; // 描画用クリッピングコンテキストのリスト
  protected _clippingContextListForOffscreen: Array<T_ClippingContext>; // オフスクリーン用クリッピングコンテキストのリスト
  protected _clippingMaskBufferSize: number; // クリッピングマスクのバッファサイズ（初期値:256）
  protected _renderTextureCount: number; // 生成するレンダーテクスチャの枚数

  protected _tmpMatrix: CubismMatrix44; // マスク計算用の行列
  protected _tmpMatrixForMask: CubismMatrix44; // マスク計算用の行列
  protected _tmpMatrixForDraw: CubismMatrix44; // マスク計算用の行列
  protected _tmpBoundsOnModel: csmRect; // マスク配置計算用の矩形

  protected _clippingContexttConstructor: ClippingContextConstructor<T_ClippingContext>;
}
