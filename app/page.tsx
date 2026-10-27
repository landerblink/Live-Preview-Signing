import Image from "next/image";
import type { CSSProperties } from "react";
import wall from "../public/Commitment Wall.png";
import SignaturePad from "./SignaturePad";

export default function App() {
  return (
    <main className="flex h-dvh w-screen items-center justify-center overflow-hidden bg-[#fbf8f1]">
      <div
        style={{ "--ar": wall.width / wall.height } as CSSProperties}
        className="relative aspect-square w-[min(100vw,100dvh)] lg:[aspect-ratio:var(--ar)] lg:w-[min(100vw,calc(100dvh*var(--ar)))]"
      >
        <Image
          src={wall}
          alt="The Visayas Rice Agenda – Sign your commitment"
          fill
          priority
          sizes="100vw"
          className="object-cover object-right"
        />

        <SignaturePad className="absolute left-[5.63%] top-[15.08%] h-[65.74%] w-[88.74%] lg:left-[41.07%] lg:w-[55.42%]" />
      </div>
    </main>
  );
}
