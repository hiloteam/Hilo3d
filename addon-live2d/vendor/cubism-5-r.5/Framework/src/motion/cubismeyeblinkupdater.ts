/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { ICubismUpdater, CubismUpdateOrder } from './icubismupdater';
import { CubismModel } from '../model/cubismmodel';
import { CubismEyeBlink } from '../effect/cubismeyeblink';

/**
 * Updater for eye blink effects.
 * Handles the management of eye blink animation through the CubismEyeBlink class.
 */
export class CubismEyeBlinkUpdater extends ICubismUpdater {
  private _motionUpdated: () => boolean;
  private _eyeBlink: CubismEyeBlink;

  /**
   * Constructor
   *
   * @param motionUpdated Motion update flag reference
   * @param eyeBlink CubismEyeBlink reference
   */
  constructor(motionUpdated: () => boolean, eyeBlink: CubismEyeBlink);

  /**
   * Constructor
   *
   * @param motionUpdated Motion update flag reference
   * @param eyeBlink CubismEyeBlink reference
   * @param executionOrder Order of operations
   */
  constructor(
    motionUpdated: () => boolean,
    eyeBlink: CubismEyeBlink,
    executionOrder: number
  );

  constructor(
    motionUpdated: () => boolean,
    eyeBlink: CubismEyeBlink,
    executionOrder?: number
  ) {
    super(executionOrder ?? CubismUpdateOrder.CubismUpdateOrder_EyeBlink);
    this._motionUpdated = motionUpdated;
    this._eyeBlink = eyeBlink;
  }

  /**
   * Update process.
   *
   * @param model Model to update
   * @param deltaTimeSeconds Delta time in seconds.
   */
  onLateUpdate(model: CubismModel, deltaTimeSeconds: number): void {
    if (!model) {
      return;
    }

    if (!this._motionUpdated()) {
      // メインモーションの更新がないとき
      // 目パチ
      this._eyeBlink.updateParameters(model, deltaTimeSeconds);
    }
  }
}

// Namespace definition for compatibility.
import * as $ from './cubismeyeblinkupdater';
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Live2DCubismFramework {
  export const CubismEyeBlinkUpdater = $.CubismEyeBlinkUpdater;
  export type CubismEyeBlinkUpdater = $.CubismEyeBlinkUpdater;
}
