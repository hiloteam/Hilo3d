/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { CubismId, CubismIdHandle } from '../id/cubismid';
import { LogLevel, csmDelete } from '../live2dcubismframework';
import { CubismModel } from '../model/cubismmodel';
import { CubismExpressionMotion } from './cubismexpressionmotion';
import { CubismMotionQueueEntry } from './cubismmotionqueueentry';
import { CubismMotionQueueManager } from './cubismmotionqueuemanager';

/**
 * @brief パラメータに適用する表情の値を持たせる構造体
 */
export class ExpressionParameterValue {
  parameterId: CubismIdHandle; // パラメーターID
  additiveValue: number; // 加算値
  multiplyValue: number; // 乗算値
  overwriteValue: number; // 上書き値
}

/**
 * @brief 表情モーションの管理
 *
 * 表情モーションの管理をおこなうクラス。
 */
export class CubismExpressionMotionManager extends CubismMotionQueueManager {
  /**
   * コンストラクタ
   */
  public constructor() {
    super();
    this._expressionParameterValues = new Array<ExpressionParameterValue>();
    this._fadeWeights = new Array<number>();
  }

  /**
   * デストラクタ相当の処理
   */
  public release(): void {
    if (this._expressionParameterValues) {
      csmDelete(this._expressionParameterValues);
      this._expressionParameterValues = null;
    }

    if (this._fadeWeights) {
      csmDelete(this._fadeWeights);
      this._fadeWeights = null;
    }
  }

  /**
   * @brief 再生中のモーションのウェイトを取得する。
   *
   * @param[in]    index    表情のインデックス
   * @return               表情モーションのウェイト
   */
  public getFadeWeight(index: number): number {
    if (
      index < 0 ||
      this._fadeWeights.length < 1 ||
      index >= this._fadeWeights.length
    ) {
      console.warn(
        'Failed to get the fade weight value. The element at that index does not exist.'
      );
      return -1;
    }

    return this._fadeWeights[index];
  }

  /**
   * @brief モーションのウェイトの設定。
   *
   * @param[in]    index    表情のインデックス
   * @param[in]    index    表情モーションのウェイト
   */
  public setFadeWeight(index: number, expressionFadeWeight: number): void {
    if (
      index < 0 ||
      this._fadeWeights.length < 1 ||
      this._fadeWeights.length <= index
    ) {
      console.warn(
        'Failed to set the fade weight value. The element at that index does not exist.'
      );
      return;
    }

    this._fadeWeights[index] = expressionFadeWeight;
  }

