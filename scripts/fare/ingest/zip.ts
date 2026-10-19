import { inflateRawSync } from "node:zlib";

// GTFS は zip で配られる。取り込みは生成時にしか走らないスクリプトなので、
// 依存を増やさずに済むよう必要な範囲だけ自前で読む。
// 対応するのは格納方式 0（無圧縮）と 8（deflate）だけ。GTFS の zip は
// この2つしか使わない（それ以外が来たら黙って飛ばさず例外にする）。

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const MAX_COMMENT = 0xffff;

function findEndOfCentralDirectory(buf: Buffer): number {
  // 末尾コメントが可変長なので後ろから署名を探す
  const start = Math.max(0, buf.length - MAX_COMMENT - 22);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) return i;
  }
  throw new Error("zip の終端レコードが見つかりません");
}

/** zip の全エントリを「パス → 中身」で返す。ディレクトリ項目は含めない */
export function readZipEntries(buf: Buffer): Map<string, Buffer> {
  const eocd = findEndOfCentralDirectory(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);

  const entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) {
      throw new Error(`中央ディレクトリの ${i} 件目が壊れています`);
    }
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    // GTFS-JP はファイル名を UTF-8 で入れる（汎用フラグ bit 11）。
    // 日本語名が化けるのは CP932 の zip だが、扱う対象に無いので UTF-8 固定でよい。
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;

    // ローカルヘッダは可変長の名前と拡張領域を持つので、そこを飛ばして本体へ
    const localNameLength = buf.readUInt16LE(localOffset + 26);
    const localExtraLength = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) {
      entries.set(name, Buffer.from(raw));
    } else if (method === 8) {
      entries.set(name, inflateRawSync(raw));
    } else {
      throw new Error(`未対応の圧縮方式 ${method}: ${name}`);
    }
  }
  return entries;
}
