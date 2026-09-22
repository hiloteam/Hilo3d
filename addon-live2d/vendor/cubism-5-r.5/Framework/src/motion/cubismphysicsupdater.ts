/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { ICubismUpdater, CubismUpdateOrder } from './icubismupdater';
import { CubismModel } from '../model/cubismmodel';
import { CubismPhysics } from '../physics/cubismphysics';

/**
 * Updater for physics effects.
 * Handles the management of physics simulation through the CubismPhysics class.
 */
export class CubismPhysicsUpdater extends ICubismUpdater {
  private _physics: CubismPhysics;

  /**
   * Constructor
   *
   * @param physics CubismPhysics reference
   */
  constructor(physics: CubismPhysics);

  /**
   * Constructor
   *
   * @param physics CubismPhysics reference
   * @param executionOrder Order of operations
   */
  constructor(physics: CubismPhysics, executionOrder: number);

  constructor(physics: CubismPhysics, executionOrder?: number) {
    super(executionOrder ?? CubismUpdateOrder.CubismUpdateOrder_Physics);
    this._physics = physics;
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

    this._physics.evaluate(model, deltaTimeSeconds);
  }
}

// Namespace definition for compatibility.
import * as $ from './cubismphysicsupdater';
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Live2DCubismFramework {
  export const CubismPhysicsUpdater = $.CubismPhysicsUpdater;
  export type CubismPhysicsUpdater = $.CubismPhysicsUpdater;
}
