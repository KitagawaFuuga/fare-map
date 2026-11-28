import { envInt } from "../reachable/config";

/**
 * 検索語の長さの上限。曖昧検索（Fuse.js）は長さにほぼ比例して重く、1件で
 * 50文字なら約 225ms、30文字なら約 100ms の CPU を使う（2026-11-27 に手元で測定）。
 * いちばん長い駅名は24文字（計算科学センター（神戸どうぶつ王国・「富岳」前））なので、
 * 少し余裕を持たせて 30 にする。
 */
export const STATION_QUERY_MAX = 30;

/**
 * 1 IP が瞬間的に出せる候補の問い合わせの数。入力欄は 200ms のデバウンスで
 * 打ち止めのたびに1回問い合わせるので、探索（reachable）より多めに取る。
 * 環境変数は探索と同じ RATE_LIMIT_CAPACITY を使う（E2E はこれで両方を緩める）。
 */
export const STATIONS_RATE_LIMIT_CAPACITY = envInt("RATE_LIMIT_CAPACITY", 30);

/** 定常的に許すレート。長い検索語を投げ続けても 1 コンテナを埋めない値にする */
export const STATIONS_RATE_LIMIT_REFILL_PER_SEC = 2;

export const STATIONS_RETRY_AFTER_SEC = Math.ceil(
  1 / STATIONS_RATE_LIMIT_REFILL_PER_SEC,
);
