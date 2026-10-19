declare module "@node-rs/jieba/dict" {
  /** 内置词典的原始字节，供 `Jieba.withDict` 使用。 */
  export const dict: Uint8Array;
  /** 内置 IDF 数据，供 `TfIdf.withDict` 使用。 */
  export const idf: Uint8Array;
}
