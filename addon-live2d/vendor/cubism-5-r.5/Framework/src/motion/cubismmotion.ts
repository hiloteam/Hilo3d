/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { CubismIdHandle } from '../id/cubismid';
import { csmDelete, CubismFramework } from '../live2dcubismframework';
import { CubismMath } from '../math/cubismmath';
import { updateSize } from '../utils/cubismarrayutils';
import { CubismModel } from '../model/cubismmodel';
import {
  CSM_ASSERT,
  CubismLogDebug,
  CubismLogError,
  CubismLogWarning
} from '../utils/cubismdebug';
import {
  ACubismMotion,
  BeganMotionCallback,
  FinishedMotionCallback
} from './acubismmotion';
import {
  CubismMotionCurve,
  CubismMotionCurveTarget,
  CubismMotionData,
  CubismMotionEvent,
  CubismMotionPoint,
  CubismMotionSegment,
  CubismMotionSegmentType
} from './cubismmotioninternal';
import { CubismMotionJson, EvaluationOptionFlag } from './cubismmotionjson';
import { CubismMotionQueueEntry } from './cubismmotionqueueentry';

const EffectNameEyeBlink = 'EyeBlink';
const EffectNameLipSync = 'LipSync';
const TargetNameModel = 'Model';
const TargetNameParameter = 'Parameter';
const TargetNamePartOpacity = 'PartOpacity';

// Id
const IdNameOpacity = 'Opacity';

/**
 * Cubism SDK R2 以前のモーションを再現させるなら true 、アニメータのモーションを正しく再現するなら false 。
 */
const UseOldBeziersCurveMotion = false;

function lerpPoints(
  a: CubismMotionPoint,
  b: CubismMotionPoint,
  t: number
): CubismMotionPoint {
  const result: CubismMotionPoint = new CubismMotionPoint();

  result.time = a.time + (b.time - a.time) * t;
  result.value = a.value + (b.value - a.value) * t;

  return result;
}

function linearEvaluate(points: CubismMotionPoint[], time: number): number {
  let t: number = (time - points[0].time) / (points[1].time - points[0].time);

  if (t < 0.0) {
    t = 0.0;
  }

  return points[0].value + (points[1].value - points[0].value) * t;
}

function bezierEvaluate(points: CubismMotionPoint[], time: number): number {
  let t: number = (time - points[0].time) / (points[3].time - points[0].time);

  if (t < 0.0) {
    t = 0.0;
  }

  const p01: CubismMotionPoint = lerpPoints(points[0], points[1], t);
  const p12: CubismMotionPoint = lerpPoints(points[1], points[2], t);
  const p23: CubismMotionPoint = lerpPoints(points[2], points[3], t);

  const p012: CubismMotionPoint = lerpPoints(p01, p12, t);
  const p123: CubismMotionPoint = lerpPoints(p12, p23, t);

  return lerpPoints(p012, p123, t).value;
}

function bezierEvaluateBinarySearch(
  points: CubismMotionPoint[],
  time: number
): number {
  const xError = 0.01;

  const x: number = time;
  let x1: number = points[0].time;
  let x2: number = points[3].time;
  let cx1: number = points[1].time;
  let cx2: number = points[2].time;

  let ta = 0.0;
  let tb = 1.0;
  let t = 0.0;
  let i = 0;

  for (let var33 = true; i < 20; ++i) {
    if (x < x1 + xError) {
      t = ta;
      break;
    }

    if (x2 - xError < x) {
      t = tb;
      break;
    }

    let centerx: number = (cx1 + cx2) * 0.5;
    cx1 = (x1 + cx1) * 0.5;
    cx2 = (x2 + cx2) * 0.5;
    const ctrlx12: number = (cx1 + centerx) * 0.5;
    const ctrlx21: number = (cx2 + centerx) * 0.5;
    centerx = (ctrlx12 + ctrlx21) * 0.5;
    if (x < centerx) {
      tb = (ta + tb) * 0.5;
      if (centerx - xError < x) {
        t = tb;
        break;
      }

      x2 = centerx;
      cx2 = ctrlx12;
    } else {
      ta = (ta + tb) * 0.5;
      if (x < centerx + xError) {
        t = ta;
        break;
      }

      x1 = centerx;
      cx1 = ctrlx21;
    }
  }

  if (i == 20) {
    t = (ta + tb) * 0.5;
  }

  if (t < 0.0) {
    t = 0.0;
  }
  if (t > 1.0) {
    t = 1.0;
  }

  const p01: CubismMotionPoint = lerpPoints(points[0], points[1], t);
  const p12: CubismMotionPoint = lerpPoints(points[1], points[2], t);
  const p23: CubismMotionPoint = lerpPoints(points[2], points[3], t);

  const p012: CubismMotionPoint = lerpPoints(p01, p12, t);
  const p123: CubismMotionPoint = lerpPoints(p12, p23, t);

  return lerpPoints(p012, p123, t).value;
}

