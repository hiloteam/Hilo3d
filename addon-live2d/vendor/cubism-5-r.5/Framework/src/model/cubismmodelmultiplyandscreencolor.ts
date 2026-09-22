/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { CubismTextureColor } from '../rendering/cubismrenderer';
import { CubismModelObjectType, NoOffscreenIndex } from './cubismmodel';
import { CubismLogWarning } from '../utils/cubismdebug';

/**
 * SDK側から与えられた描画オブジェクトの乗算色・スクリーン色上書きフラグと
 * その色を保持する構造体
 */
export class ColorData {
  constructor(
    isOverridden = false,
    color: CubismTextureColor = new CubismTextureColor()
  ) {
    this.isOverridden = isOverridden;
    this.color = color;
  }

  public isOverridden: boolean;
  public color: CubismTextureColor;
}

/**
 * Handling multiply and screen colors of the model.
 */
export class CubismModelMultiplyAndScreenColor {
  private _model: any; // CubismModel
  private _isOverriddenModelMultiplyColors: boolean;
  private _isOverriddenModelScreenColors: boolean;
  private _userPartScreenColors: Array<ColorData>;
  private _userPartMultiplyColors: Array<ColorData>;
  private _userDrawableScreenColors: Array<ColorData>;
  private _userDrawableMultiplyColors: Array<ColorData>;
  private _userOffscreenScreenColors: Array<ColorData>;
  private _userOffscreenMultiplyColors: Array<ColorData>;

  /**
   * Constructor.
   *
   * @param model cubism model.
   */
  public constructor(model: any) {
    this._model = model;
    this._isOverriddenModelMultiplyColors = false;
    this._isOverriddenModelScreenColors = false;
    this._userPartScreenColors = [];
    this._userPartMultiplyColors = [];
    this._userDrawableScreenColors = [];
    this._userDrawableMultiplyColors = [];
    this._userOffscreenScreenColors = [];
    this._userOffscreenMultiplyColors = [];
  }

  /**
   * Initialization for using multiply and screen colors.
   *
   * @param partCount number of parts.
   * @param drawableCount number of drawables.
   * @param offscreenCount number of offscreen.
   */
  public initialize(
    partCount: number,
    drawableCount: number,
    offscreenCount: number
  ): void {
    // 乗算色の初期値
    const userMultiplyColor = new ColorData(
      false,
      new CubismTextureColor(1.0, 1.0, 1.0, 1.0)
    );

    // スクリーン色の初期値
    const userScreenColor = new ColorData(
      false,
      new CubismTextureColor(0.0, 0.0, 0.0, 1.0)
    );

    // Part
    this._userPartMultiplyColors = new Array(partCount);
    this._userPartScreenColors = new Array(partCount);
    for (let i = 0; i < partCount; i++) {
      this._userPartMultiplyColors[i] = new ColorData(
        userMultiplyColor.isOverridden,
        new CubismTextureColor(
          userMultiplyColor.color.r,
          userMultiplyColor.color.g,
          userMultiplyColor.color.b,
          userMultiplyColor.color.a
        )
      );
      this._userPartScreenColors[i] = new ColorData(
        userScreenColor.isOverridden,
        new CubismTextureColor(
          userScreenColor.color.r,
          userScreenColor.color.g,
          userScreenColor.color.b,
          userScreenColor.color.a
        )
      );
    }

    // Drawable
    this._userDrawableMultiplyColors = new Array(drawableCount);
    this._userDrawableScreenColors = new Array(drawableCount);
    for (let i = 0; i < drawableCount; i++) {
      this._userDrawableMultiplyColors[i] = new ColorData(
        userMultiplyColor.isOverridden,
        new CubismTextureColor(
          userMultiplyColor.color.r,
          userMultiplyColor.color.g,
          userMultiplyColor.color.b,
          userMultiplyColor.color.a
        )
      );
      this._userDrawableScreenColors[i] = new ColorData(
        userScreenColor.isOverridden,
        new CubismTextureColor(
          userScreenColor.color.r,
          userScreenColor.color.g,
          userScreenColor.color.b,
          userScreenColor.color.a
        )
      );
    }

    // Offscreen
    this._userOffscreenMultiplyColors = new Array(offscreenCount);
    this._userOffscreenScreenColors = new Array(offscreenCount);
    for (let i = 0; i < offscreenCount; i++) {
      this._userOffscreenMultiplyColors[i] = new ColorData(
        userMultiplyColor.isOverridden,
        new CubismTextureColor(
          userMultiplyColor.color.r,
          userMultiplyColor.color.g,
          userMultiplyColor.color.b,
          userMultiplyColor.color.a
        )
      );
      this._userOffscreenScreenColors[i] = new ColorData(
        userScreenColor.isOverridden,
        new CubismTextureColor(
          userScreenColor.color.r,
          userScreenColor.color.g,
          userScreenColor.color.b,
          userScreenColor.color.a
        )
      );
    }
  }

