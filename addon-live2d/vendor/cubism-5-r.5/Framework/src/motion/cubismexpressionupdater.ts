/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { ICubismUpdater, CubismUpdateOrder } from './icubismupdater';
import { CubismModel } from '../model/cubismmodel';
import { CubismExpressionMotionManager } from './cubismexpressionmotionmanager';

/**
 * Updater for expression effects.
 * Handles the management of expression motion through the CubismExpressionMotionManager.
 */
export class CubismExpressionUpdater extends ICubismUpdater {
  private _expressionManager: CubismExpressionMotionManager;

  /**
   * Constructor
   *
   * @param expressionManager CubismExpressionMotionManager reference
   */
  constructor(expressionManager: CubismExpressionMotionManager);

  /**
   * Constructor
   *
   * @param expressionManager CubismExpressionMotionManager reference
   * @param executionOrder Order of operations
   */
  constructor(
    expressionManager: CubismExpressionMotionManager,
    executionOrder: number
  );

  constructor(
    expressionManager: CubismExpressionMotionManager,
    executionOrder?: number
  ) {
    super(executionOrder ?? CubismUpdateOrder.CubismUpdateOrder_Expression);
    this._expressionManager = expressionManager;
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

    this._expressionManager.updateMotion(model, deltaTimeSeconds);
  }
}

// Namespace definition for compatibility.
import * as $ from './cubismexpressionupdater';
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Live2DCubismFramework {
  export const CubismExpressionUpdater = $.CubismExpressionUpdater;
  export type CubismExpressionUpdater = $.CubismExpressionUpdater;
}
