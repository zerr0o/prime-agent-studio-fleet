import { memo } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import type { EditorLane } from '@/domain/types';
import { fw } from '@/ui/components/interaction';
import { fontSize, weight, type Colors } from '@/ui/theme';

import { Glyph } from './glyphs';
import { LANE_H } from './geometry';

type Anim = { ty: SharedValue<number>; sc: SharedValue<number>; index: number };

/** Vertical offset (transform, no layout pass while panning) and height of a lane, driven by the pan and zoom shared values. */
function useLaneBox({ ty, sc, index }: Anim) {
  return useAnimatedStyle(() => ({ transform: [{ translateY: ty.value + index * LANE_H * sc.value }], height: LANE_H * sc.value }));
}

type RowProps = Anim & { lane: EditorLane; colors: Colors; highlight: boolean; empty: boolean; emptyLabel: string; headerW: number };

/** Lane background: a separator line, the drop highlight and the "empty" hint. Drawn under the cards. */
export const LaneRow = memo(function LaneRow(p: RowProps) {
  const box = useLaneBox(p);
  const quiet = p.lane.id === 'unassigned';
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.row, { backgroundColor: p.colors.bg, borderBottomColor: quiet ? p.colors.lineSoft : p.colors.line }, box]}
    >
      {p.highlight ? <View style={[StyleSheet.absoluteFill, { backgroundColor: p.colors.accentBg, opacity: 0.55 }]} /> : null}
      {p.empty ? (
        <View style={[styles.empty, { left: p.headerW + 16 }]}>
          <Text numberOfLines={1} style={{ color: p.colors.faint, fontSize: fontSize.meta }}>
            {p.emptyLabel}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
});

type HeaderProps = Anim & { lane: EditorLane; colors: Colors; label: string; headerW: number; compact: boolean; highlight: boolean };

/** Sticky lane header: machine glyph in the machine color, label, online dot, meta line. */
export const LaneHeader = memo(function LaneHeader(p: HeaderProps) {
  const box = useLaneBox(p);
  const { lane, colors: c } = p;
  const quiet = lane.id === 'unassigned';
  const tint = quiet ? c.faint : (lane.color ?? c.muted);
  const online = lane.online === null ? null : lane.online ? c.green : c.amber;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.header,
        { width: p.headerW, backgroundColor: c.sidebar, borderRightColor: c.line, borderBottomColor: quiet ? c.lineSoft : c.line, paddingHorizontal: p.compact ? 10 : 14 },
        box,
      ]}
    >
      <View style={styles.headRow}>
        {p.compact ? (
          // Narrow screens: the machine color as a 3 px mark, no glyph, so the name keeps its room.
          <View style={[styles.idMark, { backgroundColor: quiet ? c.faint : (lane.color ?? c.muted) }]} />
        ) : (
          <Glyph name={quiet ? 'inbox' : 'machine'} size={15} color={tint} />
        )}
        <Text numberOfLines={p.compact ? 2 : 1} style={[styles.label, { color: quiet ? c.muted : c.text }]}>
          {p.label}
        </Text>
        {online ? <View style={[styles.dot, { backgroundColor: online }]} /> : null}
      </View>
      {lane.meta ? (
        <Text numberOfLines={p.compact ? 2 : 1} style={[styles.meta, { color: c.muted, paddingLeft: p.compact ? 9 : 23 }]}>
          {lane.meta}
        </Text>
      ) : null}
      {p.highlight ? <View style={[styles.mark, { backgroundColor: c.accent }]} /> : null}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  row: { position: 'absolute', top: 0, left: 0, right: 0, borderBottomWidth: 1, overflow: 'hidden' },
  empty: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center' },
  header: { position: 'absolute', top: 0, left: 0, borderRightWidth: 1, borderBottomWidth: 1, justifyContent: 'center', gap: 4, overflow: 'hidden' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { flex: 1, fontSize: fontSize.ui, lineHeight: 16, fontWeight: fw(weight.semi) as TextStyle['fontWeight'] },
  meta: { fontSize: fontSize.caption, lineHeight: 14 },
  idMark: { width: 3, height: 14, borderRadius: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  mark: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
});