  /**
   * Outputs a warning message for index out of range errors.
   *
   * @param functionName Name of the calling function
   * @param index The invalid index value
   * @param maxIndex The maximum valid index (length - 1)
   */
  private warnIndexOutOfRange(
    functionName: string,
    index: number,
    maxIndex: number
  ): void {
    CubismLogWarning(
      `${functionName}: index is out of range. index=${index}, valid range=[0, ${maxIndex}].`
    );
  }

  /**
   * Validates if the given part index is within valid range.
   *
   * @param index Part index to validate
   * @param functionName Name of the calling function for error reporting
   * @return true if the index is valid; otherwise false
   */
  private isValidPartIndex(index: number, functionName: string): boolean {
    if (index < 0 || index >= this._model.getPartCount()) {
      this.warnIndexOutOfRange(
        functionName,
        index,
        this._model.getPartCount() - 1
      );
      return false;
    }
    return true;
  }

  /**
   * Validates if the given drawable index is within valid range.
   *
   * @param index Drawable index to validate
   * @param functionName Name of the calling function for error reporting
   * @return true if the index is valid; otherwise false
   */
  private isValidDrawableIndex(index: number, functionName: string): boolean {
    if (index < 0 || index >= this._model.getDrawableCount()) {
      this.warnIndexOutOfRange(
        functionName,
        index,
        this._model.getDrawableCount() - 1
      );
      return false;
    }
    return true;
  }

  /**
   * Validates if the given offscreen index is within valid range.
   *
   * @param index Offscreen index to validate
   * @param functionName Name of the calling function for error reporting
   * @return true if the index is valid; otherwise false
   */
  private isValidOffscreenIndex(index: number, functionName: string): boolean {
    if (index < 0 || index >= this._model.getOffscreenCount()) {
      this.warnIndexOutOfRange(
        functionName,
        index,
        this._model.getOffscreenCount() - 1
      );
      return false;
    }
    return true;
  }

  /**
   * Sets the flag indicating whether the color set at runtime is used as the multiply color for the entire model during rendering.
   *
   * @param value true if the color set at runtime is to be used; otherwise false.
   */
  public setMultiplyColorEnabled(value: boolean): void {
    this._isOverriddenModelMultiplyColors = value;
  }

  /**
   * Returns the flag indicating whether the color set at runtime is used as the multiply color for the entire model during rendering.
   *
   * @return true if the color set at runtime is used; otherwise false.
   */
  public getMultiplyColorEnabled(): boolean {
    return this._isOverriddenModelMultiplyColors;
  }

  /**
   * Sets the flag indicating whether the color set at runtime is used as the screen color for the entire model during rendering.
   *
   * @param value true if the color set at runtime is to be used; otherwise false.
   */
  public setScreenColorEnabled(value: boolean): void {
    this._isOverriddenModelScreenColors = value;
  }

  /**
   * Returns the flag indicating whether the color set at runtime is used as the screen color for the entire model during rendering.
   *
   * @return true if the color set at runtime is used; otherwise false.
   */
  public getScreenColorEnabled(): boolean {
    return this._isOverriddenModelScreenColors;
  }

