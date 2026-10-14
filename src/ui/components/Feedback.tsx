import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { Icon, type IconName } from '../icons';
import { useLayoutMode } from '../layout';
import { fontSize, motion, radius } from '../theme';
import { useTheme } from '../theme-context';
import { alpha, isWeb, mix, useReducedMotion } from './interaction';
import { Txt } from './Txt';

export type BannerTone = 'info' | 'warning' | 'error' | 'quiet';

/** Full-width strip under a header: one short sentence and at most one small button. */
export function Banner({
  tone = 'info',
  text,
  actionLabel,
  onAction,
  icon,
}: {
  tone?: BannerTone;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: IconName;
}) {
  const { colors } = useTheme();
  const mode = useLayoutMode();
  const bg = tone === 'info' ? colors.accentBg : tone === 'warning' ? mix(colors.amber, colors.bg, 0.09) : tone === 'error' ? alpha(colors.red, 0.07) : 'transparent';
  const fg = tone === 'info' ? colors.accentText : tone === 'warning' ? colors.text : tone === 'error' ? colors.red : colors.muted;
  const defaultIcon: IconName | undefined = tone === 'quiet' ? 'shield' : tone === 'warning' || tone === 'error' ? 'alert' : undefined;
  const iconName = icon ?? defaultIcon;
  const iconColor = tone === 'warning' ? colors.amber : tone === 'quiet' ? colors.accent : fg;
  const [pressed, setPressed] = useState(false);
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        columnGap: 12,
        paddingVertical: tone === 'quiet' ? 9 : 10,
        paddingHorizontal: mode === 'phone' ? 13 : tone === 'quiet' ? 24 : 27,
        borderBottomWidth: 1,
        borderBottomColor: tone === 'quiet' ? colors.lineSoft : colors.line,
        backgroundColor: bg,
      }}
    >
      {iconName ? <Icon name={iconName} size={14} color={iconColor} /> : null}
      <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 200 }}>
        <Txt variant="meta" style={{ color: fg, lineHeight: 17.6, fontSize: tone === 'warning' ? fontSize.ui : fontSize.meta }}>
          {text}
        </Txt>
      </View>
      {actionLabel ? (
        <Pressable
          onPress={onAction}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={{ minHeight: 32, paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: pressed ? colors.accent : colors.line, borderRadius: radius.sm, backgroundColor: colors.surface, justifyContent: 'center' }}
        >
          <Txt variant="meta">{actionLabel}</Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

// Toasts ---------------------------------------------------------------------------------------

export type ToastTone = 'success' | 'error';
type ToastInput = { text: string; tone?: ToastTone };
type ToastItem = ToastInput & { id: number };

const ToastContext = createContext<{ show: (t: ToastInput) => void }>({ show: () => {} });
export const useToast = () => useContext(ToastContext);

function ToastView({ item, onDone }: { item: ToastItem; onDone: (id: number) => void }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [anim] = useState(() => new Animated.Value(reduced ? 1 : 0));
  useEffect(() => {
    if (reduced) anim.setValue(1);
    else Animated.timing(anim, { toValue: 1, duration: motion.toast, useNativeDriver: !isWeb }).start();
    const t = setTimeout(() => onDone(item.id), item.tone === 'error' ? 6000 : 4000);
    return () => clearTimeout(t);
  }, [anim, item.id, item.tone, onDone, reduced]);
  const error = item.tone === 'error';
  return (
    <Animated.View style={{ opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }], maxWidth: 390 }}>
      <Pressable
        onPress={() => onDone(item.id)}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        accessibilityLabel={item.text}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingVertical: 13,
          paddingHorizontal: 15,
          backgroundColor: colors.surfaceRaised,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: radius.md,
          boxShadow: [{ offsetX: 0, offsetY: 20, blurRadius: 70, color: colors.shadow }],
          elevation: 8,
        }}
      >
        <Icon name={error ? 'alert' : 'check'} size={15} color={error ? colors.red : colors.green} />
        <View style={{ flexShrink: 1 }}>
          <Txt variant="ui" style={{ lineHeight: 18 }}>
            {item.text}
          </Txt>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** Wrap the app once. useToast().show({ text, tone }) from anywhere below. Bottom right on wide screens, bottom center on phones. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const mode = useLayoutMode();
  const insets = useContext(SafeAreaInsetsContext);
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const show = useCallback((t: ToastInput) => {
    const id = next.current++;
    setItems((cur) => [...cur.slice(-3), { ...t, id }]);
  }, []);
  const done = useCallback((id: number) => setItems((cur) => cur.filter((x) => x.id !== id)), []);
  const value = useMemo(() => ({ show }), [show]);
  const phone = mode === 'phone';
  return (
    <ToastContext.Provider value={value}>
      {children}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          left: phone ? 16 : undefined,
          right: phone ? 16 : 24,
          bottom: 24 + (insets?.bottom ?? 0),
          alignItems: phone ? 'center' : 'flex-end',
          gap: 8,
          zIndex: 100,
        }}
      >
        {items.map((it) => (
          <ToastView key={it.id} item={it} onDone={done} />
        ))}
      </View>
    </ToastContext.Provider>
  );
}
