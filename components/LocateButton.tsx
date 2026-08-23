"use client";

export default function LocateButton({ onLocate }: { onLocate(lat: number, lng: number): void }) {
  return (
    <button
      type="button"
      aria-label="現在地から探す"
      className="fixed bottom-20 right-4 z-10 rounded-full bg-white p-3 shadow-lg md:bottom-6"
      onClick={() => {
        navigator.geolocation.getCurrentPosition(
          (pos) => onLocate(pos.coords.latitude, pos.coords.longitude),
          () => window.alert("現在地を取得できませんでした"),
        );
      }}
    >
      ◎
    </button>
  );
}