  /**
   * Sets whether the part multiply color is overridden by the SDK.
   * Use true to use the color information from the SDK, or false to use the color information from the model.
   *
   * @param partIndex Part index
   * @param value true enable override, false to disable
   */
  public setPartMultiplyColorEnabled(partIndex: number, value: boolean): void {
    if (!this.isValidPartIndex(partIndex, 'setPartMultiplyColorEnabled')) {
      return;
    }
    this.setPartColorEnabled(
      partIndex,
      value,
      this._userPartMultiplyColors,
      this._userDrawableMultiplyColors,
      this._userOffscreenMultiplyColors
    );
  }

  /**
   * Checks whether the part multiply color is overridden by the SDK.
   *
   * @param partIndex Part index
   *
   * @return true if the color information from the SDK is used; otherwise false.
   */
  public getPartMultiplyColorEnabled(partIndex: number): boolean {
    if (!this.isValidPartIndex(partIndex, 'getPartMultiplyColorEnabled')) {
      return false;
    }
    return this._userPartMultiplyColors[partIndex].isOverridden;
  }

  /**
   * Sets whether the part screen color is overridden by the SDK.
   * Use true to use the color information from the SDK, or false to use the color information from the model.
   *
   * @param partIndex Part index
   * @param value true enable override, false to disable
   */
  public setPartScreenColorEnabled(partIndex: number, value: boolean): void {
    if (!this.isValidPartIndex(partIndex, 'setPartScreenColorEnabled')) {
      return;
    }
    this.setPartColorEnabled(
      partIndex,
      value,
      this._userPartScreenColors,
      this._userDrawableScreenColors,
      this._userOffscreenScreenColors
    );
  }

  /**
   * Checks whether the part screen color is overridden by the SDK.
   *
   * @param partIndex Part index
   *
   * @return true if the color information from the SDK is used; otherwise false.
   */
  public getPartScreenColorEnabled(partIndex: number): boolean {
    if (!this.isValidPartIndex(partIndex, 'getPartScreenColorEnabled')) {
      return false;
    }
    return this._userPartScreenColors[partIndex].isOverridden;
  }

  /**
   * Sets the multiply color of the part.
   *
   * @param partIndex Part index
   * @param color Multiply color to be set (CubismTextureColor)
   */
  public setPartMultiplyColorByTextureColor(
    partIndex: number,
    color: CubismTextureColor
  ): void {
    if (
      !this.isValidPartIndex(partIndex, 'setPartMultiplyColorByTextureColor')
    ) {
      return;
    }
    this.setPartMultiplyColorByRGBA(
      partIndex,
      color.r,
      color.g,
      color.b,
      color.a
    );
  }

  /**
   * Sets the multiply color of the part.
   *
   * @param partIndex Part index
   * @param r Red value of the multiply color to be set
   * @param g Green value of the multiply color to be set
   * @param b Blue value of the multiply color to be set
   * @param a Alpha value of the multiply color to be set
   */
  public setPartMultiplyColorByRGBA(
    partIndex: number,
    r: number,
    g: number,
    b: number,
    a: number = 1.0
  ): void {
    if (!this.isValidPartIndex(partIndex, 'setPartMultiplyColorByRGBA')) {
      return;
    }
    this.setPartColor(
      partIndex,
      r,
      g,
      b,
      a,
      this._userPartMultiplyColors,
      this._userDrawableMultiplyColors,
      this._userOffscreenMultiplyColors
    );
  }

  /**
   * Returns the multiply color of the part.
   *
   * @param partIndex Part index
   *
   * @return Multiply color (CubismTextureColor)
   */
  public getPartMultiplyColor(partIndex: number): CubismTextureColor {
    if (!this.isValidPartIndex(partIndex, 'getPartMultiplyColor')) {
      return new CubismTextureColor(1.0, 1.0, 1.0, 1.0);
    }
    return this._userPartMultiplyColors[partIndex].color;
  }