function bezierEvaluateCardanoInterpretation(
  points: CubismMotionPoint[],
  time: number
): number {
  const x: number = time;
  const x1: number = points[0].time;
  const x2: number = points[3].time;
  const cx1: number = points[1].time;
  const cx2: number = points[2].time;

  const a: number = x2 - 3.0 * cx2 + 3.0 * cx1 - x1;
  const b: number = 3.0 * cx2 - 6.0 * cx1 + 3.0 * x1;
  const c: number = 3.0 * cx1 - 3.0 * x1;
  const d: number = x1 - x;

  const t: number = CubismMath.cardanoAlgorithmForBezier(a, b, c, d);

  const p01: CubismMotionPoint = lerpPoints(points[0], points[1], t);
  const p12: CubismMotionPoint = lerpPoints(points[1], points[2], t);
  const p23: CubismMotionPoint = lerpPoints(points[2], points[3], t);

  const p012: CubismMotionPoint = lerpPoints(p01, p12, t);
  const p123: CubismMotionPoint = lerpPoints(p12, p23, t);

  return lerpPoints(p012, p123, t).value;
}

function steppedEvaluate(points: CubismMotionPoint[], time: number): number {
  return points[0].value;
}

function inverseSteppedEvaluate(
  points: CubismMotionPoint[],
  time: number
): number {
  return points[1].value;
}

function evaluateCurve(
  motionData: CubismMotionData,
  index: number,
  time: number,
  isCorrection: boolean,
  endTime: number
): number {
  // Find segment to evaluate.
  const curve: CubismMotionCurve = motionData.curves[index];

  let target = -1;
  const totalSegmentCount: number = curve.baseSegmentIndex + curve.segmentCount;
  let pointPosition = 0;
  for (let i: number = curve.baseSegmentIndex; i < totalSegmentCount; ++i) {
    // Get first point of next segment.
    pointPosition =
      motionData.segments[i].basePointIndex +
      ((motionData.segments[i].segmentType as CubismMotionSegmentType) ==
      CubismMotionSegmentType.CubismMotionSegmentType_Bezier
        ? 3
        : 1);

    // Break if time lies within current segment.
    if (motionData.points[pointPosition].time > time) {
      target = i;
      break;
    }
  }

  if (target == -1) {
    if (isCorrection && time < endTime) {
      return correctEndPoint(
        motionData,
        totalSegmentCount - 1,
        motionData.segments[curve.baseSegmentIndex].basePointIndex,
        pointPosition,
        time,
        endTime
      );
    }
    return motionData.points[pointPosition].value;
  }

  const segment: CubismMotionSegment = motionData.segments[target];

  return segment.evaluate(
    motionData.points.slice(segment.basePointIndex),
    time
  );
}

/**
 * 終点から始点への補正処理
 * @param motionData
 * @param segmentIndex
 * @param beginIndex
 * @param endIndex
 * @param time
 * @param endTime
 * @return
 */
function correctEndPoint(
  motionData: CubismMotionData,
  segmentIndex: number,
  beginIndex: number,
  endIndex: number,
  time: number,
  endTime: number
): number {
  const motionPoint: CubismMotionPoint[] = [
    new CubismMotionPoint(),
    new CubismMotionPoint()
  ];
  {
    const src = motionData.points[endIndex];
    motionPoint[0].time = src.time;
    motionPoint[0].value = src.value;
  }
  {
    const src = motionData.points[beginIndex];
    motionPoint[1].time = endTime;
    motionPoint[1].value = src.value;
  }

  switch (
    motionData.segments[segmentIndex].segmentType as CubismMotionSegmentType
  ) {
    case CubismMotionSegmentType.CubismMotionSegmentType_Linear:
    case CubismMotionSegmentType.CubismMotionSegmentType_Bezier:
    default:
      return linearEvaluate(motionPoint, time);
    case CubismMotionSegmentType.CubismMotionSegmentType_Stepped:
      return steppedEvaluate(motionPoint, time);
    case CubismMotionSegmentType.CubismMotionSegmentType_InverseStepped:
      return inverseSteppedEvaluate(motionPoint, time);
  }
}

/**
 * Enumerator for version control of Motion Behavior.
 * For details, see the SDK Manual.
 */
export enum MotionBehavior {
  MotionBehavior_V1,
  MotionBehavior_V2
}

/**
 * モーションクラス
 *
 * モーションのクラス。
 */
