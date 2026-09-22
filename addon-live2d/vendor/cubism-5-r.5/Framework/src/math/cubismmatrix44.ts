/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { CubismMath } from './cubismmath';

/**
 * 4x4の行列
 *
 * 4x4行列の便利クラス。
 */
export class CubismMatrix44 {
  /**
   * コンストラクタ
   */
  public constructor() {
    this._tr = new Float32Array(16); // 4 * 4のサイズ
    this.loadIdentity();
  }

  /**
   * 受け取った２つの行列の乗算を行う。
   *
   * @param a 行列a
   * @param b 行列b
   *
   * @return 乗算結果の行列
   */
  public static multiply(
    a: Float32Array,
    b: Float32Array,
    dst: Float32Array
  ): void {
    const c: Float32Array = new Float32Array([
      0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
      0.0
    ]);

    const n = 4;

    for (let i = 0; i < n; ++i) {
      for (let j = 0; j < n; ++j) {
        for (let k = 0; k < n; ++k) {
          c[j + i * 4] += a[k + i * 4] * b[j + k * 4];
        }
      }
    }

    for (let i = 0; i < 16; ++i) {
      dst[i] = c[i];
    }
  }

  /**
   * 単位行列に初期化する
   */
  public loadIdentity(): void {
    const c: Float32Array = new Float32Array([
      1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0,
      1.0
    ]);

    this.setMatrix(c);
  }

  /**
   * 行列を設定
   *
   * @param tr 16個の浮動小数点数で表される4x4の行列
   */
  public setMatrix(tr: Float32Array): void {
    for (let i = 0; i < 16; ++i) {
      this._tr[i] = tr[i];
    }
  }

  /**
   * 行列を浮動小数点数の配列で取得
   *
   * @return 16個の浮動小数点数で表される4x4の行列
   */
  public getArray(): Float32Array {
    return this._tr;
  }

  /**
   * X軸の拡大率を取得
   *
   * @return X軸の拡大率
   */
  public getScaleX(): number {
    return this._tr[0];
  }

  /**
   * Y軸の拡大率を取得する
   *
   * @return Y軸の拡大率
   */
  public getScaleY(): number {
    return this._tr[5];
  }

  /**
   * X軸の移動量を取得
   *
   * @return X軸の移動量
   */
  public getTranslateX(): number {
    return this._tr[12];
  }

  /**
   * Y軸の移動量を取得
   *
   * @return Y軸の移動量
   */
  public getTranslateY(): number {
    return this._tr[13];
  }

  /**
   * X軸の値を現在の行列で計算
   *
   * @param src X軸の値
   *
   * @return 現在の行列で計算されたX軸の値
   */
  public transformX(src: number): number {
    return this._tr[0] * src + this._tr[12];
  }

  /**
   * Y軸の値を現在の行列で計算
   *
   * @param src Y軸の値
   *
   * @return 現在の行列で計算されたY軸の値
   */
  public transformY(src: number): number {
    return this._tr[5] * src + this._tr[13];
  }

  /**
   * X軸の値を現在の行列で逆計算
   */
  public invertTransformX(src: number): number {
    return (src - this._tr[12]) / this._tr[0];
  }

  /**
   * Y軸の値を現在の行列で逆計算
   */
  public invertTransformY(src: number): number {
    return (src - this._tr[13]) / this._tr[5];
  }

  /**
   * 現在の行列の位置を起点にして移動
   *
   * 現在の行列の位置を起点にして相対的に移動する。
   *
   * @param x X軸の移動量
   * @param y Y軸の移動量
   */
  public translateRelative(x: number, y: number): void {
    const tr1: Float32Array = new Float32Array([
      1.0,
      0.0,
      0.0,
      0.0,
      0.0,
      1.0,
      0.0,
      0.0,
      0.0,
      0.0,
      1.0,
      0.0,
      x,
      y,
      0.0,
      1.0
    ]);

    CubismMatrix44.multiply(tr1, this._tr, this._tr);
  }

  /**
   * 現在の行列の位置を移動
   *
   * 現在の行列の位置を指定した位置へ移動する
   *
   * @param x X軸の移動量
   * @param y y軸の移動量
   */
  public translate(x: number, y: number): void {
    this._tr[12] = x;
    this._tr[13] = y;
  }

  /**
   * 現在の行列のX軸の位置を指定した位置へ移動する
   *
   * @param x X軸の移動量
   */
  public translateX(x: number): void {
    this._tr[12] = x;
  }

