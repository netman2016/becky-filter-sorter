// WHATWG の shift_jis デコーダは windows-31j (CP932) 相当（NEC 特殊文字・IBM 拡張を含む）
const decoder = new TextDecoder('shift_jis');

/** 表示・判定用のデコード。保存には使わない */
export function decodeCp932(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}
