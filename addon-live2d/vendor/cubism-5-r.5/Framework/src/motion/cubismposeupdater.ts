/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { ICubismUpdater, CubismUpdateOrder } from './icubismupdater';
import { CubismModel } from '../model/cubismmodel';
import { CubismPose } from '../effect/cubismpose';

/**
 * Updater for pose effects.
 * Handles the management of pose animation through the CubismPose class.
 */
export class CubismPoseUpdater extends ICubismUpdater {
  private _pose: CubismPose;

  /**
   * Constructor
   *
   * @param pose CubismPose reference
   */
  constructor(pose: CubismPose);

  /**
   * Constructor
   *
   * @param pose CubismPose reference
   * @param executionOrder Order of operations
   */
  constructor(pose: CubismPose, executionOrder: number);

  constructor(pose: CubismPose, executionOrder?: number) {
    super(executionOrder ?? CubismUpdateOrder.CubismUpdateOrder_Pose);
    this._pose = pose;
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

    this._pose.updateParameters(model, deltaTimeSeconds);
  }
}

// Namespace definition for compatibility.
import * as $ from './cubismposeupdater';
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Live2DCubismFramework {
  export const CubismPoseUpdater = $.CubismPoseUpdater;
  export type CubismPoseUpdater = $.CubismPoseUpdater;
}
