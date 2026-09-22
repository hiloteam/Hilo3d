/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

/**
 * Arrayのサイズを変更する。
 * @param curArray
 * @param newSize
 * @param value
 * @param callPlacementNew
 */
export function updateSize<T>(
  curArray: Array<T>,
  newSize: number,
  value: any = null,
  callPlacementNew: boolean = null
): void {
  const curSize: number = curArray.length;

  if (curSize < newSize) {
    if (callPlacementNew) {
      for (let i: number = curArray.length; i < newSize; i++) {
        if (typeof value == 'function') {
          // new
          curArray[i] = JSON.parse(JSON.stringify(new value()));
        } // プリミティブ型なので値渡し
        else {
          curArray[i] = value;
        }
      }
    } else {
      for (let i: number = curArray.length; i < newSize; i++) {
        curArray[i] = value;
      }
    }
  } else {
    curArray.length = newSize;
  }
}
