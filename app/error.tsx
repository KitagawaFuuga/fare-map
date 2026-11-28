"use client";

import Logo from "@/components/Logo";

// 画面の表示中の想定外の失敗。デプロイの直後に古いチャンクを取りに行ったときや、
// 回線が切れたときに起きる。
// Next.js 16 の retry（区画を描き直す）は使わない。失敗したチャンクの読み込みは
// 結果が残るので、描き直しても同じ失敗になる（e2e/error-pages.spec.ts で確かめた）。
// デプロイ後の古いチャンクは、新しい HTML から取り直すしかないので、ページごと読み直す
export default function Error() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <Logo className="h-10 w-10" />
      <h1 className="text-xl font-bold">表示できませんでした</h1>
      <p className="text-gray-600">
        通信が切れたか、サイトが更新された直後かもしれません。
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded bg-[#a54700] px-4 py-2 font-medium text-white"
      >
        もう一度読み込む
      </button>
    </main>
  );
}
