import { memo, useImperativeHandle, useState, type Ref } from 'react';
import Svg, { Circle, G, Path } from 'react-native-svg';

import type { EditorEdge } from '@/domain/types';
import type { Colors } from '@/ui/theme';

import { arrowPath, bezierBetween, bezierPath, bezierPoint, edgeBezier, type Pt, type Rect } from './geometry';

export type EdgeOverride = { id: string; x: number; y: number } | null;
export type EdgeLayerApi = { setOverride: (o: EdgeOverride) => void };
export type LinkPreviewApi = { set: (p: { from: Pt; to: Pt } | null) => void };

// Studio "chat" line icon (24 px grid), drawn small on a link that carries the conversation.
const CHAT = 'M21 4H3v13h5l4 4 4-4h5V4Z';

const EdgeView = memo(function EdgeView(p: {
  d: string;
  arrow: string;
  stroke: string;
  width: number;
  opacity: number;
  chat: Pt | null;
  bg: string;
}) {
  return (
    <>
      <Path d={p.d} stroke={p.stroke} strokeOpacity={p.opacity} strokeWidth={p.width} fill="none" strokeLinecap="round" />
      <Path d={p.arrow} fill={p.stroke} fillOpacity={p.opacity} stroke={p.stroke} strokeOpacity={p.opacity} strokeWidth={1} strokeLinejoin="round" />
      {p.chat ? (
        <G>
          <Circle cx={p.chat.x} cy={p.chat.y} r={9} fill={p.bg} stroke={p.stroke} strokeWidth={1.2} />
          <G transform={`translate(${p.chat.x - 5.5} ${p.chat.y - 5.5}) scale(0.4583)`}>
            <Path d={CHAT} fill="none" stroke={p.stroke} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
          </G>
        </G>
      ) : null}
    </>
  );
});

type EdgeLayerProps = {
  edges: EditorEdge[];
  rects: Map<string, Rect>;
  selectedEdgeId: string | null;
  colors: Colors;
  width: number;
  height: number;
  apiRef: Ref<EdgeLayerApi>;
};

/** Dependency curves. Owns the position of the card being dragged so a drag only re-renders this layer. */
export function EdgeLayer({ edges, rects, selectedEdgeId, colors, width, height, apiRef }: EdgeLayerProps) {
  const [ov, setOverride] = useState<EdgeOverride>(null);
  useImperativeHandle(apiRef, () => ({ setOverride }), []);
  const place = (r: Rect): Rect => (ov && ov.id === r.id ? { ...r, x: ov.x, y: ov.y } : r);
  const items = edges
    .map((e) => {
      const a = rects.get(e.from);
      const b = rects.get(e.to);
      if (!a || !b) return null;
      const bz = edgeBezier(place(a), place(b));
      const selected = e.id === selectedEdgeId;
      const chat = e.conversation ? bezierPoint(bz, 0.5) : null;
      return {
        id: e.id,
        d: bezierPath(bz),
        arrow: arrowPath(bz),
        // A link that carries the conversation stays fully visible even while it waits.
        stroke: selected ? colors.accent : e.satisfied ? colors.green : e.conversation ? colors.muted : colors.faint,
        opacity: selected || e.satisfied || e.conversation ? 1 : 0.55,
        width: selected ? 2 : 1.5,
        selected,
        chat,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => Number(a.selected) - Number(b.selected));
  return (
    <Svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }} pointerEvents="none">
      {items.map((i) => (
        <EdgeView key={i.id} d={i.d} arrow={i.arrow} stroke={i.stroke} width={i.width} opacity={i.opacity} chat={i.chat} bg={colors.bg} />
      ))}
    </Svg>
  );
}

/** Live dashed curve while a link is drawn from an output port. */
export function LinkPreview({ colors, width, height, apiRef }: { colors: Colors; width: number; height: number; apiRef: Ref<LinkPreviewApi> }) {
  const [p, set] = useState<{ from: Pt; to: Pt } | null>(null);
  useImperativeHandle(apiRef, () => ({ set }), []);
  if (!p) return null;
  const bz = bezierBetween(p.from, p.to);
  return (
    <Svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }} pointerEvents="none">
      <Path d={bezierPath(bz)} stroke={colors.accent} strokeWidth={1.5} strokeDasharray="5 4" fill="none" strokeLinecap="round" />
    </Svg>
  );
}
