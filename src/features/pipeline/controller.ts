// Imperative controller of the node editor: pointer logic, pan and zoom.
// A plain class (not a component or hook) so the gestures, created once, always read the latest data
// without refs being touched during render.
// Imported under another name on purpose: the Reanimated Babel plugin looks for `GH.X()` chains by name and
// would turn the callbacks below into worklets, which copy `this` (the controller) and lose its methods.
import { Gesture as GH } from 'react-native-gesture-handler';
import { withTiming, type SharedValue } from 'react-native-reanimated';

import type { EditorEdge, EditorLane, EditorNode } from '@/domain/types';

import type { EdgeLayerApi, LinkPreviewApi } from './EdgeLayer';
import {
  LANE_H,
  MAX_ZOOM,
  MIN_ZOOM,
  NODE_H,
  NODE_W,
  canLink,
  clamp,
  clampView,
  fitView,
  hitEdge,
  hitNode,
  hitOutPort,
  initialView,
  laneAtY,
  laneIndexMap,
  laneIndexOf,
  resolveX,
  zoomAround,
  type Pt,
  type Rect,
  type View,
} from './geometry';

const LONG_PRESS_MS = 250;
const isTouch = (pointerType: number | undefined) => pointerType === 0 || pointerType === 1; // GH PointerType.TOUCH, STYLUS

type Mode = 'none' | 'pan' | 'pending' | 'node' | 'link';
type Hit = { kind: 'bg' | 'port' | 'node' | 'edge'; id: string | null };

export type ControllerProps = {
  onSelect: (id: string | null) => void;
  onMoveNode: (id: string, laneId: string, x: number) => void;
  onConnect: (fromId: string, toId: string) => void;
  onSelectEdge?: (edgeId: string | null) => void;
  selectedEdgeId?: string | null;
  readOnly?: boolean;
};

export type ControllerData = {
  props: ControllerProps;
  lanes: EditorLane[];
  nodes: EditorNode[];
  edges: EditorEdge[];
  rectMap: Map<string, Rect>;
  rectList: Rect[];
  polylines: Map<string, Pt[]>;
  content: { w: number; h: number };
  headerW: number;
  cw: number; // visible content width (without the lane header)
  ch: number;
};

export type ControllerUi = {
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  sc: SharedValue<number>;
  gx: SharedValue<number>;
  gy: SharedValue<number>;
  setDragId: (id: string | null) => void;
  setDropLane: (lane: number | null) => void;
  setLink: (link: { from: string; target: string | null } | null) => void;
};

export class NodeEditorController {
  readonly edgeApi: { current: EdgeLayerApi | null } = { current: null };
  readonly previewApi: { current: LinkPreviewApi | null } = { current: null };
  readonly gestures;

  private d: ControllerData | null = null;
  private view: View = { tx: 0, ty: 0, s: 1 };
  private mode: Mode = 'none';
  private id: string | null = null;
  private sx = 0;
  private sy = 0;
  private v0: View = { tx: 0, ty: 0, s: 1 };
  private t0 = 0;
  private touch = false;
  private offX = 0;
  private offY = 0;
  private lane = 0;
  private gx = 0;
  private gy = 0;
  private target: string | null = null;
  private pinch0 = { tx: 0, ty: 0, s: 1, fx: 0, fy: 0 };
  private fitted = false;

  constructor(private ui: ControllerUi) {
    this.gestures = this.build();
  }

  /** Called after every render with the latest props and derived geometry. */
  sync(d: ControllerData) {
    this.d = d;
    if (!this.fitted && d.cw > 0 && d.ch > 0) {
      this.fitted = true;
      this.applyView(initialView(d.rectList, d.lanes.length, d.cw, d.ch));
    }
  }

  applyView(v: View, animate = false) {
    const d = this.d;
    if (!d) return;
    const c = clampView(v, d.content, d.cw, d.ch);
    this.view = c;
    const { tx, ty, sc } = this.ui;
    if (animate) {
      const cfg = { duration: 160 };
      tx.value = withTiming(c.tx, cfg);
      ty.value = withTiming(c.ty, cfg);
      sc.value = withTiming(c.s, cfg);
    } else {
      tx.value = c.tx;
      ty.value = c.ty;
      sc.value = c.s;
    }
  }