export class CubismMotion extends ACubismMotion {
  /**
   * インスタンスを作成する
   *
   * @param buffer motion3.jsonが読み込まれているバッファ
   * @param size バッファのサイズ
   * @param onFinishedMotionHandler モーション再生終了時に呼び出されるコールバック関数
   * @param onBeganMotionHandler モーション再生開始時に呼び出されるコールバック関数
   * @param shouldCheckMotionConsistency motion3.json整合性チェックするかどうか
   * @return 作成されたインスタンス
   */
  public static create(
    buffer: ArrayBuffer,
    size: number,
    onFinishedMotionHandler?: FinishedMotionCallback,
    onBeganMotionHandler?: BeganMotionCallback,
    shouldCheckMotionConsistency: boolean = false
  ): CubismMotion {
    const ret = new CubismMotion();

    ret.parse(buffer, size, shouldCheckMotionConsistency);
    if (ret._motionData) {
      ret._sourceFrameRate = ret._motionData.fps;
      ret._loopDurationSeconds = ret._motionData.duration;
      ret._onFinishedMotion = onFinishedMotionHandler;
      ret._onBeganMotion = onBeganMotionHandler;
    } else {
      csmDelete(ret);
      return null;
    }

    // NOTE: Editorではループありのモーション書き出しは非対応
    // ret->_loop = (ret->_motionData->Loop > 0);
    return ret;
  }

