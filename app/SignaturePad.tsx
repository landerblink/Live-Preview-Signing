"use client";

import { useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

type Pt = [number, number]; // normalized 0–1
type Stroke = { id: string; points: Pt[] };

const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 3) | 8).toString(16);
  });

export default function SignaturePad({
  className = "",
}: {
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const wallId = useRef<number | null>(null); // current canvas
  const done = useRef(new Map<string, Stroke>());
  const live = useRef(new Map<string, Stroke>());
  const mine = useRef<Stroke | null>(null);
  const unsent = useRef<Pt[]>([]);
  const lastSent = useRef(0);

  const redraw = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const w = c.width / dpr;
    const h = c.height / dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
    ctx.fillStyle = "#111827";
    ctx.lineWidth = Math.max(2, w * 0.005);

    const drawStroke = (s: Stroke) => {
      const p = s.points;
      if (!p.length) return;
      if (p.length === 1) {
        ctx.beginPath();
        ctx.arc(p[0][0] * w, p[0][1] * h, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.beginPath();
      ctx.moveTo(p[0][0] * w, p[0][1] * h);
      for (let i = 1; i < p.length - 1; i++) {
        const mx = ((p[i][0] + p[i + 1][0]) / 2) * w;
        const my = ((p[i][1] + p[i + 1][1]) / 2) * h;
        ctx.quadraticCurveTo(p[i][0] * w, p[i][1] * h, mx, my);
      }
      const last = p[p.length - 1];
      ctx.lineTo(last[0] * w, last[1] * h);
      ctx.stroke();
    };

    done.current.forEach(drawStroke);
    live.current.forEach(drawStroke);
  };

  // Switch every device to a (new) canvas
  const switchWall = (id: number) => {
    if (wallId.current === id) return;
    wallId.current = id;
    done.current.clear();
    live.current.clear();
    mine.current = null;
    unsent.current = [];
    redraw();
  };

  // Keep canvas sharp and sized to its box
  useEffect(() => {
    const c = canvasRef.current!;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const r = c.getBoundingClientRect();
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      redraw();
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  // Realtime + initial load
  useEffect(() => {
    let cancelled = false;

    const channel = supabase
      .channel("wall")
      .on("broadcast", { event: "pts" }, ({ payload }) => {
        const { id, wall, pts } = payload as {
          id: string;
          wall: number;
          pts: Pt[];
        };
        if (wall !== wallId.current || done.current.has(id)) return;
        const s = live.current.get(id) ?? { id, points: [] };
        s.points.push(...pts);
        live.current.set(id, s);
        redraw();
      })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "strokes" },
        (payload) => {
          const row = payload.new as Stroke & { wall_id: number };
          if (row.wall_id !== wallId.current) return;
          live.current.delete(row.id);
          done.current.set(row.id, { id: row.id, points: row.points });
          redraw();
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "walls" },
        (payload) => switchWall((payload.new as { id: number }).id),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "strokes" },
        (payload) => {
          const id = (payload.old as { id?: string }).id;
          if (id) {
            done.current.delete(id);
            live.current.delete(id);
            redraw();
          }
        },
      )
      .subscribe();

    channelRef.current = channel;

    (async () => {
      // 1. find the latest canvas
      const { data: w } = await supabase
        .from("walls")
        .select("id")
        .order("id", { ascending: false })
        .limit(1)
        .single();
      if (cancelled || !w) return;
      const current = Math.max(w.id, wallId.current ?? 0);
      switchWall(current);

      // 2. load its strokes (1000 rows max per request, so page through)
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("strokes")
          .select("id, points")
          .eq("wall_id", current)
          .order("created_at")
          .range(from, from + 999);
        if (cancelled || wallId.current !== current || error || !data?.length)
          break;
        for (const r of data) {
          if (!done.current.has(r.id)) done.current.set(r.id, r as Stroke);
        }
        redraw();
        if (data.length < 1000) break;
      }
    })();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    return [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4];
  };

  const flush = (force = false) => {
    const s = mine.current;
    const now = performance.now();
    if (!s || !unsent.current.length) return;
    if (!force && now - lastSent.current < 40) return;
    channelRef.current?.send({
      type: "broadcast",
      event: "pts",
      payload: { id: s.id, wall: wallId.current, pts: unsent.current },
    });
    unsent.current = [];
    lastSent.current = now;
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (wallId.current === null) return; // not loaded yet
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    const s: Stroke = { id: uid(), points: [p] };
    mine.current = s;
    done.current.set(s.id, s);
    unsent.current = [p];
    flush(true);
    redraw();
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = mine.current;
    if (!s) return;
    const p = point(e);
    const last = s.points[s.points.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.0008) return;
    s.points.push(p);
    unsent.current.push(p);
    flush();
    redraw();
  };

  const onUp = () => {
    const s = mine.current;
    if (!s || wallId.current === null) return;
    flush(true);
    mine.current = null;
    unsent.current = [];
    supabase
      .from("strokes")
      .insert({ id: s.id, points: s.points, wall_id: wallId.current })
      .then(({ error }) => {
        if (error) {
          console.error(
            "save failed:",
            error.code,
            error.message,
            error.details,
            error.hint,
          );
        }
      });
  };

  // ---- Hidden controls ----

  const save = () => {
    canvasRef.current?.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `commitment-wall-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  };

  const newCanvas = async () => {
    if (
      !window.confirm(
        "Start a new blank canvas on ALL devices? The current one is kept in the database.",
      )
    )
      return;
    const { data, error } = await supabase
      .from("walls")
      .insert({})
      .select("id")
      .single();
    if (error) {
      console.error(
        "new canvas failed:",
        error.code,
        error.message,
        error.details,
        error.hint,
      );
      return;
    }
    switchWall(data.id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && !e.shiftKey && k === "s") {
        e.preventDefault();
        save(); // Ctrl/Cmd + S: download PNG
      } else if (mod && e.shiftKey && k === "l") {
        e.preventDefault();
        newCanvas(); // Ctrl/Cmd + Shift + L: new canvas
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // press-and-hold for touch devices (only used inside event handlers)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startHold = (ms: number, action: () => void) => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(action, ms);
  };

  const cancelHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  return (
    <div className={className}>
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="h-full w-full cursor-crosshair touch-none rounded-xl"
      />

      {/* Hold 1.5s above the box (the title) → save PNG */}
      <div
        onPointerDown={() => startHold(1500, save)}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onContextMenu={(e) => e.preventDefault()}
        className="absolute -top-14 left-0 h-12 w-72 touch-none select-none"
      />

      {/* Hold 3s below the box, bottom-right → new canvas */}
      <div
        onPointerDown={() => startHold(3000, newCanvas)}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onContextMenu={(e) => e.preventDefault()}
        className="absolute -bottom-16 right-0 h-12 w-40 touch-none select-none"
      />
    </div>
  );
}