  /**
   * @brief モーションの更新
   *
   * モーションを更新して、モデルにパラメータ値を反映する。
   *
   * @param[in]   model   対象のモデル
   * @param[in]   deltaTimeSeconds    デルタ時間[秒]
   * @return  true    更新されている
   *          false   更新されていない
   */
  public updateMotion(model: CubismModel, deltaTimeSeconds: number): boolean {
    this._userTimeSeconds += deltaTimeSeconds;
    let updated = false;
    const motions = this.getCubismMotionQueueEntries();

    let expressionWeight = 0.0;
    let expressionIndex = 0;

    if (this._fadeWeights.length !== motions.length) {
      const difference = motions.length - this._fadeWeights.length;
      let dstIndex: number = this._fadeWeights.length;
      this._fadeWeights.length += difference;

      // TODO:
      // https://developer.mozilla.org/ja/docs/Web/JavaScript/Reference/Global_Objects/Array/fill
      // this._fadeWeights.fill(0.0, dstIndex, this._fadeWeights.length)

      for (let i = 0; i < difference; i++) {
        this._fadeWeights[dstIndex++] = 0.0;
      }
    }

    // ------- 処理を行う --------
    // 既にモーションがあれば終了フラグを立てる
    for (let i = 0; i < this._motions.length; ) {
      const motionQueueEntry = this._motions[i];

      if (motionQueueEntry == null) {
        motions.splice(i, 1); //削除
        continue;
      }

      const expressionMotion = <CubismExpressionMotion>(
        motionQueueEntry.getCubismMotion()
      );

      if (expressionMotion == null) {
        csmDelete(motionQueueEntry);
        motions.splice(i, 1); //削除
        continue;
      }

      const expressionParameters = expressionMotion.getExpressionParameters();

      if (motionQueueEntry.isAvailable()) {
        // 再生中のExpressionが参照しているパラメータをすべてリストアップ
        for (let i = 0; i < expressionParameters.length; ++i) {
          if (expressionParameters[i].parameterId == null) {
            continue;
          }

          let index = -1;
          // リストにパラメータIDが存在するか検索
          for (let j = 0; j < this._expressionParameterValues.length; ++j) {
            if (
              this._expressionParameterValues[j].parameterId !=
              expressionParameters[i].parameterId
            ) {
              continue;
            }

            index = j;
            break;
          }

          if (index >= 0) {
            continue;
          }

          // パラメータがリストに存在しないなら新規追加
          const item: ExpressionParameterValue = new ExpressionParameterValue();
          item.parameterId = expressionParameters[i].parameterId;
          item.additiveValue = CubismExpressionMotion.DefaultAdditiveValue;
          item.multiplyValue = CubismExpressionMotion.DefaultMultiplyValue;
          item.overwriteValue = model.getParameterValueById(item.parameterId);
          this._expressionParameterValues.push(item);
        }
      }

      // ------ 値を計算する ------
      expressionMotion.setupMotionQueueEntry(
        motionQueueEntry,
        this._userTimeSeconds
      );
      this.setFadeWeight(
        expressionIndex,
        expressionMotion.updateFadeWeight(
          motionQueueEntry,
          this._userTimeSeconds
        )
      );
      expressionMotion.calculateExpressionParameters(
        model,
        this._userTimeSeconds,
        motionQueueEntry,
        this._expressionParameterValues,
        expressionIndex,
        this.getFadeWeight(expressionIndex)
      );

      expressionWeight +=
        expressionMotion.getFadeInTime() == 0.0
          ? 1.0
          : CubismMath.getEasingSine(
              (this._userTimeSeconds - motionQueueEntry.getFadeInStartTime()) /
                expressionMotion.getFadeInTime()
            );

      updated = true;

      if (motionQueueEntry.isTriggeredFadeOut()) {
        // フェードアウト開始
        motionQueueEntry.startFadeOut(
          motionQueueEntry.getFadeOutSeconds(),
          this._userTimeSeconds
        );
      }

      ++i;
      ++expressionIndex;
    }

    // ----- 最新のExpressionのフェードが完了していればそれ以前を削除する ------
    if (motions.length > 1) {
      const latestFadeWeight: number = this.getFadeWeight(
        this._fadeWeights.length - 1
      );
      if (latestFadeWeight >= 1.0) {
        // 配列の最後の要素は削除しない
        for (let i = motions.length - 2; i >= 0; --i) {
          const motionQueueEntry = motions[i];
          csmDelete(motionQueueEntry);
          motions.splice(i, 1);
          this._fadeWeights.splice(i, 1);
        }
      }
    }

    if (expressionWeight > 1.0) {
      expressionWeight = 1.0;
    }

    // モデルに各値を適用
    for (let i = 0; i < this._expressionParameterValues.length; ++i) {
      const expressionParameterValue = this._expressionParameterValues[i];
      model.setParameterValueById(
        expressionParameterValue.parameterId,
        (expressionParameterValue.overwriteValue +
          expressionParameterValue.additiveValue) *
          expressionParameterValue.multiplyValue,
        expressionWeight
      );

      expressionParameterValue.additiveValue =
        CubismExpressionMotion.DefaultAdditiveValue;
      expressionParameterValue.multiplyValue =
        CubismExpressionMotion.DefaultMultiplyValue;
    }

    return updated;
  }

  private _expressionParameterValues: Array<ExpressionParameterValue>; ///< モデルに適用する各パラメータの値
  private _fadeWeights: Array<number>; ///< 再生中の表情のウェイト
  private _startExpressionTime: number; ///< 表情の再生開始時刻
}

// Namespace definition for compatibility.
import * as $ from './cubismexpressionmotionmanager';
import { CubismMath } from '../math/cubismmath';
import { CubismDebug, CubismLogError } from '../utils/cubismdebug';
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Live2DCubismFramework {
  export const CubismExpressionMotionManager = $.CubismExpressionMotionManager;
  export type CubismExpressionMotionManager = $.CubismExpressionMotionManager;
}