  /**
   * モデルのパラメータの更新の実行
   * @param model             対象のモデル
   * @param userTimeSeconds   現在の時刻[秒]
   * @param fadeWeight        モーションの重み
   * @param motionQueueEntry  CubismMotionQueueManagerで管理されているモーション
   */
  public doUpdateParameters(
    model: CubismModel,
    userTimeSeconds: number,
    fadeWeight: number,
    motionQueueEntry: CubismMotionQueueEntry
  ): void {
    if (this._modelCurveIdEyeBlink == null) {
      this._modelCurveIdEyeBlink =
        CubismFramework.getIdManager().getId(EffectNameEyeBlink);
    }

    if (this._modelCurveIdLipSync == null) {
      this._modelCurveIdLipSync =
        CubismFramework.getIdManager().getId(EffectNameLipSync);
    }

    if (this._modelCurveIdOpacity == null) {
      this._modelCurveIdOpacity =
        CubismFramework.getIdManager().getId(IdNameOpacity);
    }

    if (this._motionBehavior === MotionBehavior.MotionBehavior_V2) {
      if (this._previousLoopState !== this._isLoop) {
        // 終了時間を計算する
        this.adjustEndTime(motionQueueEntry);
        this._previousLoopState = this._isLoop;
      }
    }

    let timeOffsetSeconds: number =
      userTimeSeconds - motionQueueEntry.getStartTime();

    if (timeOffsetSeconds < 0.0) {
      timeOffsetSeconds = 0.0; // エラー回避
    }

    let lipSyncValue: number = Number.MAX_VALUE;
    let eyeBlinkValue: number = Number.MAX_VALUE;

    //まばたき、リップシンクのうちモーションの適用を検出するためのビット（maxFlagCount個まで
    const maxTargetSize = 64;
    let lipSyncFlags = 0;
    let eyeBlinkFlags = 0;

    //瞬き、リップシンクのターゲット数が上限を超えている場合
    if (this._eyeBlinkParameterIds.length > maxTargetSize) {
      CubismLogDebug(
        'too many eye blink targets : {0}',
        this._eyeBlinkParameterIds.length
      );
    }
    if (this._lipSyncParameterIds.length > maxTargetSize) {
      CubismLogDebug(
        'too many lip sync targets : {0}',
        this._lipSyncParameterIds.length
      );
    }

    const tmpFadeIn: number =
      this._fadeInSeconds <= 0.0
        ? 1.0
        : CubismMath.getEasingSine(
            (userTimeSeconds - motionQueueEntry.getFadeInStartTime()) /
              this._fadeInSeconds
          );

    const tmpFadeOut: number =
      this._fadeOutSeconds <= 0.0 || motionQueueEntry.getEndTime() < 0.0
        ? 1.0
        : CubismMath.getEasingSine(
            (motionQueueEntry.getEndTime() - userTimeSeconds) /
              this._fadeOutSeconds
          );
    let value: number;
    let c: number, parameterIndex: number;

    // 'Repeat' time as necessary.
    let time: number = timeOffsetSeconds;
    let duration: number = this._motionData.duration;
    const isCorrection: boolean =
      this._motionBehavior === MotionBehavior.MotionBehavior_V2 && this._isLoop;

    if (this._isLoop) {
      if (this._motionBehavior === MotionBehavior.MotionBehavior_V2) {
        duration += 1.0 / this._motionData.fps;
      }
      while (time > duration) {
        time -= duration;
      }
    }

    const curves: Array<CubismMotionCurve> = this._motionData.curves;

    // Evaluate model curves.
    for (
      c = 0;
      c < this._motionData.curveCount &&
      curves[c].type == CubismMotionCurveTarget.CubismMotionCurveTarget_Model;
      ++c
    ) {
      // Evaluate curve and call handler.
      value = evaluateCurve(this._motionData, c, time, isCorrection, duration);

      if (curves[c].id == this._modelCurveIdEyeBlink) {
        eyeBlinkValue = value;
      } else if (curves[c].id == this._modelCurveIdLipSync) {
        lipSyncValue = value;
      } else if (curves[c].id == this._modelCurveIdOpacity) {
        this._modelOpacity = value;
        model.setModelOapcity(this.getModelOpacityValue());
      }
    }

    let parameterMotionCurveCount = 0;

    for (
      ;
      c < this._motionData.curveCount &&
      curves[c].type ==
        CubismMotionCurveTarget.CubismMotionCurveTarget_Parameter;
      ++c
    ) {
      parameterMotionCurveCount++;

      // Find parameter index.
      parameterIndex = model.getParameterIndex(curves[c].id);

      // Skip curve evaluation if no value in sink.
      if (parameterIndex == -1) {
        continue;
      }

      const sourceValue: number =
        model.getParameterValueByIndex(parameterIndex);

      // Evaluate curve and apply value.
      value = evaluateCurve(this._motionData, c, time, isCorrection, duration);

      if (eyeBlinkValue != Number.MAX_VALUE) {
        for (
          let i = 0;
          i < this._eyeBlinkParameterIds.length && i < maxTargetSize;
          ++i
        ) {
          if (this._eyeBlinkParameterIds[i] == curves[c].id) {
            value *= eyeBlinkValue;
            eyeBlinkFlags |= 1 << i;
            break;
          }
        }
      }

      if (lipSyncValue != Number.MAX_VALUE) {
        for (
          let i = 0;
          i < this._lipSyncParameterIds.length && i < maxTargetSize;
          ++i
        ) {
          if (this._lipSyncParameterIds[i] == curves[c].id) {
            value += lipSyncValue;
            lipSyncFlags |= 1 << i;
            break;
          }
        }
      }

      // Process "repeats only" for compatibility
      if (model.isRepeat(parameterIndex)) {
        value = model.getParameterRepeatValue(parameterIndex, value);
      }

      let v: number;

      // パラメータごとのフェード
      if (curves[c].fadeInTime < 0.0 && curves[c].fadeOutTime < 0.0) {
        // モーションのフェードを適用
        v = sourceValue + (value - sourceValue) * fadeWeight;
      } else {
        // パラメータに対してフェードインかフェードアウトが設定してある場合はそちらを適用
        let fin: number;
        let fout: number;

        if (curves[c].fadeInTime < 0.0) {
          fin = tmpFadeIn;
        } else {
          fin =
            curves[c].fadeInTime == 0.0
              ? 1.0
              : CubismMath.getEasingSine(
                  (userTimeSeconds - motionQueueEntry.getFadeInStartTime()) /
                    curves[c].fadeInTime
                );
        }

        if (curves[c].fadeOutTime < 0.0) {
          fout = tmpFadeOut;
        } else {
          fout =
            curves[c].fadeOutTime == 0.0 || motionQueueEntry.getEndTime() < 0.0
              ? 1.0
              : CubismMath.getEasingSine(
                  (motionQueueEntry.getEndTime() - userTimeSeconds) /
                    curves[c].fadeOutTime
                );
        }

        const paramWeight: number = this._weight * fin * fout;

        // パラメータごとのフェードを適用
        v = sourceValue + (value - sourceValue) * paramWeight;
      }

      model.setParameterValueByIndex(parameterIndex, v, 1.0);
    }

    {
      if (eyeBlinkValue != Number.MAX_VALUE) {
        for (
          let i = 0;
          i < this._eyeBlinkParameterIds.length && i < maxTargetSize;
          ++i
        ) {
          const sourceValue: number = model.getParameterValueById(
            this._eyeBlinkParameterIds[i]
          );

          // モーションでの上書きがあった時にはまばたきは適用しない
          if ((eyeBlinkFlags >> i) & 0x01) {
            continue;
          }

          const v: number =
            sourceValue + (eyeBlinkValue - sourceValue) * fadeWeight;

          model.setParameterValueById(this._eyeBlinkParameterIds[i], v);
        }
      }

      if (lipSyncValue != Number.MAX_VALUE) {
        for (
          let i = 0;
          i < this._lipSyncParameterIds.length && i < maxTargetSize;
          ++i
        ) {
          const sourceValue: number = model.getParameterValueById(
            this._lipSyncParameterIds[i]
          );

          // モーションでの上書きがあった時にはリップシンクは適用しない
          if ((lipSyncFlags >> i) & 0x01) {
            continue;
          }

          const v: number =
            sourceValue + (lipSyncValue - sourceValue) * fadeWeight;

          model.setParameterValueById(this._lipSyncParameterIds[i], v);
        }
      }
    }

    for (
      ;
      c < this._motionData.curveCount &&
      curves[c].type ==
        CubismMotionCurveTarget.CubismMotionCurveTarget_PartOpacity;
      ++c
    ) {
      // Find parameter index.
      parameterIndex = model.getParameterIndex(curves[c].id);

      // Skip curve evaluation if no value in sink.
      if (parameterIndex == -1) {
        continue;
      }

      // Evaluate curve and apply value.
      value = evaluateCurve(this._motionData, c, time, isCorrection, duration);

      model.setParameterValueByIndex(parameterIndex, value);
    }

    if (timeOffsetSeconds >= duration) {
      if (this._isLoop) {
        this.updateForNextLoop(motionQueueEntry, userTimeSeconds, time);
      } else {
        if (this._onFinishedMotion) {
          this._onFinishedMotion(this);
        }

        motionQueueEntry.setIsFinished(true);
      }
    }
    this._lastWeight = fadeWeight;
  }

