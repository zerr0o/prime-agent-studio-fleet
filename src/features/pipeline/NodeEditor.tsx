import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import type { EditorEdge, EditorLane, EditorNode } from '@/domain/types';
import { layout, radius } from '@/ui/theme';
import { useTheme } from '@/ui/theme-context';

import { EdgeLayer, LinkPreview } from './EdgeLayer';
import { Glyph, type GlyphName } from './glyphs';
import { NodeEditorController } from './controller';
import {
  HEADER_W,
  HEADER_W_COMPACT,
  contentSize,
  edgeBezier,
  laneIndexMap,
  laneIndexOf,
  nodeRects,
  samplePolyline,
  type Pt,
  type Rect,
} from './geometry';
import { LaneHeader, LaneRow } from './Lanes';
import { NodeCard } from './NodeCard';

export type NodeEditorLabels = { unassignedLane: string; emptyLane: string; fit: string; zoomIn: string; zoomOut: string };

export type NodeEditorProps = {
  lanes: EditorLane[];
  nodes: EditorNode[];
  edges: EditorEdge[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Called once at drop. A different `laneId` means "assign to that machine". */
  onMoveNode: (id: string, laneId: string, x: number) => void;
  /** New dependency: `toId` waits for `fromId`. */
  onConnect: (fromId: string, toId: string) => void;
  onSelectEdge?: (edgeId: string | null) => void;
  selectedEdgeId?: string | null;
  readOnly?: boolean;
  labels: NodeEditorLabels;
  /** Zoom and fit buttons (hide them when a panel covers the bottom of a small canvas). */
  showToolbar?: boolean;
  style?: ViewStyle;
};

/**
 * Pipeline canvas: one lane per machine, cards linked by dependencies.
 * All pointer logic lives in one gesture set on the viewport (hit tests in canvas coordinates), so cards carry no
 * gesture detector. Pan and zoom go through shared values and never re-render the cards.
 */
export function NodeEditor(props: NodeEditorProps) {
  const { lanes, nodes, edges, selectedId, readOnly = false, labels, style, showToolbar = true } = props;
  const selectedEdgeId = props.selectedEdgeId ?? null;
  const { colors } = useTheme();

  const [size, setSize] = useState({ w: 0, h: 0 });
  const compact = size.w > 0 && size.w < layout.mobile;
  const headerW = compact ? HEADER_W_COMPACT : HEADER_W;
  const cw = Math.max(0, size.w - headerW);
  const ch = size.h;

  // ---- derived geometry ----
  const rectMap = useMemo(() => nodeRects(nodes, lanes), [nodes, lanes]);
  const rectList = useMemo(() => nodes.map((n) => rectMap.get(n.id) as Rect), [nodes, rectMap]);
  const content = useMemo(() => contentSize(rectList, lanes.length), [rectList, lanes.length]);
  const polylines = useMemo(() => {
    const m = new Map<string, Pt[]>();
    for (const e of edges) {
      const a = rectMap.get(e.from);
      const b = rectMap.get(e.to);
      if (a && b) m.set(e.id, samplePolyline(edgeBezier(a, b)));
    }
    return m;
  }, [edges, rectMap]);
  const laneIdx = useMemo(() => laneIndexMap(lanes), [lanes]);
  const laneHasNode = useMemo(() => {
    const set = new Set<number>();
    for (const n of nodes) set.add(laneIndexOf(n, laneIdx));
    return set;
  }, [nodes, laneIdx]);

  // ---- view (pan and zoom): shared values drive the transforms, the controller owns the pointer logic ----
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sc = useSharedValue(1);
  const gx = useSharedValue(0);
  const gy = useSharedValue(0);

  // Transient interaction state: re-renders only what shows it (the per-move work stays in the layers).
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropLane, setDropLane] = useState<number | null>(null);
  const [link, setLink] = useState<{ from: string; target: string | null } | null>(null);

  const [ctrl] = useState(() => new NodeEditorController({ tx, ty, sc, gx, gy, setDragId, setDropLane, setLink }));
  useLayoutEffect(() => {
    ctrl.sync({ props, lanes, nodes, edges, rectMap, rectList, polylines, content, headerW, cw, ch });
  });

  // ---- mouse wheel (web) ----
  const surface = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = surface.current as unknown as HTMLElement | null;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => ctrl.wheel(ev, el);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ctrl]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s.w === width && s.h === height ? s : { w: width, h: height }));
  };

  const worldStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: sc.value }],
    transformOrigin: 'top left',
  }));
  const ghostStyle = useAnimatedStyle(() => ({ transform: [{ translateX: gx.value }, { translateY: gy.value }] }));

  const svgW = content.w + 1200;
  const svgH = content.h + 400;
  const ghostNode = dragId ? nodes.find((n) => n.id === dragId) : undefined;
  const btn = Platform.OS === 'web' && size.w >= layout.mobile ? 32 : layout.touchTarget;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }, style]} onLayout={onLayout}>
      <GestureDetector gesture={ctrl.gestures}>
        <View ref={surface} collapsable={false} style={[styles.surface, Platform.OS === 'web' ? ({ cursor: 'grab', userSelect: 'none', touchAction: 'none' } as object) : null]}>
          {lanes.map((lane, i) => (
            <LaneRow key={lane.id} lane={lane} index={i} ty={ty} sc={sc} colors={colors} headerW={headerW} highlight={dropLane === i} empty={!laneHasNode.has(i)} emptyLabel={labels.emptyLane} />
          ))}
          <View pointerEvents="none" style={[styles.clip, { left: headerW }]}>
            <Animated.View style={[styles.world, worldStyle]}>
              <EdgeLayer apiRef={ctrl.edgeApi} edges={edges} rects={rectMap} selectedEdgeId={selectedEdgeId} colors={colors} width={svgW} height={svgH} />
              {nodes.map((n) => {
                const r = rectMap.get(n.id) as Rect;
                return (
                  <View key={n.id} pointerEvents="none" style={{ position: 'absolute', left: r.x, top: r.y }}>
                    <NodeCard
                      colors={colors}
                      title={n.title}
                      subtitle={n.subtitle}
                      planColor={n.planColor}
                      state={n.state}
                      stateLabel={n.stateLabel}
                      detail={n.detail}
                      quiet={n.laneId === 'unassigned'}
                      selected={n.id === selectedId}
                      target={link?.target === n.id}
                      linkSource={link?.from === n.id}
                      faded={n.id === dragId}
                      readOnly={readOnly}
                    />
                  </View>
                );
              })}
              <LinkPreview apiRef={ctrl.previewApi} colors={colors} width={svgW} height={svgH} />
              {ghostNode ? (
                <Animated.View pointerEvents="none" style={[styles.ghost, ghostStyle]}>
                  <NodeCard
                    colors={colors}
                    title={ghostNode.title}
                    subtitle={ghostNode.subtitle}
                    planColor={ghostNode.planColor}
                    state={ghostNode.state}
                    stateLabel={ghostNode.stateLabel}
                    detail={ghostNode.detail}
                    quiet={false}
                    selected
                    target={false}
                    linkSource={false}
                    faded={false}
                    lifted
                    readOnly
                  />
                </Animated.View>
              ) : null}
            </Animated.View>
          </View>
          {lanes.map((lane, i) => (
            <LaneHeader
              key={lane.id}
              lane={lane}
              index={i}
              ty={ty}
              sc={sc}
              colors={colors}
              label={lane.id === 'unassigned' ? labels.unassignedLane : lane.label}
              headerW={headerW}
              compact={compact}
              highlight={dropLane === i}
            />
          ))}
        </View>
      </GestureDetector>
      {showToolbar ? (
        <View style={[styles.toolbar, { backgroundColor: colors.surfaceRaised, borderColor: colors.line }]}>
          <ToolButton glyph="minus" label={labels.zoomOut} size={btn} onPress={() => ctrl.zoomBy(1 / 1.25)} color={colors.muted} line={colors.line} />
          <ToolButton glyph="fit" label={labels.fit} size={btn} onPress={() => ctrl.fit()} color={colors.muted} line={colors.line} />
          <ToolButton glyph="plus" label={labels.zoomIn} size={btn} onPress={() => ctrl.zoomBy(1.25)} color={colors.muted} line={colors.line} />
        </View>
      ) : null}
    </View>
  );
}

function ToolButton({ glyph, label, size, onPress, color, line }: { glyph: GlyphName; label: string; size: number; onPress: () => void; color: string; line: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
        { width: size, height: size, alignItems: 'center', justifyContent: 'center', borderLeftColor: line },
        hovered || pressed ? { opacity: 0.7 } : null,
      ]}
    >
      <Glyph name={glyph} size={16} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  surface: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, overflow: 'hidden' },
  clip: { position: 'absolute', top: 0, bottom: 0, right: 0, overflow: 'hidden' },
  world: { position: 'absolute', left: 0, top: 0, width: 1, height: 1 },
  ghost: { position: 'absolute', left: 0, top: 0 },
  toolbar: { position: 'absolute', right: 12, bottom: 12, flexDirection: 'row', borderWidth: 1, borderRadius: radius.menu, overflow: 'hidden' },
});

export default NodeEditor;