  /**
   * Sets the screen color of the part.
   *
   * @param partIndex Part index
   * @param color Screen color to be set (CubismTextureColor)
   */
  public setPartScreenColorByTextureColor(
    partIndex: number,
    color: CubismTextureColor
  ): void {
    if (!this.isValidPartIndex(partIndex, 'setPartScreenColorByTextureColor')) {
      return;
    }
    this.setPartScreenColorByRGBA(
      partIndex,
      color.r,
      color.g,
      color.b,
      color.a
    );
  }

  /**
   * Sets the screen color of the part.
   *
   * @param partIndex Part index
   * @param r Red value of the screen color to be set
   * @param g Green value of the screen color to be set
   * @param b Blue value of the screen color to be set
   * @param a Alpha value of the screen color to be set
   */
  public setPartScreenColorByRGBA(
    partIndex: number,
    r: number,
    g: number,
    b: number,
    a: number = 1.0
  ): void {
    if (!this.isValidPartIndex(partIndex, 'setPartScreenColorByRGBA')) {
      return;
    }
    this.setPartColor(
      partIndex,
      r,
      g,
      b,
      a,
      this._userPartScreenColors,
      this._userDrawableScreenColors,
      this._userOffscreenScreenColors
    );
  }

  /**
   * Returns the screen color of the part.
   *
   * @param partIndex Part index
   *
   * @return Screen color (CubismTextureColor)
   */
  public getPartScreenColor(partIndex: number): CubismTextureColor {
    if (!this.isValidPartIndex(partIndex, 'getPartScreenColor')) {
      return new CubismTextureColor(0.0, 0.0, 0.0, 1.0);
    }
    return this._userPartScreenColors[partIndex].color;
  }

  /**
   * Sets the flag indicating whether the color set at runtime is used as the multiply color for the drawable during rendering.
   *
   * @param drawableIndex Drawable index
   * @param value true if the color set at runtime is to be used; otherwise false.
   */
  public setDrawableMultiplyColorEnabled(
    drawableIndex: number,
    value: boolean
  ): void {
    if (
      !this.isValidDrawableIndex(
        drawableIndex,
        'setDrawableMultiplyColorEnabled'
      )
    ) {
      return;
    }
    this._userDrawableMultiplyColors[drawableIndex].isOverridden = value;
  }

  /**
   * Returns the flag indicating whether the color set at runtime is used as the multiply color for the drawable during rendering.
   *
   * @param drawableIndex Drawable index
   *
   * @return true if the color set at runtime is used; otherwise false.
   */
  public getDrawableMultiplyColorEnabled(drawableIndex: number): boolean {
    if (
      !this.isValidDrawableIndex(
        drawableIndex,
        'getDrawableMultiplyColorEnabled'
      )
    ) {
      return false;
    }
    return this._userDrawableMultiplyColors[drawableIndex].isOverridden;
  }

  /**
   * Sets the flag indicating whether the color set at runtime is used as the screen color for the drawable during rendering.
   *
   * @param drawableIndex Drawable index
   * @param value true if the color set at runtime is to be used; otherwise false.
   */
  public setDrawableScreenColorEnabled(
    drawableIndex: number,
    value: boolean
  ): void {
    if (
      !this.isValidDrawableIndex(drawableIndex, 'setDrawableScreenColorEnabled')
    ) {
      return;
    }
    this._userDrawableScreenColors[drawableIndex].isOverridden = value;
  }

  /**
   * Returns the flag indicating whether the color set at runtime is used as the screen color for the drawable during rendering.
   *
   * @param drawableIndex Drawable index
   *
   * @return true if the color set at runtime is used; otherwise false.
   */
  public getDrawableScreenColorEnabled(drawableIndex: number): boolean {
    if (
      !this.isValidDrawableIndex(drawableIndex, 'getDrawableScreenColorEnabled')
    ) {
      return false;
    }
    return this._userDrawableScreenColors[drawableIndex].isOverridden;
  }