  fit() {
    const d = this.d;
    if (d) this.applyView(fitView(d.rectList, d.lanes.length, d.cw, d.ch), true);
  }

  zoomBy(factor: number) {
    const d = this.d;
    if (d) this.applyView(zoomAround(this.view, factor, d.cw / 2, d.ch / 2), true);
  }

  /** Mouse wheel (web). Zooms around the pointer. */
  wheel(ev: WheelEvent, el: HTMLElement) {
    const d = this.d;
    if (!d) return;
    ev.preventDefault();
    const box = el.getBoundingClientRect();
    const unit = ev.deltaMode === 1 ? 16 : 1;
    const factor = Math.exp(-ev.deltaY * unit * (ev.ctrlKey ? 0.01 : 0.0015));
    this.applyView(zoomAround(this.view, factor, ev.clientX - box.left - d.headerW, ev.clientY - box.top));
  }

  // ---- hit tests ----

  private toWorld(vx: number, vy: number): Pt {
    const d = this.d as ControllerData;
    return { x: (vx - d.headerW - this.view.tx) / this.view.s, y: (vy - this.view.ty) / this.view.s };
  }

  private hit(vx: number, vy: number, pointerType: number | undefined): Hit {
    const d = this.d;
    if (!d || vx < d.headerW) return { kind: 'bg', id: null };
    const wp = this.toWorld(vx, vy);
    const touch = isTouch(pointerType);
    if (!d.props.readOnly) {
      const port = hitOutPort(wp, d.rectList, (touch ? 22 : 12) / this.view.s);
      if (port) return { kind: 'port', id: port };
    }
    const node = hitNode(wp, d.rectList);
    if (node) return { kind: 'node', id: node };
    const edge = hitEdge(wp, d.polylines, (touch ? 14 : 8) / this.view.s);
    if (edge) return { kind: 'edge', id: edge };
    return { kind: 'bg', id: null };
  }

  // ---- node drag ----

  private startNode(x: number, y: number) {
    const d = this.d;
    const rect = d?.rectMap.get(this.id as string);
    if (!d || !rect) return;
    const wp = this.toWorld(x, y);
    this.mode = 'node';
    this.offX = wp.x - rect.x;
    this.offY = wp.y - rect.y;
    this.gx = rect.x;
    this.gy = rect.y;
    this.lane = Math.round((rect.y - (LANE_H - NODE_H) / 2) / LANE_H);
    this.ui.gx.value = rect.x;
    this.ui.gy.value = rect.y;
    this.ui.setDragId(this.id);
    this.ui.setDropLane(this.lane);
  }

  private moveNode(x: number, y: number) {
    const d = this.d;
    if (!d) return;
    const wp = this.toWorld(x, y);
    this.gx = wp.x - this.offX;
    this.gy = wp.y - this.offY;
    this.ui.gx.value = this.gx;
    this.ui.gy.value = this.gy;
    const lane = laneAtY(wp.y, d.lanes.length);
    if (lane !== this.lane) {
      this.lane = lane;
      this.ui.setDropLane(lane);
    }
    this.edgeApi.current?.setOverride({ id: this.id as string, x: this.gx, y: this.gy });
  }

  private dropNode() {
    const d = this.d;
    const orig = d?.rectMap.get(this.id as string);
    if (!d || !orig) return;
    const idx = clamp(this.lane, 0, d.lanes.length - 1);
    const lane = d.lanes[idx];
    if (!lane) return;
    const laneIdx = laneIndexMap(d.lanes);
    const others = d.nodes.filter((n) => n.id !== this.id && laneIndexOf(n, laneIdx) === idx).map((n) => n.x);
    const x = resolveX(this.gx, others);
    const origLane = Math.round((orig.y - (LANE_H - NODE_H) / 2) / LANE_H);
    if (idx !== origLane || x !== orig.x) d.props.onMoveNode(this.id as string, lane.id, x);
  }

  // ---- link drag ----

  private startLink() {
    this.mode = 'link';
    this.target = null;
    this.ui.setLink({ from: this.id as string, target: null });
  }

