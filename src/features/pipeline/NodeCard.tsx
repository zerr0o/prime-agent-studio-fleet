import { memo, useEffect } from 'react';
import { Platform, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import type { NodeState } from '@/domain/types';
import { fw } from '@/ui/components/interaction';
import { fontSize, motion, radius, weight, type Colors } from '@/ui/theme';

import { NODE_H, NODE_W, PORT_R } from './geometry';

export type NodeCardProps = {
  colors: Colors;
  title: string;
  subtitle: string;
  planColor?: string | null;
  state: NodeState;
  stateLabel: string;
  detail?: string;
  quiet: boolean; // node of the unassigned lane
  selected: boolean;
  target: boolean; // valid drop target of a link being drawn
  linkSource: boolean;
  faded: boolean; // the card is being dragged (a ghost follows the pointer)
  lifted?: boolean; // this is the ghost
  readOnly: boolean;
};

export function stateColor(state: NodeState, c: Colors): string {
  switch (state) {
    case 'running':
    case 'done':
      return c.green;
    case 'ready':
      return c.accent;
    case 'review':
    case 'offline':
      return c.amber;
    case 'failed':
      return c.red;
    case 'queued':
    case 'stopped':
      return c.muted;
    default:
      return c.faint; // waiting, unassigned, missing
  }
}

function StateDot({ color, pulse }: { color: string; pulse: boolean }) {
  const o = useSharedValue(1);
  useEffect(() => {
    if (!pulse) {
      o.value = 1;
      return;
    }
    o.value = withRepeat(
      withSequence(withTiming(0.3, { duration: motion.pulse / 2, easing: Easing.inOut(Easing.ease) }), withTiming(1, { duration: motion.pulse / 2, easing: Easing.inOut(Easing.ease) })),
      -1,
    );
  }, [pulse, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }, style]} />;
}

function Port({ side, colors, active }: { side: 'in' | 'out'; colors: Colors; active: boolean }) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.port,
        side === 'in' ? { left: -PORT_R - 1 } : { right: -PORT_R - 1 },
        { backgroundColor: active ? colors.accent : colors.surface, borderColor: active ? colors.accent : colors.faint },
      ]}
    />
  );
}

function NodeCardImpl(p: NodeCardProps) {
  const { colors: c } = p;
  const dot = stateColor(p.state, c);
  const wordColor = p.state === 'failed' || p.state === 'missing' ? c.red : c.muted;
  const borderColor = p.selected || p.target ? c.accent : p.quiet ? c.lineSoft : c.line;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.card,
        {
          backgroundColor: p.quiet ? c.bg : c.surface,
          borderColor,
          borderStyle: p.quiet && !p.selected && !p.target ? 'dashed' : 'solid',
          opacity: p.faded ? 0.35 : 1,
        },
        p.lifted && { borderColor: c.accent, backgroundColor: c.surfaceRaised, ...shadow(c) },
      ]}
    >
      {p.planColor ? <View style={[styles.planBar, { backgroundColor: p.planColor }]} /> : null}
      <View style={styles.body}>
        <Text numberOfLines={2} style={[styles.title, { color: p.quiet ? c.muted : c.text }]}>
          {p.title}
        </Text>
        <Text numberOfLines={1} style={[styles.subtitle, { color: c.muted }]}>
          {p.subtitle}
        </Text>
      </View>
      <View style={styles.stateRow}>
        <StateDot color={dot} pulse={p.state === 'running'} />
        <Text numberOfLines={1} style={[styles.stateWord, { color: wordColor }]}>
          {p.stateLabel}
        </Text>
        {p.detail ? (
          <Text numberOfLines={1} style={[styles.detail, { color: c.muted }]}>
            {'· ' + p.detail}
          </Text>
        ) : null}
      </View>
      {p.readOnly ? null : <Port side="in" colors={c} active={p.target} />}
      {p.readOnly ? null : <Port side="out" colors={c} active={p.linkSource} />}
    </View>
  );
}

function shadow(c: Colors) {
  return Platform.select({
    web: { boxShadow: `0 6px 18px ${c.shadow}` } as object,
    default: { elevation: 6, shadowColor: c.shadow, shadowOpacity: 1, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  });
}

export const NodeCard = memo(NodeCardImpl);

const styles = StyleSheet.create({
  card: {
    width: NODE_W,
    height: NODE_H,
    borderRadius: radius.menu,
    borderWidth: 1,
    paddingVertical: 8,
    paddingLeft: 12,
    paddingRight: 10,
    justifyContent: 'space-between',
    overflow: 'visible',
  },
  planBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, borderTopLeftRadius: radius.menu - 1, borderBottomLeftRadius: radius.menu - 1 },
  body: { gap: 1 },
  title: { fontSize: fontSize.ui, lineHeight: 16, fontWeight: fw(weight.semi) as TextStyle['fontWeight'] },
  subtitle: { fontSize: fontSize.meta, lineHeight: 13 },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 14 },
  stateWord: { fontSize: fontSize.meta, lineHeight: 14, flexShrink: 0 },
  detail: { fontSize: fontSize.meta, lineHeight: 14, flexShrink: 1 },
  port: { position: 'absolute', top: NODE_H / 2 - PORT_R - 1, width: PORT_R * 2, height: PORT_R * 2, borderRadius: PORT_R, borderWidth: 1.5 },
});
