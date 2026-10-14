// Pure geometry for the node editor. No React Native import: testable in Node.
import type { EditorEdge, EditorLane, EditorNode } from '@/domain/types';

export const LANE_H = 112;
export const NODE_W = 208;
export const NODE_H = 76;
export const NODE_PAD_Y = (LANE_H - NODE_H) / 2;
export const HEADER_W = 180;
export const HEADER_W_COMPACT = 112;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 1.6;
export const GRID = 8;
export const NODE_GAP = 24;
export const PORT_R = 6;
export const CONTENT_PAD = 40;

export type View = { tx: number; ty: number; s: number };
export type Pt = { x: number; y: number };
export type Rect = { id: string; x: number; y: number; w: number; h: number };

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function laneIndexMap(lanes: EditorLane[]): Map<string, number> {
  return new Map(lanes.map((l, i) => [l.id, i]));
}

/** Index of the lane of a node. Unknown lanes fall back to 'unassigned', then to the first lane. */
export function laneIndexOf(node: EditorNode, idx: Map<string, number>): number {
  return idx.get(node.laneId) ?? idx.get('unassigned') ?? 0;
}

export function nodeRects(nodes: EditorNode[], lanes: EditorLane[]): Map<string, Rect> {
  const idx = laneIndexMap(lanes);
  const out = new Map<string, Rect>();
  for (const n of nodes) {
    out.set(n.id, { id: n.id, x: n.x, y: laneIndexOf(n, idx) * LANE_H + NODE_PAD_Y, w: NODE_W, h: NODE_H });
  }
  return out;
}

export function contentSize(rects: Iterable<Rect>, laneCount: number): { w: number; h: number } {
  let maxX = 0;
  for (const r of rects) maxX = Math.max(maxX, r.x + r.w);
  return { w: Math.max(1200, maxX + CONTENT_PAD * 2), h: Math.max(1, laneCount) * LANE_H };
}

// ---- edges ----

export const ARROW_LEN = 7;
const ARROW_GAP = 8; // space between arrow tip and the left edge of the target card

export type Bezier = { p0: Pt; c1: Pt; c2: Pt; p3: Pt };

/** Curve from the right port of `from` to just before the left port of `to` (room kept for the arrow head). */
export function edgeBezier(from: Rect, to: Rect): Bezier {
  const p0 = { x: from.x + from.w, y: from.y + from.h / 2 };
  const p3 = { x: to.x - ARROW_GAP - ARROW_LEN, y: to.y + to.h / 2 };
  const dx = Math.max(48, Math.abs(p3.x - p0.x) * 0.5);
  return { p0, c1: { x: p0.x + dx, y: p0.y }, c2: { x: p3.x - dx, y: p3.y }, p3 };
}

export function bezierBetween(p0: Pt, p3: Pt): Bezier {
  const dx = Math.max(48, Math.abs(p3.x - p0.x) * 0.5);
  return { p0, c1: { x: p0.x + dx, y: p0.y }, c2: { x: p3.x - dx, y: p3.y }, p3 };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function bezierPath(b: Bezier): string {
  return `M${r1(b.p0.x)} ${r1(b.p0.y)}C${r1(b.c1.x)} ${r1(b.c1.y)} ${r1(b.c2.x)} ${r1(b.c2.y)} ${r1(b.p3.x)} ${r1(b.p3.y)}`;
}

/** Small triangle pointing right, tip at the left edge of the target card minus a gap. */
export function arrowPath(b: Bezier): string {
  const x = b.p3.x + ARROW_LEN;
  const y = b.p3.y;
  return `M${r1(x)} ${r1(y)}L${r1(x - ARROW_LEN)} ${r1(y - 4)}L${r1(x - ARROW_LEN)} ${r1(y + 4)}Z`;
}

export function bezierPoint(b: Bezier, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const bb = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * b.p0.x + bb * b.c1.x + c * b.c2.x + d * b.p3.x, y: a * b.p0.y + bb * b.c1.y + c * b.c2.y + d * b.p3.y };
}

export function samplePolyline(b: Bezier, n = 18): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) pts.push(bezierPoint(b, i / n));
  return pts;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / len2, 0, 1);
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

export function distToPolyline(p: Pt, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, distToSegment(p, pts[i - 1], pts[i]));
  return best;
}

export function hitEdge(p: Pt, polylines: Map<string, Pt[]>, maxDist: number): string | null {
  let bestId: string | null = null;
  let best = maxDist;
  for (const [id, pts] of polylines) {
    const d = distToPolyline(p, pts);
    if (d <= best) {
      best = d;
      bestId = id;
    }
  }
  return bestId;
}