  /**
   * Sets the multiply color of the drawable.
   *
   * @param drawableIndex Drawable index
   * @param color Multiply color to be set (CubismTextureColor)
   */
  public setDrawableMultiplyColorByTextureColor(
    drawableIndex: number,
    color: CubismTextureColor
  ): void {
    if (
      !this.isValidDrawableIndex(
        drawableIndex,
        'setDrawableMultiplyColorByTextureColor'
      )
    ) {
      return;
    }
    this.setDrawableMultiplyColorByRGBA(
      drawableIndex,
      color.r,
      color.g,
      color.b,
      color.a
    );
  }

  /**
   * Sets the multiply color of the drawable.
   *
   * @param drawableIndex Drawable index
   * @param r Red value of the multiply color to be set
   * @param g Green value of the multiply color to be set
   * @param b Blue value of the multiply color to be set
   * @param a Alpha value of the multiply color to be set
   */
  public setDrawableMultiplyColorByRGBA(
    drawableIndex: number,
    r: number,
    g: number,
    b: number,
    a: number = 1.0
  ): void {
    if (
      !this.isValidDrawableIndex(
        drawableIndex,
        'setDrawableMultiplyColorByRGBA'
      )
    ) {
      return;
    }
    this._userDrawableMultiplyColors[drawableIndex].color.r = r;
    this._userDrawableMultiplyColors[drawableIndex].color.g = g;
    this._userDrawableMultiplyColors[drawableIndex].color.b = b;
    this._userDrawableMultiplyColors[drawableIndex].color.a = a;
  }

  /**
   * Returns the multiply color from the list of drawables.
   *
   * @param drawableIndex Drawable index
   *
   * @return Multiply color (CubismTextureColor)
   */
  public getDrawableMultiplyColor(drawableIndex: number): CubismTextureColor {
    if (!this.isValidDrawableIndex(drawableIndex, 'getDrawableMultiplyColor')) {
      return new CubismTextureColor(1.0, 1.0, 1.0, 1.0);
    }
    if (
      this.getMultiplyColorEnabled() ||
      this.getDrawableMultiplyColorEnabled(drawableIndex)
    ) {
      return this._userDrawableMultiplyColors[drawableIndex].color;
    }
    return this._model.getDrawableMultiplyColor(drawableIndex);
  }

  /**
   * Sets the screen color of the drawable.
   *
   * @param drawableIndex Drawable index
   * @param color Screen color to be set (CubismTextureColor)
   */
  public setDrawableScreenColorByTextureColor(
    drawableIndex: number,
    color: CubismTextureColor
  ): void {
    if (
      !this.isValidDrawableIndex(
        drawableIndex,
        'setDrawableScreenColorByTextureColor'
      )
    ) {
      return;
    }
    this.setDrawableScreenColorByRGBA(
      drawableIndex,
      color.r,
      color.g,
      color.b,
      color.a
    );
  }

  /**
   * Sets the screen color of the drawable.
   *
   * @param drawableIndex Drawable index
   * @param r Red value of the screen color to be set
   * @param g Green value of the screen color to be set
   * @param b Blue value of the screen color to be set
   * @param a Alpha value of the screen color to be set
   */
  public setDrawableScreenColorByRGBA(
    drawableIndex: number,
    r: number,
    g: number,
    b: number,
    a: number = 1.0
  ): void {
    if (
      !this.isValidDrawableIndex(drawableIndex, 'setDrawableScreenColorByRGBA')
    ) {
      return;
    }
    this._userDrawableScreenColors[drawableIndex].color.r = r;
    this._userDrawableScreenColors[drawableIndex].color.g = g;
    this._userDrawableScreenColors[drawableIndex].color.b = b;
    this._userDrawableScreenColors[drawableIndex].color.a = a;
  }

  /**
   * Returns the screen color from the list of drawables.
   *
   * @param drawableIndex Drawable index
   *
   * @return Screen color (CubismTextureColor)
   */
  public getDrawableScreenColor(drawableIndex: number): CubismTextureColor {
    if (!this.isValidDrawableIndex(drawableIndex, 'getDrawableScreenColor')) {
      return new CubismTextureColor(0.0, 0.0, 0.0, 1.0);
    }
    if (
      this.getScreenColorEnabled() ||
      this.getDrawableScreenColorEnabled(drawableIndex)
    ) {
      return this._userDrawableScreenColors[drawableIndex].color;
    }
    return this._model.getDrawableScreenColor(drawableIndex);
  }