  /**
   * 現在の行列のY軸の位置を指定した位置へ移動する
   *
   * @param y Y軸の移動量
   */
  public translateY(y: number): void {
    this._tr[13] = y;
  }

  /**
   * 現在の行列の拡大率を相対的に設定する
   *
   * @param x X軸の拡大率
   * @param y Y軸の拡大率
   */
  public scaleRelative(x: number, y: number): void {
    const tr1: Float32Array = new Float32Array([
      x,
      0.0,
      0.0,
      0.0,
      0.0,
      y,
      0.0,
      0.0,
      0.0,
      0.0,
      1.0,
      0.0,
      0.0,
      0.0,
      0.0,
      1.0
    ]);

    CubismMatrix44.multiply(tr1, this._tr, this._tr);
  }

  /**
   * 現在の行列の拡大率を指定した倍率に設定する
   *
   * @param x X軸の拡大率
   * @param y Y軸の拡大率
   */
  public scale(x: number, y: number): void {
    this._tr[0] = x;
    this._tr[5] = y;
  }

  /**
   * 引数で与えられた行列にこの行列を乗算する。
   * (引数で与えられた行列) * (この行列)
   *
   * @note 関数名と実際の計算内容に乖離があるため、今後計算順が修正される可能性があります。
   * @param m 行列
   */
  public multiplyByMatrix(m: CubismMatrix44): void {
    CubismMatrix44.multiply(m.getArray(), this._tr, this._tr);
  }

  /**
   * 現在の行列の逆行列を求める。
   *
   * @return 現在の行列で計算された逆行列の値を返す
   */
  public getInvert(): CubismMatrix44 {
    const r00 = this._tr[0];
    const r10 = this._tr[1];
    const r20 = this._tr[2];
    const r01 = this._tr[4];
    const r11 = this._tr[5];
    const r21 = this._tr[6];
    const r02 = this._tr[8];
    const r12 = this._tr[9];
    const r22 = this._tr[10];

    const tx = this._tr[12];
    const ty = this._tr[13];
    const tz = this._tr[14];

    const det =
      r00 * (r11 * r22 - r12 * r21) -
      r01 * (r10 * r22 - r12 * r20) +
      r02 * (r10 * r21 - r11 * r20);

    const dst = new CubismMatrix44();

    if (CubismMath.abs(det) < CubismMath.Epsilon) {
      dst.loadIdentity();
      return dst;
    }

    const invDet = 1.0 / det;

    const inv00 = (r11 * r22 - r12 * r21) * invDet;
    const inv01 = -(r01 * r22 - r02 * r21) * invDet;
    const inv02 = (r01 * r12 - r02 * r11) * invDet;
    const inv10 = -(r10 * r22 - r12 * r20) * invDet;
    const inv11 = (r00 * r22 - r02 * r20) * invDet;
    const inv12 = -(r00 * r12 - r02 * r10) * invDet;
    const inv20 = (r10 * r21 - r11 * r20) * invDet;
    const inv21 = -(r00 * r21 - r01 * r20) * invDet;
    const inv22 = (r00 * r11 - r01 * r10) * invDet;

    dst._tr[0] = inv00;
    dst._tr[1] = inv10;
    dst._tr[2] = inv20;
    dst._tr[3] = 0.0;
    dst._tr[4] = inv01;
    dst._tr[5] = inv11;
    dst._tr[6] = inv21;
    dst._tr[7] = 0.0;
    dst._tr[8] = inv02;
    dst._tr[9] = inv12;
    dst._tr[10] = inv22;
    dst._tr[11] = 0.0;

    dst._tr[12] = -(inv00 * tx + inv01 * ty + inv02 * tz);
    dst._tr[13] = -(inv10 * tx + inv11 * ty + inv12 * tz);
    dst._tr[14] = -(inv20 * tx + inv21 * ty + inv22 * tz);
    dst._tr[15] = 1.0;

    return dst;
  }

  /**
   * オブジェクトのコピーを生成する
   */
  public clone(): CubismMatrix44 {
    const cloneMatrix: CubismMatrix44 = new CubismMatrix44();

    for (let i = 0; i < this._tr.length; i++) {
      cloneMatrix._tr[i] = this._tr[i];
    }

    return cloneMatrix;
  }

  protected _tr: Float32Array; // 4x4行列データ
}

// Namespace definition for compatibility.
import * as $ from './cubismmatrix44';
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Live2DCubismFramework {
  export const CubismMatrix44 = $.CubismMatrix44;
  export type CubismMatrix44 = $.CubismMatrix44;
}