  /**
   * Sets the version of the Motion Behavior.
   *
   * @param Specifies the version of the Motion Behavior.
   */
  public setMotionBehavior(motionBehavior: MotionBehavior) {
    this._motionBehavior = motionBehavior;
  }

  /**
   * Gets the version of the Motion Behavior.
   *
   * @return Returns the version of the Motion Behavior.
   */
  public getMotionBehavior(): MotionBehavior {
    return this._motionBehavior;
  }

  /**
   * モーションの長さを取得する。
   *
   * @return  モーションの長さ[秒]
   */
  public getDuration(): number {
    return this._isLoop ? -1.0 : this._loopDurationSeconds;
  }

  /**
   * モーションのループ時の長さを取得する。
   *
   * @return  モーションのループ時の長さ[秒]
   */
  public getLoopDuration(): number {
    return this._loopDurationSeconds;
  }

  /**
   * パラメータに対するフェードインの時間を設定する。
   *
   * @param parameterId     パラメータID
   * @param value           フェードインにかかる時間[秒]
   */
  public setParameterFadeInTime(
    parameterId: CubismIdHandle,
    value: number
  ): void {
    const curves: Array<CubismMotionCurve> = this._motionData.curves;

    for (let i = 0; i < this._motionData.curveCount; ++i) {
      if (parameterId == curves[i].id) {
        curves[i].fadeInTime = value;
        return;
      }
    }
  }

  /**
   * パラメータに対するフェードアウトの時間の設定
   * @param parameterId     パラメータID
   * @param value           フェードアウトにかかる時間[秒]
   */
  public setParameterFadeOutTime(
    parameterId: CubismIdHandle,
    value: number
  ): void {
    const curves: Array<CubismMotionCurve> = this._motionData.curves;

    for (let i = 0; i < this._motionData.curveCount; ++i) {
      if (parameterId == curves[i].id) {
        curves[i].fadeOutTime = value;
        return;
      }
    }
  }

  /**
   * パラメータに対するフェードインの時間の取得
   * @param    parameterId     パラメータID
   * @return   フェードインにかかる時間[秒]
   */
  public getParameterFadeInTime(parameterId: CubismIdHandle): number {
    const curves: Array<CubismMotionCurve> = this._motionData.curves;

    for (let i = 0; i < this._motionData.curveCount; ++i) {
      if (parameterId == curves[i].id) {
        return curves[i].fadeInTime;
      }
    }

    return -1;
  }

  /**
   * パラメータに対するフェードアウトの時間を取得
   *
   * @param   parameterId     パラメータID
   * @return   フェードアウトにかかる時間[秒]
   */
  public getParameterFadeOutTime(parameterId: CubismIdHandle): number {
    const curves: Array<CubismMotionCurve> = this._motionData.curves;

    for (let i = 0; i < this._motionData.curveCount; ++i) {
      if (parameterId == curves[i].id) {
        return curves[i].fadeOutTime;
      }
    }

    return -1;
  }

  /**
   * 自動エフェクトがかかっているパラメータIDリストの設定
   * @param eyeBlinkParameterIds    自動まばたきがかかっているパラメータIDのリスト
   * @param lipSyncParameterIds     リップシンクがかかっているパラメータIDのリスト
   */
  public setEffectIds(
    eyeBlinkParameterIds: Array<CubismIdHandle>,
    lipSyncParameterIds: Array<CubismIdHandle>
  ): void {
    this._eyeBlinkParameterIds = eyeBlinkParameterIds;
    this._lipSyncParameterIds = lipSyncParameterIds;
  }

  /**
   * コンストラクタ
   */
  public constructor() {
    super();
    this._sourceFrameRate = 30.0;
    this._loopDurationSeconds = -1.0;
    this._isLoop = false; // trueから false へデフォルトを変更
    this._isLoopFadeIn = true; // ループ時にフェードインが有効かどうかのフラグ
    this._lastWeight = 0.0;
    this._motionData = null;
    this._modelCurveIdEyeBlink = null;
    this._modelCurveIdLipSync = null;
    this._modelCurveIdOpacity = null;
    this._eyeBlinkParameterIds = null;
    this._lipSyncParameterIds = null;
    this._modelOpacity = 1.0;
    this._debugMode = false;
  }