  /**
   * Sets whether the offscreen multiply color is overridden by the SDK.
   * Use true to use the color information from the SDK, or false to use the color information from the model.
   *
   * @param offscreenIndex Offscreen index
   * @param value true enable override, false to disable
   */
  public setOffscreenMultiplyColorEnabled(
    offscreenIndex: number,
    value: boolean
  ): void {
    if (
      !this.isValidOffscreenIndex(
        offscreenIndex,
        'setOffscreenMultiplyColorEnabled'
      )
    ) {
      return;
    }
    this._userOffscreenMultiplyColors[offscreenIndex].isOverridden = value;
  }

  /**
   * Checks whether the offscreen multiply color is overridden by the SDK.
   *
   * @param offscreenIndex Offscreen index
   *
   * @return true if the color information from the SDK is used; otherwise false.
   */
  public getOffscreenMultiplyColorEnabled(offscreenIndex: number): boolean {
    if (
      !this.isValidOffscreenIndex(
        offscreenIndex,
        'getOffscreenMultiplyColorEnabled'
      )
    ) {
      return false;
    }
    return this._userOffscreenMultiplyColors[offscreenIndex].isOverridden;
  }

  /**
   * Sets whether the offscreen screen color is overridden by the SDK.
   * Use true to use the color information from the SDK, or false to use the color information from the model.
   *
   * @param offscreenIndex Offscreen index
   * @param value true enable override, false to disable
   */
  public setOffscreenScreenColorEnabled(
    offscreenIndex: number,
    value: boolean
  ): void {
    if (
      !this.isValidOffscreenIndex(
        offscreenIndex,
        'setOffscreenScreenColorEnabled'
      )
    ) {
      return;
    }
    this._userOffscreenScreenColors[offscreenIndex].isOverridden = value;
  }

  /**
   * Checks whether the offscreen screen color is overridden by the SDK.
   *
   * @param offscreenIndex Offscreen index
   *
   * @return true if the color information from the SDK is used; otherwise false.
   */
  public getOffscreenScreenColorEnabled(offscreenIndex: number): boolean {
    if (
      !this.isValidOffscreenIndex(
        offscreenIndex,
        'getOffscreenScreenColorEnabled'
      )
    ) {
      return false;
    }
    return this._userOffscreenScreenColors[offscreenIndex].isOverridden;
  }

  /**
   * Sets the multiply color of the offscreen.
   *
   * @param offscreenIndex Offsscreen index
   * @param color Multiply color to be set (CubismTextureColor)
   */
  public setOffscreenMultiplyColorByTextureColor(
    offscreenIndex: number,
    color: CubismTextureColor
  ): void {
    if (
      !this.isValidOffscreenIndex(
        offscreenIndex,
        'setOffscreenMultiplyColorByTextureColor'
      )
    ) {
      return;
    }
    this.setOffscreenMultiplyColorByRGBA(
      offscreenIndex,
      color.r,
      color.g,
      color.b,
      color.a
    );
  }

  /**
   * Sets the multiply color of the offscreen.
   *
   * @param offscreenIndex Offsscreen index
   * @param r Red value of the multiply color to be set
   * @param g Green value of the multiply color to be set
   * @param b Blue value of the multiply color to be set
   * @param a Alpha value of the multiply color to be set
   */
  public setOffscreenMultiplyColorByRGBA(
    offscreenIndex: number,
    r: number,
    g: number,
    b: number,
    a: number = 1.0
  ): void {
    if (
      !this.isValidOffscreenIndex(
        offscreenIndex,
        'setOffscreenMultiplyColorByRGBA'
      )
    ) {
      return;
    }
    this._userOffscreenMultiplyColors[offscreenIndex].color.r = r;
    this._userOffscreenMultiplyColors[offscreenIndex].color.g = g;
    this._userOffscreenMultiplyColors[offscreenIndex].color.b = b;
    this._userOffscreenMultiplyColors[offscreenIndex].color.a = a;
  }

