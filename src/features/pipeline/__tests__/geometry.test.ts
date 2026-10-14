import { describe, expect, it } from 'vitest';
import { LANE_H, NODE_W, canLink, clampView, edgeBezier, fitView, hitEdge, hitNode, hitOutPort, laneAtY, nodeRects, resolveX, samplePolyline, snapX, zoomAround } from '../geometry';

const lanes = [
  { id: 'a', label: 'A', color: null, online: true },
  { id: 'unassigned', label: 'U', color: null, online: null },
];
const mk = (id: string, laneId: string, x: number) => ({ id, laneId, x, title: id, subtitle: '', state: 'ready' as const, stateLabel: 'Ready' });

describe('node editor geometry', () => {
  it('places cards by lane and falls back to the unassigned lane', () => {
    const r = nodeRects([mk('n1', 'a', 10), mk('n2', 'ghost', 0)], lanes);
    expect(r.get('n1')?.y).toBe(18);
    expect(r.get('n2')?.y).toBe(LANE_H + 18);
  });
  it('hits cards, ports and edges', () => {
    const r = [...nodeRects([mk('n1', 'a', 0), mk('n2', 'a', 400)], lanes).values()];
    expect(hitNode({ x: 10, y: 40 }, r)).toBe('n1');
    expect(hitNode({ x: 300, y: 40 }, r)).toBeNull();
    expect(hitOutPort({ x: NODE_W + 3, y: 56 }, r, 12)).toBe('n1');
    expect(hitOutPort({ x: 100, y: 56 }, r, 12)).toBeNull();
    const m = new Map([['e', samplePolyline(edgeBezier(r[0], r[1]))]]);
    expect(hitEdge({ x: 300, y: 56 }, m, 6)).toBe('e');
    expect(hitEdge({ x: 300, y: 90 }, m, 6)).toBeNull();
  });
  it('refuses self, duplicate and cyclic links', () => {
    const edges = [{ id: 'a->b', from: 'a', to: 'b', satisfied: false }, { id: 'b->c', from: 'b', to: 'c', satisfied: false }];
    expect(canLink(edges, 'a', 'a')).toBe(false);
    expect(canLink(edges, 'a', 'b')).toBe(false);
    expect(canLink(edges, 'c', 'a')).toBe(false);
    expect(canLink(edges, 'a', 'c')).toBe(true);
  });
  it('snaps and avoids overlaps', () => {
    expect(snapX(13)).toBe(16);
    expect(snapX(-50)).toBe(0);
    expect(resolveX(100, [])).toBe(104);
    const x = resolveX(100, [0]);
    expect(Math.abs(x - 0)).toBeGreaterThanOrEqual(NODE_W);
    expect(laneAtY(500, 2)).toBe(1);
    expect(laneAtY(-10, 2)).toBe(0);
  });
  it('zooms around a point and clamps the view', () => {
    const v = zoomAround({ tx: 0, ty: 0, s: 1 }, 1.5, 100, 50);
    expect(v.s).toBe(1.5);
    expect((100 - v.tx) / v.s).toBeCloseTo(100);
    expect(zoomAround({ tx: 0, ty: 0, s: 1 }, 10, 0, 0).s).toBe(1.6);
    expect(clampView({ tx: 99999, ty: -99999, s: 1 }, { w: 1200, h: 400 }, 800, 600).tx).toBeLessThan(800);
    const f = fitView([...nodeRects([mk('n1', 'a', 0), mk('n2', 'a', 1600)], lanes).values()], 2, 800, 600);
    expect(f.s).toBeLessThan(1);
  });
});