  /**
   * デストラクタ相当の処理
   */
  public release(): void {
    this._motionData = void 0;
    this._motionData = null;
  }

  /**
   *
   * @param motionQueueEntry
   * @param userTimeSeconds
   * @param time
   */
  public updateForNextLoop(
    motionQueueEntry: CubismMotionQueueEntry,
    userTimeSeconds: number,
    time: number
  ) {
    switch (this._motionBehavior) {
      case MotionBehavior.MotionBehavior_V2:
      default:
        motionQueueEntry.setStartTime(userTimeSeconds - time); // 最初の状態へ
        if (this._isLoopFadeIn) {
          // ループ中でループ用フェードインが有効のときは、フェードイン設定し直し
          motionQueueEntry.setFadeInStartTime(userTimeSeconds - time);
        }

        if (this._onFinishedMotion != null) {
          this._onFinishedMotion(this);
        }
        break;
      case MotionBehavior.MotionBehavior_V1:
        // 旧ループ処理
        motionQueueEntry.setStartTime(userTimeSeconds); // 最初の状態へ
        if (this._isLoopFadeIn) {
          // ループ中でループ用フェードインが有効のときは、フェードイン設定し直し
          motionQueueEntry.setFadeInStartTime(userTimeSeconds);
        }
        break;
    }
  }

