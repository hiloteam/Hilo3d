/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { ICubismUpdater, CubismUpdateOrder } from './icubismupdater';
import { CubismModel } from '../model/cubismmodel';
import { CubismIdHandle } from '../id/cubismid';
import { IParameterProvider } from './iparameterprovider';

/**
 * Updater for lip sync effects.
 * Handles the management of lip sync animation through parameter providers.
 */
export class CubismLipSyncUpdater extends ICubismUpdater {
  private _lipSyncIds: Array<CubismIdHandle>;
  private _audioProvider: IParameterProvider | null;

  /**
   * Constructor
   *
   * @param lipSyncIds Array of lip sync parameter IDs
   * @param audioProvider Audio parameter provider
   */
  constructor(
    lipSyncIds: Array<CubismIdHandle>,
    audioProvider: IParameterProvider | null
  );

  /**
   * Constructor
   *
   * @param lipSyncIds Array of lip sync parameter IDs
   * @param audioProvider Audio parameter provider
   * @param executionOrder Order of operations
   */
  constructor(
    lipSyncIds: Array<CubismIdHandle>,
    audioProvider: IParameterProvider | null,
    executionOrder: number
  );

  constructor(
    lipSyncIds: Array<CubismIdHandle>,
    audioProvider: IParameterProvider | null,
    executionOrder?: number
  ) {
    super(executionOrder ?? CubismUpdateOrder.CubismUpdateOrder_LipSync);
    this._lipSyncIds = [...lipSyncIds]; // Copy array
    this._audioProvider = audioProvider;
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

    if (this._audioProvider) {
      const updateSuccessful = this._audioProvider.update(deltaTimeSeconds);
      if (updateSuccessful) {
        const lipSyncValue = this._audioProvider.getParameter();

        // Apply lip sync value to all registered parameters
        for (let i = 0; i < this._lipSyncIds.length; i++) {
          model.addParameterValueById(this._lipSyncIds[i], lipSyncValue);
        }
      }
    }
  }

  /**
   * Set audio parameter provider.
   *
   * @param audioProvider Audio parameter provider to set
   */
  setAudioProvider(audioProvider: IParameterProvider | null): void {
    this._audioProvider = audioProvider;
  }

  /**
   * Get audio parameter provider.
   *
   * @return Current audio parameter provider
   */
  getAudioProvider(): IParameterProvider | null {
    return this._audioProvider;
  }
}

// Namespace definition for compatibility.
import * as $ from './cubismlipsyncupdater';
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Live2DCubismFramework {
  export const CubismLipSyncUpdater = $.CubismLipSyncUpdater;
  export type CubismLipSyncUpdater = $.CubismLipSyncUpdater;
}
