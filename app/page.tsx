"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { sb, DEFAULTS } from "@/lib/supabase";
import type { BlockRow, BlockType, Project } from "@/lib/supabase";
import { uid } from "@/lib/ink";

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [version, setVersion] = useState(0); // bump to refetch projects
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    const { data } = sb.auth.onAuthStateChange((_e, s) =>
      setUser(s?.user ?? null),
    );
    return () => data.subscription.unsubscribe();
  }, []);

  // Fetch inside the effect and set state in the async callback (not synchronously)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    sb.from("projects")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setProjects((data ?? []) as Project[]);
      });
    return () => {
      cancelled = true;
    };
  }, [user, version]);

  const auth = async (up: boolean) => {
    const { error } = up
      ? await sb.auth.signUp({ email, password: pw })
      : await sb.auth.signInWithPassword({ email, password: pw });
    setMsg(
      error?.message ??
        (up
          ? "Signed up. If email confirmation is on, confirm then sign in."
          : ""),
    );
  };

  const create = async () => {
    const { data, error } = await sb
      .from("projects")
      .insert({ name: "Untitled site" })
      .select()
      .single();
    if (error || !data) return setMsg(error?.message ?? "failed");
    const p = data as Project;
    const types: BlockType[] = ["heading", "paragraph", "button"];
    const rows: BlockRow[] = types.map((type, i) => ({
      id: uid(),
      project_id: p.id,
      position: i + 1,
      type,
      props: DEFAULTS[type],
    }));
    await sb.from("blocks").insert(rows);
    setVersion((v) => v + 1);
  };

  const del = async (id: string) => {
    if (confirm("Delete project?")) {
      await sb.from("projects").delete().eq("id", id);
      setVersion((v) => v + 1);
    }
  };

  if (!ready) return null;
  if (!user)
    return (
      <main className="min-h-screen grid place-items-center bg-neutral-950 text-neutral-100">
        <div className="w-80 space-y-3 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
          <h1 className="text-lg font-semibold">Sitewright</h1>
          <input
            className="w-full rounded bg-neutral-800 px-3 py-2 text-sm"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="w-full rounded bg-neutral-800 px-3 py-2 text-sm"
            type="password"
            placeholder="Password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={() => void auth(false)}
              className="flex-1 rounded bg-indigo-500 py-2 text-sm font-medium"
            >
              Sign in
            </button>
            <button
              onClick={() => void auth(true)}
              className="flex-1 rounded bg-neutral-700 py-2 text-sm"
            >
              Sign up
            </button>
          </div>
          {msg && <p className="text-xs text-amber-400">{msg}</p>}
        </div>
      </main>
    );
  return (
    <main className="min-h-screen bg-neutral-950 p-8 text-neutral-100">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Projects</h1>
          <div className="flex gap-2 text-sm">
            <button
              onClick={() => void create()}
              className="rounded bg-indigo-500 px-3 py-1.5 font-medium"
            >
              + New site
            </button>
            <button
              onClick={() => void sb.auth.signOut()}
              className="rounded bg-neutral-800 px-3 py-1.5"
            >
              Sign out
            </button>
          </div>
        </div>
        {msg && <p className="mb-3 text-xs text-amber-400">{msg}</p>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"
            >
              <p className="font-medium">{p.name}</p>
              <p className="mt-1 text-xs text-neutral-500">
                {p.owner_id === user.id ? "Owner" : "Shared with you"}
              </p>
              <div className="mt-3 flex gap-2 text-xs">
                <Link
                  href={`/p/${p.id}/live`}
                  className="rounded bg-indigo-500 px-2.5 py-1 font-medium"
                >
                  PC live view
                </Link>
                <Link
                  href={`/p/${p.id}/pen`}
                  className="rounded bg-neutral-800 px-2.5 py-1"
                >
                  Tablet pen
                </Link>
              </div>
              {p.owner_id === user.id && (
                <button
                  onClick={() => void del(p.id)}
                  className="mt-3 text-xs text-red-400"
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
