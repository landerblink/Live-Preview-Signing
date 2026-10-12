import { Suspense } from "react";
import InkBoard from "@/components/InkBoard";

async function Pen({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InkBoard projectId={id} writable minimal />;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="flex h-screen flex-col bg-white">
      <Suspense fallback={null}>
        <Pen params={params} />
      </Suspense>
    </div>
  );
}
