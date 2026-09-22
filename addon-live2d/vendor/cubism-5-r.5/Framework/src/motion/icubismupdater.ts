/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { CubismModel } from '../model/cubismmodel';

/**
 * Interface for listening to ICubismUpdater changes.
 */
export interface ICubismUpdaterChangeListener {
  /**
   * Called when an updater's execution order has changed.
   *
   * @param updater The updater that was changed
   */
  onUpdaterChanged(updater: ICubismUpdater): void;
}

export enum CubismUpdateOrder {
  CubismUpdateOrder_EyeBlink = 200,
  CubismUpdateOrder_Expression = 300,
  CubismUpdateOrder_Drag = 400,
  CubismUpdateOrder_Breath = 500,
  CubismUpdateOrder_Physics = 600,
  CubismUpdateOrder_LipSync = 700,
  CubismUpdateOrder_Pose = 800,
  CubismUpdateOrder_Max = Number.MAX_SAFE_INTEGER
}

/**
 * Abstract base class for motions.<br>
 * Handles the management of motion playback through the CubismUpdateScheduler.
 */
export abstract class ICubismUpdater {
  /**
   * Comparison function used when sorting ICubismUpdater objects.
   *
   * @param left The first ICubismUpdater object to be compared.
   * @param right The second ICubismUpdater object to be compared.
   *
   * @return negative if left should be placed before right,
   *         positive if right should be placed before left,
   *         zero if they are equal.
   */
  static sortFunction(left: ICubismUpdater, right: ICubismUpdater): number {
    if (!left || !right) {
      if (!left && !right) return 0;
      if (!left) return 1; // null/undefined elements go to end
      if (!right) return -1;
    }
    return left.getExecutionOrder() - right.getExecutionOrder();
  }

  private _executionOrder: number;
  private _changeListeners: ICubismUpdaterChangeListener[] = [];

  /**
   * Constructor
   */
  constructor(executionOrder: number = 0) {
    this._executionOrder = executionOrder;
  }

  /**
   * Update process.
   *
   * @param model Model to update
   * @param deltaTimeSeconds Delta time in seconds.
   */
  abstract onLateUpdate(model: CubismModel, deltaTimeSeconds: number): void;

  getExecutionOrder(): number {
    return this._executionOrder;
  }

  setExecutionOrder(executionOrder: number): void {
    if (this._executionOrder !== executionOrder) {
      this._executionOrder = executionOrder;
      this.notifyChangeListeners();
    }
  }

  /**
   * Adds a listener to be notified when this updater's properties change.
   *
   * @param listener The listener to add
   */
  addChangeListener(listener: ICubismUpdaterChangeListener): void {
    if (listener && this._changeListeners.indexOf(listener) === -1) {
      this._changeListeners.push(listener);
    }
  }

  /**
   * Removes a listener from the notification list.
   *
   * @param listener The listener to remove
   */
  removeChangeListener(listener: ICubismUpdaterChangeListener): void {
    const index = this._changeListeners.indexOf(listener);
    if (index >= 0) {
      this._changeListeners.splice(index, 1);
    }
  }

  /**
   * Notifies all registered listeners that this updater has changed.
   */
  private notifyChangeListeners(): void {
    for (const listener of this._changeListeners) {
      listener.onUpdaterChanged(this);
    }
  }
}

// Namespace definition for compatibility.
import * as $ from './icubismupdater';
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Live2DCubismFramework {
  export const ICubismUpdater = $.ICubismUpdater;
  export type ICubismUpdater = $.ICubismUpdater;
  export type ICubismUpdaterChangeListener = $.ICubismUpdaterChangeListener;
}
