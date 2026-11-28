import Link from "next/link";
import Logo from "@/components/Logo";

// 無い URL を開いたとき（ルートの not-found は、どのルートにも当たらない URL にも使われる）
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <Logo className="h-10 w-10" />
      <h1 className="text-xl font-bold">ページが見つかりません</h1>
      <p className="text-gray-600">
        URL が変わったか、入力の誤りかもしれません。
      </p>
      <Link
        href="/"
        className="rounded bg-[#a54700] px-4 py-2 font-medium text-white"
      >
        トップへ戻る
      </Link>
    </main>
  );
}