  private moveLink(x: number, y: number) {
    const d = this.d;
    const src = d?.rectMap.get(this.id as string);
    if (!d || !src) return;
    const wp = this.toWorld(x, y);
    const t = hitNode(wp, d.rectList, 8);
    const target = t && canLink(d.edges, this.id as string, t) ? t : null;
    if (target !== this.target) {
      this.target = target;
      this.ui.setLink({ from: this.id as string, target });
    }
    const tr = target ? d.rectMap.get(target) : undefined;
    this.previewApi.current?.set({ from: { x: src.x + NODE_W, y: src.y + NODE_H / 2 }, to: tr ? { x: tr.x, y: tr.y + NODE_H / 2 } : wp });
  }

  private end() {
    this.mode = 'none';
    this.id = null;
    this.target = null;
    this.ui.setDragId(null);
    this.ui.setDropLane(null);
    this.ui.setLink(null);
    this.edgeApi.current?.setOverride(null);
    this.previewApi.current?.set(null);
  }

  // ---- gestures ----

  // Callbacks stay plain JS functions (see the import note) and run on the JS thread with the right `this`.
  private build() {
    const onBegin = (e: { x: number; y: number; pointerType?: number }) => {
      const h = this.hit(e.x, e.y, e.pointerType);
      this.mode = h.kind === 'port' ? 'link' : h.kind === 'node' && !this.d?.props.readOnly ? 'pending' : 'pan';
      this.id = h.kind === 'port' || h.kind === 'node' ? h.id : null;
      this.sx = e.x;
      this.sy = e.y;
      this.v0 = { ...this.view };
      this.t0 = Date.now();
      this.touch = isTouch(e.pointerType);
    };
    const onStart = (e: { x: number; y: number }) => {
      if (this.mode === 'pending') {
        // Touch: a node needs a long press (250 ms), a quick swipe on a card pans the canvas.
        if (this.touch && Date.now() - this.t0 < LONG_PRESS_MS) this.mode = 'pan';
        else this.startNode(e.x, e.y);
      } else if (this.mode === 'link') this.startLink();
    };
    const onUpdate = (e: { x: number; y: number }) => {
      if (this.mode === 'pan') this.applyView({ tx: this.v0.tx + e.x - this.sx, ty: this.v0.ty + e.y - this.sy, s: this.v0.s });
      else if (this.mode === 'node') this.moveNode(e.x, e.y);
      else if (this.mode === 'link') this.moveLink(e.x, e.y);
    };
    const onFinalize = (_e: unknown, success: boolean) => {
      const d = this.d;
      if (success && d) {
        if (this.mode === 'node') this.dropNode();
        else if (this.mode === 'link' && this.target && this.id) d.props.onConnect(this.id, this.target);
      }
      this.end();
    };
    const pan = GH.Pan().runOnJS(true).maxPointers(1).minDistance(6).onBegin(onBegin).onStart(onStart).onUpdate(onUpdate).onFinalize(onFinalize);

    const onPinchStart = (e: { focalX: number; focalY: number }) => {
      const v = this.view;
      this.pinch0 = { tx: v.tx, ty: v.ty, s: v.s, fx: e.focalX, fy: e.focalY };
    };
    const onPinchUpdate = (e: { scale: number; focalX: number; focalY: number }) => {
      const d = this.d;
      if (!d) return;
      const p = this.pinch0;
      const s = clamp(p.s * e.scale, MIN_ZOOM, MAX_ZOOM);
      const wx = (p.fx - d.headerW - p.tx) / p.s;
      const wy = (p.fy - p.ty) / p.s;
      this.applyView({ s, tx: e.focalX - d.headerW - wx * s, ty: e.focalY - wy * s });
    };
    const pinch = GH.Pinch().runOnJS(true).onStart(onPinchStart).onUpdate(onPinchUpdate);

    const onTap = (e: { x: number; y: number; pointerType?: number }, success: boolean) => {
      const d = this.d;
      if (!success || !d) return;
      const p = d.props;
      const h = this.hit(e.x, e.y, e.pointerType);
      if (h.kind === 'node' || h.kind === 'port') {
        if (p.selectedEdgeId) p.onSelectEdge?.(null);
        p.onSelect(h.id);
      } else if (h.kind === 'edge') {
        p.onSelect(null);
        p.onSelectEdge?.(h.id);
      } else {
        p.onSelect(null);
        p.onSelectEdge?.(null);
      }
    };
    const tap = GH.Tap().runOnJS(true).maxDistance(10).onEnd(onTap);

    return GH.Simultaneous(pinch, GH.Race(pan, tap));
  }
}
