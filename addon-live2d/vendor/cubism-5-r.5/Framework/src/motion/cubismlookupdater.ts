/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { ICubismUpdater, CubismUpdateOrder } from './icubismupdater';
import { CubismModel } from '../model/cubismmodel';
import { CubismTargetPoint } from '../math/cubismtargetpoint';
import { CubismLook } from '../effect/cubismlook';

/**
 * Updater for look effects.
 * Handles the management of dragging motion through the MotionQueueManager.
 */
export class CubismLookUpdater extends ICubismUpdater {
  private _look: CubismLook;
  private _dragManager: CubismTargetPoint;

  /**
   * Constructor
   *
   * @param look CubismLook reference
   * @param dragManager CubismTargetPoint reference
   */
  constructor(look: CubismLook, dragManager: CubismTargetPoint);

  /**
   * Constructor
   *
   * @param look CubismLook reference
   * @param dragManager CubismTargetPoint reference
   * @param executionOrder Order of operations
   */
  constructor(
    look: CubismLook,
    dragManager: CubismTargetPoint,
    executionOrder: number
  );

  constructor(
    look: CubismLook,
    dragManager: CubismTargetPoint,
    executionOrder?: number
  ) {
    super(executionOrder ?? CubismUpdateOrder.CubismUpdateOrder_Drag);
    this._look = look;
    this._dragManager = dragManager;
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

    this._dragManager.update(deltaTimeSeconds);
    const dragX = this._dragManager.getX();
    const dragY = this._dragManager.getY();

    this._look.updateParameters(model, dragX, dragY);
  }
}

// Namespace definition for compatibility.
import * as $ from './cubismlookupdater';
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Live2DCubismFramework {
  export const CubismLookUpdater = $.CubismLookUpdater;
  export type CubismLookUpdater = $.CubismLookUpdater;
}