  /**
   * motion3.jsonをパースする。
   *
   * @param motionJson  motion3.jsonが読み込まれているバッファ
   * @param size        バッファのサイズ
   * @param shouldCheckMotionConsistency motion3.json整合性チェックするかどうか
   */
  public parse(
    motionJson: ArrayBuffer,
    size: number,
    shouldCheckMotionConsistency: boolean = false
  ): void {
    let json: CubismMotionJson = new CubismMotionJson(motionJson, size);

    if (!json) {
      json.release();
      json = void 0;
      return;
    }

    if (shouldCheckMotionConsistency) {
      const consistency = json.hasConsistency();
      if (!consistency) {
        json.release();
        CubismLogError('Inconsistent motion3.json.');
        return;
      }
    }

    this._motionData = new CubismMotionData();

    this._motionData.duration = json.getMotionDuration();
    this._motionData.loop = json.isMotionLoop();
    this._motionData.curveCount = json.getMotionCurveCount();
    this._motionData.fps = json.getMotionFps();
    this._motionData.eventCount = json.getEventCount();

    const areBeziersRestructed: boolean = json.getEvaluationOptionFlag(
      EvaluationOptionFlag.EvaluationOptionFlag_AreBeziersRistricted
    );

    if (json.isExistMotionFadeInTime()) {
      this._fadeInSeconds =
        json.getMotionFadeInTime() < 0.0 ? 1.0 : json.getMotionFadeInTime();
    } else {
      this._fadeInSeconds = 1.0;
    }

    if (json.isExistMotionFadeOutTime()) {
      this._fadeOutSeconds =
        json.getMotionFadeOutTime() < 0.0 ? 1.0 : json.getMotionFadeOutTime();
    } else {
      this._fadeOutSeconds = 1.0;
    }

    updateSize(
      this._motionData.curves,
      this._motionData.curveCount,
      CubismMotionCurve,
      true
    );
    updateSize(
      this._motionData.segments,
      json.getMotionTotalSegmentCount(),
      CubismMotionSegment,
      true
    );
    updateSize(
      this._motionData.points,
      json.getMotionTotalPointCount(),
      CubismMotionPoint,
      true
    );
    updateSize(
      this._motionData.events,
      this._motionData.eventCount,
      CubismMotionEvent,
      true
    );

    let totalPointCount = 0;
    let totalSegmentCount = 0;

    // Curves
    for (
      let curveCount = 0;
      curveCount < this._motionData.curveCount;
      ++curveCount
    ) {
      if (json.getMotionCurveTarget(curveCount) == TargetNameModel) {
        this._motionData.curves[curveCount].type =
          CubismMotionCurveTarget.CubismMotionCurveTarget_Model;
      } else if (json.getMotionCurveTarget(curveCount) == TargetNameParameter) {
        this._motionData.curves[curveCount].type =
          CubismMotionCurveTarget.CubismMotionCurveTarget_Parameter;
      } else if (
        json.getMotionCurveTarget(curveCount) == TargetNamePartOpacity
      ) {
        this._motionData.curves[curveCount].type =
          CubismMotionCurveTarget.CubismMotionCurveTarget_PartOpacity;
      } else {
        CubismLogWarning(
          'Warning : Unable to get segment type from Curve! The number of "CurveCount" may be incorrect!'
        );
      }

      this._motionData.curves[curveCount].id =
        json.getMotionCurveId(curveCount);

      this._motionData.curves[curveCount].baseSegmentIndex = totalSegmentCount;

      this._motionData.curves[curveCount].fadeInTime =
        json.isExistMotionCurveFadeInTime(curveCount)
          ? json.getMotionCurveFadeInTime(curveCount)
          : -1.0;
      this._motionData.curves[curveCount].fadeOutTime =
        json.isExistMotionCurveFadeOutTime(curveCount)
          ? json.getMotionCurveFadeOutTime(curveCount)
          : -1.0;

      // Segments
      for (
        let segmentPosition = 0;
        segmentPosition < json.getMotionCurveSegmentCount(curveCount);
      ) {
        if (segmentPosition == 0) {
          this._motionData.segments[totalSegmentCount].basePointIndex =
            totalPointCount;

          this._motionData.points[totalPointCount].time =
            json.getMotionCurveSegment(curveCount, segmentPosition);
          this._motionData.points[totalPointCount].value =
            json.getMotionCurveSegment(curveCount, segmentPosition + 1);

          totalPointCount += 1;
          segmentPosition += 2;
        } else {
          this._motionData.segments[totalSegmentCount].basePointIndex =
            totalPointCount - 1;
        }

        const segment: number = json.getMotionCurveSegment(
          curveCount,
          segmentPosition
        );

        const segmentType: CubismMotionSegmentType = segment;
        switch (segmentType) {
          case CubismMotionSegmentType.CubismMotionSegmentType_Linear: {
            this._motionData.segments[totalSegmentCount].segmentType =
              CubismMotionSegmentType.CubismMotionSegmentType_Linear;
            this._motionData.segments[totalSegmentCount].evaluate =
              linearEvaluate;

            this._motionData.points[totalPointCount].time =
              json.getMotionCurveSegment(curveCount, segmentPosition + 1);
            this._motionData.points[totalPointCount].value =
              json.getMotionCurveSegment(curveCount, segmentPosition + 2);

            totalPointCount += 1;
            segmentPosition += 3;

            break;
          }
          case CubismMotionSegmentType.CubismMotionSegmentType_Bezier: {
            this._motionData.segments[totalSegmentCount].segmentType =
              CubismMotionSegmentType.CubismMotionSegmentType_Bezier;

            if (areBeziersRestructed || UseOldBeziersCurveMotion) {
              this._motionData.segments[totalSegmentCount].evaluate =
                bezierEvaluate;
            } else {
              this._motionData.segments[totalSegmentCount].evaluate =
                bezierEvaluateCardanoInterpretation;
            }

            this._motionData.points[totalPointCount].time =
              json.getMotionCurveSegment(curveCount, segmentPosition + 1);
            this._motionData.points[totalPointCount].value =
              json.getMotionCurveSegment(curveCount, segmentPosition + 2);

            this._motionData.points[totalPointCount + 1].time =
              json.getMotionCurveSegment(curveCount, segmentPosition + 3);
            this._motionData.points[totalPointCount + 1].value =
              json.getMotionCurveSegment(curveCount, segmentPosition + 4);

            this._motionData.points[totalPointCount + 2].time =
              json.getMotionCurveSegment(curveCount, segmentPosition + 5);
            this._motionData.points[totalPointCount + 2].value =
              json.getMotionCurveSegment(curveCount, segmentPosition + 6);

            totalPointCount += 3;
            segmentPosition += 7;

            break;
          }

          case CubismMotionSegmentType.CubismMotionSegmentType_Stepped: {
            this._motionData.segments[totalSegmentCount].segmentType =
              CubismMotionSegmentType.CubismMotionSegmentType_Stepped;
            this._motionData.segments[totalSegmentCount].evaluate =
              steppedEvaluate;

            this._motionData.points[totalPointCount].time =
              json.getMotionCurveSegment(curveCount, segmentPosition + 1);
            this._motionData.points[totalPointCount].value =
              json.getMotionCurveSegment(curveCount, segmentPosition + 2);

            totalPointCount += 1;
            segmentPosition += 3;

            break;
          }

          case CubismMotionSegmentType.CubismMotionSegmentType_InverseStepped: {
            this._motionData.segments[totalSegmentCount].segmentType =
              CubismMotionSegmentType.CubismMotionSegmentType_InverseStepped;
            this._motionData.segments[totalSegmentCount].evaluate =
              inverseSteppedEvaluate;

            this._motionData.points[totalPointCount].time =
              json.getMotionCurveSegment(curveCount, segmentPosition + 1);
            this._motionData.points[totalPointCount].value =
              json.getMotionCurveSegment(curveCount, segmentPosition + 2);

            totalPointCount += 1;
            segmentPosition += 3;

            break;
          }
          default: {
            CSM_ASSERT(0);
            break;
          }
        }

        ++this._motionData.curves[curveCount].segmentCount;
        ++totalSegmentCount;
      }
    }

    for (
      let userdatacount = 0;
      userdatacount < json.getEventCount();
      ++userdatacount
    ) {
      this._motionData.events[userdatacount].fireTime =
        json.getEventTime(userdatacount);
      this._motionData.events[userdatacount].value =
        json.getEventValue(userdatacount);
    }

    json.release();
    json = void 0;
    json = null;
  }