// ---- hit tests (world coordinates) ----

/** Topmost card under the point (later nodes are drawn above earlier ones). */
export function hitNode(p: Pt, rects: Rect[], inflate = 0): string | null {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (p.x >= r.x - inflate && p.x <= r.x + r.w + inflate && p.y >= r.y - inflate && p.y <= r.y + r.h + inflate) return r.id;
  }
  return null;
}

/** Output port (right edge, vertical middle) within `radius` world units. */
export function hitOutPort(p: Pt, rects: Rect[], radius: number): string | null {
  let bestId: string | null = null;
  let best = radius;
  for (const r of rects) {
    const d = Math.hypot(p.x - (r.x + r.w), p.y - (r.y + r.h / 2));
    if (d <= best) {
      best = d;
      bestId = r.id;
    }
  }
  return bestId;
}

export function laneAtY(wy: number, laneCount: number): number {
  return clamp(Math.floor(wy / LANE_H), 0, Math.max(0, laneCount - 1));
}

export const snapX = (x: number) => Math.max(0, Math.round(x / GRID) * GRID);

/** Nearest x in a lane that does not overlap another card. `others` are the x of the other cards of the lane. */
export function resolveX(desired: number, others: number[]): number {
  const want = snapX(desired);
  const step = NODE_W + NODE_GAP;
  const free = (x: number) => others.every((o) => Math.abs(x - o) >= step);
  if (free(want)) return want;
  const cands: number[] = [];
  for (const o of others) {
    cands.push(o + step, o - step);
  }
  const ok = cands.filter((x) => x >= 0 && free(x));
  if (ok.length === 0) return want;
  return ok.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
}

/** True when adding from -> to would close a loop (`from` is already reachable from `to`). */
export function wouldCycle(edges: EditorEdge[], from: string, to: string): boolean {
  if (from === to) return true;
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length) {
    const cur = stack.pop() as string;
    if (cur === from) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(next.get(cur) ?? []));
  }
  return false;
}

export function canLink(edges: EditorEdge[], from: string, to: string): boolean {
  if (from === to) return false;
  if (edges.some((e) => e.from === from && e.to === to)) return false;
  return !wouldCycle(edges, from, to);
}

// ---- view ----

/** Keep at least a strip of content visible. `cw`/`ch` = visible content area (without the lane header). */
export function clampView(v: View, content: { w: number; h: number }, cw: number, ch: number): View {
  const s = clamp(v.s, MIN_ZOOM, MAX_ZOOM);
  const keepX = Math.min(120, cw / 2);
  const keepY = Math.min(80, ch / 2);
  return {
    s,
    tx: clamp(v.tx, -(content.w * s - keepX), cw - keepX),
    ty: clamp(v.ty, -(content.h * s - keepY), ch - keepY),
  };
}

/** Zoom around a point of the content area (cx, cy in content-area pixels). */
export function zoomAround(v: View, factor: number, cx: number, cy: number): View {
  const s = clamp(v.s * factor, MIN_ZOOM, MAX_ZOOM);
  const wx = (cx - v.tx) / v.s;
  const wy = (cy - v.ty) / v.s;
  return { s, tx: cx - wx * s, ty: cy - wy * s };
}

/** First view: like fit, but never below `minScale` (readable on a phone), anchored on the first column. */
export function initialView(rects: Rect[], laneCount: number, cw: number, ch: number, minScale = 0.8): View {
  const f = fitView(rects, laneCount, cw, ch);
  if (f.s >= minScale || rects.length === 0) return f;
  const minX = Math.min(...rects.map((r) => r.x));
  return { s: minScale, tx: 16 - minX * minScale, ty: 0 };
}

/** Frame every card (or the first screen when there is none). */
export function fitView(rects: Rect[], laneCount: number, cw: number, ch: number): View {
  const pad = 24;
  const h = Math.max(1, laneCount) * LANE_H;
  if (rects.length === 0 || cw <= 0 || ch <= 0) return { tx: pad, ty: 0, s: 1 };
  const minX = Math.min(...rects.map((r) => r.x));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const s = clamp(Math.min((cw - pad * 2) / (maxX - minX), ch / h), MIN_ZOOM, 1);
  const spare = Math.max(0, cw - (maxX - minX) * s);
  return { s, tx: spare / 2 - minX * s, ty: 0 };
}
