/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { CubismIdHandle } from '../id/cubismid';
import { CubismModel } from '../model/cubismmodel';

/**
 * ターゲットによるパラメータ追従機能
 *
 * ドラッグ入力に対するパラメータ追従機能を提供する。
 */
export class CubismLook {
  /**
   * インスタンスの作成
   */
  public static create(): CubismLook {
    return new CubismLook();
  }

  /**
   * インスタンスの破棄
   * @param instance 対象のCubismDrag
   */
  public static delete(instance: CubismLook): void {
    if (instance != null) {
      instance = null;
    }
  }

  /**
   * ターゲット追従のパラメータの紐づけ
   * @param lookParameters ターゲット追従を紐づけたいパラメータのリスト
   */
  public setParameters(lookParameters: Array<LookParameterData>): void {
    this._lookParameters = lookParameters;
  }

  /**
   * ターゲット追従に紐づいているパラメータの取得
   * @return ターゲット追従に紐づいているパラメータのリスト
   */
  public getParameters(): Array<LookParameterData> {
    return this._lookParameters;
  }

  /**
   * モデルのパラメータの更新
   * @param model 対象のモデル
   * @param dragX ターゲットのX座標
   * @param dragY ターゲットのY座標
   */
  public updateParameters(
    model: CubismModel,
    dragX: number,
    dragY: number
  ): void {
    for (let i = 0; i < this._lookParameters.length; ++i) {
      const data: LookParameterData = this._lookParameters[i];

      model.addParameterValueById(
        data.parameterId,
        data.factorX * dragX +
          data.factorY * dragY +
          data.factorXY * dragX * dragY
      );
    }
  }

  /**
   * コンストラクタ
   */
  public constructor() {
    this._lookParameters = new Array<LookParameterData>();
  }

  _lookParameters: Array<LookParameterData>; // ターゲット追従に紐づいているパラメータのリスト
}

/**
 * ターゲット追従のパラメータ情報
 */
export class LookParameterData {
  /**
   * コンストラクタ
   * @param parameterId   ターゲット追従を紐づけるパラメータID
   * @param factorX       X方向ドラッグ入力に対する係数
   * @param factorY       Y方向ドラッグ入力に対する係数
   * @param factorXY      XY積ドラッグ入力に対する係数
   */
  constructor(
    parameterId?: CubismIdHandle,
    factorX?: number,
    factorY?: number,
    factorXY?: number
  ) {
    this.parameterId = parameterId == undefined ? null : parameterId;
    this.factorX = factorX == undefined ? 0.0 : factorX;
    this.factorY = factorY == undefined ? 0.0 : factorY;
    this.factorXY = factorXY == undefined ? 0.0 : factorXY;
  }

  parameterId: CubismIdHandle; // ターゲット追従を紐づけるパラメータID
  factorX: number; // X方向ドラッグ入力に対する係数
  factorY: number; // Y方向ドラッグ入力に対する係数
  factorXY: number; // XY積ドラッグ入力に対する係数
}

// Namespace definition for compatibility.
import * as $ from './cubismlook';
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Live2DCubismFramework {
  export const LookParameterData = $.LookParameterData;
  export type LookParameterData = $.LookParameterData;
  export const CubismLook = $.CubismLook;
  export type CubismLook = $.CubismLook;
}