  /**
   * モデルのパラメータ更新
   *
   * イベント発火のチェック。
   * 入力する時間は呼ばれるモーションタイミングを０とした秒数で行う。
   *
   * @param beforeCheckTimeSeconds   前回のイベントチェック時間[秒]
   * @param motionTimeSeconds        今回の再生時間[秒]
   */
  public getFiredEvent(
    beforeCheckTimeSeconds: number,
    motionTimeSeconds: number
  ): Array<string> {
    updateSize(this._firedEventValues, 0);

    // イベントの発火チェック
    for (let u = 0; u < this._motionData.eventCount; ++u) {
      if (
        this._motionData.events[u].fireTime > beforeCheckTimeSeconds &&
        this._motionData.events[u].fireTime <= motionTimeSeconds
      ) {
        this._firedEventValues.push(this._motionData.events[u].value);
      }
    }

    return this._firedEventValues;
  }

  /**
   * 透明度のカーブが存在するかどうかを確認する
   *
   * @return true  -> キーが存在する
   *          false -> キーが存在しない
   */
  public isExistModelOpacity(): boolean {
    for (let i = 0; i < this._motionData.curveCount; i++) {
      const curve: CubismMotionCurve = this._motionData.curves[i];

      if (curve.type != CubismMotionCurveTarget.CubismMotionCurveTarget_Model) {
        continue;
      }

      if (curve.id.getString().localeCompare(IdNameOpacity) == 0) {
        return true;
      }
    }

    return false;
  }

  /**
   * 透明度のカーブのインデックスを返す
   *
   * @return success:透明度のカーブのインデックス
   */
  public getModelOpacityIndex(): number {
    if (this.isExistModelOpacity()) {
      for (let i = 0; i < this._motionData.curveCount; i++) {
        const curve: CubismMotionCurve = this._motionData.curves[i];

        if (
          curve.type != CubismMotionCurveTarget.CubismMotionCurveTarget_Model
        ) {
          continue;
        }

        if (curve.id.getString().localeCompare(IdNameOpacity) == 0) {
          return i;
        }
      }
    }
    return -1;
  }

  /**
   * 透明度のIdを返す
   *
   * @param index モーションカーブのインデックス
   * @return success:透明度のカーブのインデックス
   */
  public getModelOpacityId(index: number): CubismIdHandle {
    if (index != -1) {
      const curve: CubismMotionCurve = this._motionData.curves[index];

      if (curve.type == CubismMotionCurveTarget.CubismMotionCurveTarget_Model) {
        if (curve.id.getString().localeCompare(IdNameOpacity) == 0) {
          return CubismFramework.getIdManager().getId(curve.id.getString());
        }
      }
    }

    return null;
  }

  /**
   * 現在時間の透明度の値を返す
   *
   * @return success:モーションの当該時間におけるOpacityの値
   */
  public getModelOpacityValue(): number {
    return this._modelOpacity;
  }

  /**
   * デバッグ用フラグを設定する
   *
   * @param debugMode デバッグモードの有効・無効
   */
  public setDebugMode(debugMode: boolean): void {
    this._debugMode = debugMode;
  }

  public _sourceFrameRate: number; // ロードしたファイルのFPS。記述が無ければデフォルト値15fpsとなる
  public _loopDurationSeconds: number; // mtnファイルで定義される一連のモーションの長さ
  public _motionBehavior: MotionBehavior = MotionBehavior.MotionBehavior_V2;
  public _lastWeight: number; // 最後に設定された重み

  public _motionData: CubismMotionData; // 実際のモーションデータ本体

  public _eyeBlinkParameterIds: Array<CubismIdHandle>; // 自動まばたきを適用するパラメータIDハンドルのリスト。  モデル（モデルセッティング）とパラメータを対応付ける。
  public _lipSyncParameterIds: Array<CubismIdHandle>; // リップシンクを適用するパラメータIDハンドルのリスト。  モデル（モデルセッティング）とパラメータを対応付ける。

  public _modelCurveIdEyeBlink: CubismIdHandle; // モデルが持つ自動まばたき用パラメータIDのハンドル。  モデルとモーションを対応付ける。
  public _modelCurveIdLipSync: CubismIdHandle; // モデルが持つリップシンク用パラメータIDのハンドル。  モデルとモーションを対応付ける。
  public _modelCurveIdOpacity: CubismIdHandle; // モデルが持つ不透明度用パラメータIDのハンドル。  モデルとモーションを対応付ける。

  public _modelOpacity: number; // モーションから取得した不透明度

  private _debugMode: boolean; // デバッグモードかどうか
}

// Namespace definition for compatibility.
import * as $ from './cubismmotion';
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Live2DCubismFramework {
  export const CubismMotion = $.CubismMotion;
  export type CubismMotion = $.CubismMotion;
}
