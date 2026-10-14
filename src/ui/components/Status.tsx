import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, View, type StyleProp, type ViewStyle } from 'react-native';

import { motion } from '../theme';
import { useTheme } from '../theme-context';
import { alpha, useReducedMotion } from './interaction';
import { Txt } from './Txt';

export type DotKind = 'running' | 'unread' | 'connected' | 'attention' | 'error' | 'idle';

const native = Platform.OS !== 'web';

/** 6 px status dot (5 px with size 5). Running pulses, unless reduced motion is on. */
export function Dot({ kind = 'idle', size = 6, color: override, style }: { kind?: DotKind; size?: 5 | 6; color?: string; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(1));
  const pulse = kind === 'running' && !reduced;
  useEffect(() => {
    if (!pulse) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.4, duration: motion.pulse / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: native }),
        Animated.timing(opacity, { toValue: 1, duration: motion.pulse / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, opacity]);

  const color =
    override ??
    (kind === 'running' || kind === 'connected'
      ? colors.green
      : kind === 'unread'
        ? colors.blue
        : kind === 'attention'
          ? colors.amber
          : kind === 'error'
            ? colors.red
            : colors.faint);
  const halo = kind === 'running' ? alpha(colors.green, 0.1) : kind === 'unread' ? alpha(colors.blue, 0.12) : undefined;
  return (
    <Animated.View
      accessible={false}
      style={[
        { width: size, height: size, borderRadius: size, backgroundColor: color, opacity },
        halo ? { boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 0, spreadDistance: 3, color: halo }] } : null,
        style,
      ]}
    />
  );
}

export type StatusTone = 'working' | 'done' | 'failed' | 'connected' | 'attention' | 'running' | 'muted';

/** Dot plus a short 11 px word. */
export function StatusLabel({ tone = 'muted', label, style }: { tone?: StatusTone; label: string; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  // own: the dot takes the text color, like currentColor in Studio.
  const dot: Record<StatusTone, { kind: DotKind; text: keyof typeof colors; own?: boolean }> = {
    working: { kind: 'idle', text: 'accentText', own: true },
    done: { kind: 'idle', text: 'green', own: true },
    failed: { kind: 'idle', text: 'red', own: true },
    connected: { kind: 'connected', text: 'muted' },
    attention: { kind: 'attention', text: 'muted' },
    running: { kind: 'running', text: 'muted' },
    muted: { kind: 'idle', text: 'muted' },
  };
  const d = dot[tone];
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 6 }, style]} accessible accessibilityLabel={label}>
      <Dot kind={d.kind} color={d.own ? colors[d.text] : undefined} />
      <Txt variant="meta" style={{ color: colors[d.text] }} numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}

/** 14 px ring with an accent arc, 0.8 s. */
export function Spinner({ size = 14, color }: { size?: number; color?: string }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [rot] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(Animated.timing(rot, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: native }));
    loop.start();
    return () => loop.stop();
  }, [reduced, rot]);
  const spin = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View
      accessibilityRole="progressbar"
      style={{
        width: size,
        height: size,
        borderRadius: size,
        borderWidth: 1.5,
        borderColor: colors.line,
        borderTopColor: color ?? colors.accent,
        transform: [{ rotate: spin }],
      }}
    />
  );
}