  /**
   * Returns the multiply color from the list of offscreen.
   *
   * @param offscreenIndex Offsscreen index
   *
   * @return Multiply color (CubismTextureColor)
   */
  public getOffscreenMultiplyColor(offscreenIndex: number): CubismTextureColor {
    if (
      !this.isValidOffscreenIndex(offscreenIndex, 'getOffscreenMultiplyColor')
    ) {
      return new CubismTextureColor(1.0, 1.0, 1.0, 1.0); // Default offscreen multiply color
    }
    if (
      this.getMultiplyColorEnabled() ||
      this.getOffscreenMultiplyColorEnabled(offscreenIndex)
    ) {
      return this._userOffscreenMultiplyColors[offscreenIndex].color;
    }
    return this._model.getOffscreenMultiplyColor(offscreenIndex);
  }

  /**
   * Sets the screen color of the offscreen.
   *
   * @param offscreenIndex Offsscreen index
   * @param color Screen color to be set (CubismTextureColor)
   */
  public setOffscreenScreenColorByTextureColor(
    offscreenIndex: number,
    color: CubismTextureColor
  ): void {
    if (
      !this.isValidOffscreenIndex(
        offscreenIndex,
        'setOffscreenScreenColorByTextureColor'
      )
    ) {
      return;
    }
    this.setOffscreenScreenColorByRGBA(
      offscreenIndex,
      color.r,
      color.g,
      color.b,
      color.a
    );
  }

  /**
   * Sets the screen color of the offscreen.
   *
   * @param offscreenIndex Offsscreen index
   * @param r Red value of the screen color to be set
   * @param g Green value of the screen color to be set
   * @param b Blue value of the screen color to be set
   * @param a Alpha value of the screen color to be set
   */
  public setOffscreenScreenColorByRGBA(
    offscreenIndex: number,
    r: number,
    g: number,
    b: number,
    a: number = 1.0
  ): void {
    if (
      !this.isValidOffscreenIndex(
        offscreenIndex,
        'setOffscreenScreenColorByRGBA'
      )
    ) {
      return;
    }
    this._userOffscreenScreenColors[offscreenIndex].color.r = r;
    this._userOffscreenScreenColors[offscreenIndex].color.g = g;
    this._userOffscreenScreenColors[offscreenIndex].color.b = b;
    this._userOffscreenScreenColors[offscreenIndex].color.a = a;
  }

  /**
   * Returns the screen color from the list of offscreen.
   *
   * @param offscreenIndex Offsscreen index
   *
   * @return Screen color (CubismTextureColor)
   */
  public getOffscreenScreenColor(offscreenIndex: number): CubismTextureColor {
    if (
      !this.isValidOffscreenIndex(offscreenIndex, 'getOffscreenScreenColor')
    ) {
      return new CubismTextureColor(0.0, 0.0, 0.0, 1.0); // Default offscreen screen color
    }
    if (
      this.getScreenColorEnabled() ||
      this.getOffscreenScreenColorEnabled(offscreenIndex)
    ) {
      return this._userOffscreenScreenColors[offscreenIndex].color;
    }
    return this._model.getOffscreenScreenColor(offscreenIndex);
  }

