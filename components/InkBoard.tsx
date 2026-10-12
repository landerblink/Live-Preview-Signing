"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent } from "react";
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import { sb } from "@/lib/supabase";
import { BOARD_W, BOARD_H, drawStroke, uid } from "@/lib/ink";
import type { InkMsg, Pt, Stroke } from "@/lib/ink";

type Pres = { email: string; mode: "pen" | "watch" };
type Peer = Pres & { id: string };
type DbPayload = RealtimePostgresChangesPayload<Record<string, unknown>>;
const COLORS = ["#111827", "#ef4444", "#3b82f6", "#10b981", "#f59e0b"];

export default function InkBoard({
  projectId,
  writable,
  minimal = false,
}: {
  projectId: string;
  writable: boolean;
  minimal?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const strokes = useRef<Stroke[]>([]); // saved strokes
  const live = useRef<Record<string, Stroke>>({}); // remote strokes still being drawn
  const mine = useRef<Stroke | null>(null); // my in-progress stroke
  const queue = useRef<Pt[]>([]); // points not yet broadcast
  const chRef = useRef<RealtimeChannel | null>(null);
  const dirty = useRef(true);
  const [conn, setConn] = useState("CONNECTING");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [role, setRole] = useState<string | null | undefined>(undefined);
  const [color, setColor] = useState(COLORS[0] ?? "#111827");
  const [width, setWidth] = useState(4);
  const [penOnly, setPenOnly] = useState(false);
  const [count, setCount] = useState(0);
  const [err, setErr] = useState("");
  const canWrite = writable && (role === "owner" || role === "editor");

  const sync = useCallback(() => {
    dirty.current = true;
    setCount(strokes.current.length);
  }, []);
  const loadStrokes = useCallback(async () => {
    const { data } = await sb
      .from("strokes")
      .select("id,color,width,points")
      .eq("project_id", projectId)
      .order("created_at");
    if (data) {
      strokes.current = data as Stroke[];
      live.current = {};
      sync();
    }
  }, [projectId, sync]);

  // render loop: redraw only when something changed
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const c = canvasRef.current,
        w = wrapRef.current;
      if (!dirty.current || !c || !w) return;
      dirty.current = false;
      const dpr = window.devicePixelRatio || 1;
      const box = w.parentElement;
      // minimal mode: fit the 4:3 board inside the available space
      const cssW =
        minimal && box
          ? Math.floor(
              Math.min(box.clientWidth, (box.clientHeight * BOARD_W) / BOARD_H),
            )
          : w.clientWidth;
      if (minimal) w.style.width = `${cssW}px`;
      const cssH = (cssW * BOARD_H) / BOARD_W;
      if (c.width !== Math.round(cssW * dpr)) {
        c.width = Math.round(cssW * dpr);
        c.height = Math.round(cssH * dpr);
        c.style.height = `${cssH}px`;
      }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      const k = c.width / BOARD_W;
      for (const s of strokes.current) drawStroke(ctx, s, k);
      for (const s of Object.values(live.current)) drawStroke(ctx, s, k);
      if (mine.current) drawStroke(ctx, mine.current, k);
    };
    raf = requestAnimationFrame(tick);
    const onResize = () => {
      dirty.current = true;
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [minimal]);

  // send my new points to the other device every 40ms while drawing
  useEffect(() => {
    const t = setInterval(() => {
      const s = mine.current,
        ch = chRef.current;
      if (!s || !ch || queue.current.length === 0) return;
      const pts = queue.current;
      queue.current = [];
      void ch.send({
        type: "broadcast",
        event: "ink",
        payload: {
          id: s.id,
          color: s.color,
          width: s.width,
          pts,
        } satisfies InkMsg,
      });
    }, 40);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    sb.auth.getSession().then(async ({ data }) => {
      const u = data.session?.user;
      if (!u) {
        location.href = "/";
        return;
      }
      const r = await sb.rpc("role_of", { pid: projectId });
      const myRole = (r.data as string | null) ?? null;
      if (cancelled) return;
      setRole(myRole);
      if (!myRole) return;
      const mode: Pres["mode"] =
        writable && (myRole === "owner" || myRole === "editor")
          ? "pen"
          : "watch";
      // unique presence key per tab so one account can use PC + tablet
      const ch = sb.channel(`ink:${projectId}`, {
        config: { broadcast: { self: false }, presence: { key: uid() } },
      });
      chRef.current = ch;
      ch.on("broadcast", { event: "ink" }, (m) => {
        const g = m.payload as InkMsg;
        let s = live.current[g.id];
        if (!s) {
          s = { id: g.id, color: g.color, width: g.width, points: [] };
          live.current[g.id] = s;
        }
        s.points.push(...g.pts);
        dirty.current = true;
      })
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "strokes",
            filter: `project_id=eq.${projectId}`,
          },
          (e: DbPayload) => {
            const row = e.new as Stroke;
            delete live.current[row.id];
            if (!strokes.current.some((s) => s.id === row.id))
              strokes.current.push({
                id: row.id,
                color: row.color,
                width: row.width,
                points: row.points,
              });
            sync();
          },
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "strokes" },
          (e: DbPayload) => {
            const gone = (e.old as { id?: string }).id;
            if (gone) {
              strokes.current = strokes.current.filter((s) => s.id !== gone);
              sync();
            }
          },
        )
        .on("presence", { event: "sync" }, () => {
          const st = ch.presenceState<Pres>();
          setPeers(
            Object.entries(st).flatMap(([id, metas]) =>
              metas[0] ? [{ ...metas[0], id }] : [],
            ),
          );
        })
        .subscribe((status) => {
          setConn(status);
          if (status === "SUBSCRIBED") {
            void ch.track({ email: u.email ?? "", mode } satisfies Pres);
            void loadStrokes();
          } // resync on (re)connect
        });
    });
    return () => {
      cancelled = true;
      if (chRef.current) void sb.removeChannel(chRef.current);
      chRef.current = null;
    };
  }, [projectId, writable, sync, loadStrokes]);

  const toPt = (x: number, y: number, p: number, el: HTMLCanvasElement): Pt => {
    const r = el.getBoundingClientRect();
    return [
      ((x - r.left) / r.width) * BOARD_W,
      ((y - r.top) / r.height) * BOARD_H,
      p || 0.5,
    ];
  };
  const down = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!canWrite || (penOnly && e.pointerType === "touch")) return; // palm rejection
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toPt(e.clientX, e.clientY, e.pressure, e.currentTarget);
    mine.current = { id: uid(), color, width, points: [p] };
    queue.current = [p];
    dirty.current = true;
  };
  const move = (e: RPointerEvent<HTMLCanvasElement>) => {
    const s = mine.current;
    if (!s) return;
    const el = e.currentTarget;
    const co =
      typeof e.nativeEvent.getCoalescedEvents === "function"
        ? e.nativeEvent.getCoalescedEvents()
        : [];
    for (const ev of co.length ? co : [e.nativeEvent]) {
      const p = toPt(ev.clientX, ev.clientY, ev.pressure, el);
      s.points.push(p);
      queue.current.push(p);
    }
    dirty.current = true;
  };
  const up = () => {
    const s = mine.current;
    if (!s) return;
    mine.current = null;
    queue.current = [];
    const first = s.points[0];
    if (s.points.length < 2 && first) s.points.push(first); // tap = dot
    strokes.current.push(s);
    sync();
    void sb
      .from("strokes")
      .insert({
        id: s.id,
        project_id: projectId,
        color: s.color,
        width: s.width,
        points: s.points,
      })
      .then(({ error }) => {
        if (error) {
          strokes.current = strokes.current.filter((x) => x.id !== s.id);
          sync();
          setErr(error.message);
        }
      });
  };
  const undo = async () => {
    const last = strokes.current[strokes.current.length - 1];
    if (!last) return;
    strokes.current = strokes.current.slice(0, -1);
    sync();
    await sb.from("strokes").delete().eq("id", last.id);
  };
  const clearAll = async () => {
    if (!confirm("Clear the whole board?")) return;
    strokes.current = [];
    sync();
    await sb.from("strokes").delete().eq("project_id", projectId);
  };

  if (role === null)
    return (
      <div className="grid flex-1 place-items-center text-neutral-400">
        No access to this project
      </div>
    );
  const pens = peers.filter((p) => p.mode === "pen");
  if (minimal) {
    const canvasEl = (
      <canvas
        ref={canvasRef}
        className="block w-full"
        style={{
          touchAction: "none",
          cursor: canWrite ? "crosshair" : "default",
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
    );
    return (
      <div className="relative flex min-h-0 flex-1 flex-col bg-white">
        {!writable && (
          <span className="absolute left-3 top-3 z-10 text-xs text-neutral-400">
            {pens.length ? "Signer connected" : "Waiting for signer…"}
          </span>
        )}
        {canWrite && (
          <div className="absolute right-3 top-3 z-10 flex gap-2 text-sm">
            <button
              onClick={() => void undo()}
              disabled={!count}
              className="rounded bg-neutral-100 px-3 py-1.5 text-neutral-700 disabled:opacity-40"
            >
              Undo
            </button>
            <button
              onClick={() => void clearAll()}
              className="rounded bg-neutral-100 px-3 py-1.5 text-red-500"
            >
              Clear
            </button>
          </div>
        )}
        {canWrite && count === 0 && (
          <p className="pointer-events-none absolute inset-0 z-0 grid place-items-center text-2xl text-neutral-300">
            Sign here
          </p>
        )}
        {err && (
          <p className="absolute bottom-2 left-3 z-10 text-xs text-red-500">
            Save failed: {err}
          </p>
        )}
        <div className="relative z-[1] flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          <div ref={wrapRef} className="bg-transparent">
            {canvasEl}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-4 py-2 text-sm">
        <span
          className={`h-2 w-2 rounded-full ${conn === "SUBSCRIBED" ? "animate-pulse bg-emerald-500" : "bg-amber-500"}`}
          title={conn}
        />
        <span className="text-neutral-400">
          {writable
            ? canWrite
              ? "Pen ready"
              : role === undefined
                ? "Loading…"
                : "View only: you need editor access to write"
            : pens.length
              ? `Pen connected: ${pens.map((p) => p.email).join(", ")}`
              : "Waiting for the tablet pen…"}
        </span>
        <span className="ml-auto text-xs text-neutral-500">
          {count} strokes · {peers.length} online
        </span>
        {err && (
          <span className="text-xs text-red-400">Save failed: {err}</span>
        )}
      </div>
      {canWrite && (
        <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-4 py-2 text-sm">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              style={{ background: c }}
              className={`h-8 w-8 rounded-full border-2 ${color === c ? "border-white" : "border-transparent"}`}
            />
          ))}
          <input
            type="range"
            min={2}
            max={16}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
          <label className="flex items-center gap-1 text-xs text-neutral-400">
            <input
              type="checkbox"
              checked={penOnly}
              onChange={(e) => setPenOnly(e.target.checked)}
            />{" "}
            Pen only (ignore palm)
          </label>
          <button
            onClick={() => void undo()}
            disabled={!count}
            className="ml-auto rounded bg-neutral-800 px-3 py-1.5 disabled:opacity-40"
          >
            Undo
          </button>
          <button
            onClick={() => void clearAll()}
            className="rounded bg-neutral-800 px-3 py-1.5 text-red-400"
          >
            Clear
          </button>
        </div>
      )}
      <div className="flex flex-1 items-start justify-center overflow-auto bg-neutral-900 p-4">
        <div
          ref={wrapRef}
          className="w-full max-w-5xl overflow-hidden rounded-lg bg-white shadow-2xl"
        >
          <canvas
            ref={canvasRef}
            className="block w-full"
            style={{
              touchAction: "none",
              cursor: canWrite ? "crosshair" : "default",
            }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          />
        </div>
      </div>
    </div>
  );
}
