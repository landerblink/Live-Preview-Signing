import { Suspense } from "react";
import SignView from "@/components/SignView";

async function Live({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SignView projectId={id} />;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="grid h-screen place-items-center bg-neutral-950 text-neutral-400">
          Loading…
        </div>
      }
    >
      <Live params={params} />
    </Suspense>
  );
}