  /**
   * Sets the part color with hierarchical propagation (internal method)
   */
  private setPartColor(
    partIndex: number,
    r: number,
    g: number,
    b: number,
    a: number,
    partColors: Array<ColorData>,
    drawableColors: Array<ColorData>,
    offscreenColors: Array<ColorData>
  ): void {
    partColors[partIndex].color.r = r;
    partColors[partIndex].color.g = g;
    partColors[partIndex].color.b = b;
    partColors[partIndex].color.a = a;

    if (partColors[partIndex].isOverridden) {
      const offscreenIndices = this._model.getPartOffscreenIndices();
      const offscreenIndex = offscreenIndices[partIndex];
      if (offscreenIndex == NoOffscreenIndex) {
        // If no offscreen buffer is attached, the effect is applied to the children.
        const partsHierarchy = this._model.getPartsHierarchy();
        if (partsHierarchy && partsHierarchy[partIndex]) {
          for (let i = 0; i < partsHierarchy[partIndex].objects.length; ++i) {
            const objectInfo = partsHierarchy[partIndex].objects[i];
            if (
              objectInfo.objectType ===
              CubismModelObjectType.CubismModelObjectType_Drawable
            ) {
              const drawableIndex = objectInfo.objectIndex;
              drawableColors[drawableIndex].color.r = r;
              drawableColors[drawableIndex].color.g = g;
              drawableColors[drawableIndex].color.b = b;
              drawableColors[drawableIndex].color.a = a;
            } else {
              const childPartIndex = objectInfo.objectIndex;
              this.setPartColor(
                childPartIndex,
                r,
                g,
                b,
                a,
                partColors,
                drawableColors,
                offscreenColors
              );
            }
          }
        }
      } else {
        // If an offscreen buffer is attached, only that offscreen buffer is affected.
        offscreenColors[offscreenIndex].color.r = r;
        offscreenColors[offscreenIndex].color.g = g;
        offscreenColors[offscreenIndex].color.b = b;
        offscreenColors[offscreenIndex].color.a = a;
      }
    }
  }

  /**
   * Sets the part color enabled flag with hierarchical propagation (internal method)
   */
  private setPartColorEnabled(
    partIndex: number,
    value: boolean,
    partColors: Array<ColorData>,
    drawableColors: Array<ColorData>,
    offscreenColors: Array<ColorData>
  ): void {
    partColors[partIndex].isOverridden = value;

    const offscreenIndices = this._model.getPartOffscreenIndices();
    const offscreenIndex = offscreenIndices[partIndex];
    if (offscreenIndex == NoOffscreenIndex) {
      // If no offscreen buffer is attached, the effect is applied to the children.
      const partsHierarchy = this._model.getPartsHierarchy();
      if (partsHierarchy && partsHierarchy[partIndex]) {
        for (let i = 0; i < partsHierarchy[partIndex].objects.length; ++i) {
          const objectInfo = partsHierarchy[partIndex].objects[i];
          if (
            objectInfo.objectType ===
            CubismModelObjectType.CubismModelObjectType_Drawable
          ) {
            const drawableIndex = objectInfo.objectIndex;
            drawableColors[drawableIndex].isOverridden = value;
            if (value) {
              drawableColors[drawableIndex].color.r =
                partColors[partIndex].color.r;
              drawableColors[drawableIndex].color.g =
                partColors[partIndex].color.g;
              drawableColors[drawableIndex].color.b =
                partColors[partIndex].color.b;
              drawableColors[drawableIndex].color.a =
                partColors[partIndex].color.a;
            }
          } else {
            const childPartIndex = objectInfo.objectIndex;
            if (value) {
              partColors[childPartIndex].color.r =
                partColors[partIndex].color.r;
              partColors[childPartIndex].color.g =
                partColors[partIndex].color.g;
              partColors[childPartIndex].color.b =
                partColors[partIndex].color.b;
              partColors[childPartIndex].color.a =
                partColors[partIndex].color.a;
            }
            this.setPartColorEnabled(
              childPartIndex,
              value,
              partColors,
              drawableColors,
              offscreenColors
            );
          }
        }
      }
    } else {
      // If an offscreen buffer is attached, only that offscreen buffer is affected.
      offscreenColors[offscreenIndex].isOverridden = value;
      if (value) {
        offscreenColors[offscreenIndex].color.r = partColors[partIndex].color.r;
        offscreenColors[offscreenIndex].color.g = partColors[partIndex].color.g;
        offscreenColors[offscreenIndex].color.b = partColors[partIndex].color.b;
        offscreenColors[offscreenIndex].color.a = partColors[partIndex].color.a;
      }
    }
  }
}
