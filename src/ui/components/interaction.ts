// Shared interaction helpers: hover, keyboard focus ring, reduced motion, colors from tokens.
import { createContext, useCallback, useContext, useEffect, useState, type RefObject } from 'react';
import { AccessibilityInfo, Platform, type TextStyle, type ViewStyle } from 'react-native';

import type { Colors } from '../theme';
import { weight } from '../theme';

export const isWeb = Platform.OS === 'web';

/** Set to true by a MenuButton: the wrapper owns the press and the focus, the trigger inside is inert. */
export const InertContext = createContext(false);
export const useInert = () => useContext(InertContext);

/** Hex color plus alpha (0 to 1). Works with #rrggbb tokens. */
export function alpha(hex: string, a: number): string {
  const base = hex.length === 9 ? hex.slice(0, 7) : hex;
  return base + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
}

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Like CSS color-mix(a pct%, b). */
export function mix(a: string, b: string, pct: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const f = (x: number, y: number) => Math.round(x * pct + y * (1 - pct)).toString(16).padStart(2, '0');
  return `#${f(ar, br)}${f(ag, bg)}${f(ab, bb)}`;
}

/** Font weight as the platform understands it (Android only knows 100 steps). */
export function fw(value: (typeof weight)[keyof typeof weight]): TextStyle['fontWeight'] {
  if (isWeb) return value as TextStyle['fontWeight'];
  const map: Record<string, TextStyle['fontWeight']> = {
    '400': '400',
    '500': '500',
    '550': '500',
    '600': '600',
    '650': '600',
    '700': '700',
  };
  return map[value];
}

/** Hover, press and keyboard focus state for a Pressable. Focus shows only for keyboard focus on the web. */
export function usePressState() {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const onHoverIn = useCallback(() => setHovered(true), []);
  const onHoverOut = useCallback(() => setHovered(false), []);
  const onFocus = useCallback((e: unknown) => {
    if (!isWeb) return setFocused(false);
    const target = (e as { target?: { matches?: (s: string) => boolean } } | undefined)?.target;
    try {
      setFocused(target?.matches ? target.matches(':focus-visible') : true);
    } catch {
      setFocused(true);
    }
  }, []);
  const onBlur = useCallback(() => setFocused(false), []);
  return { hovered, focused, handlers: { onHoverIn, onHoverOut, onFocus, onBlur } };
}

/** 2 px accent outline, offset 3 (Studio global focus rule). Web only; Android has no keyboard ring. */
export function focusRing(colors: Colors, focused: boolean, offset = 3): ViewStyle {
  if (!isWeb || !focused) return {};
  return { outlineWidth: 2, outlineColor: colors.accent, outlineStyle: 'solid', outlineOffset: offset };
}

/** 0.15 s color transition on the web. */
export const webTransition: object = isWeb
  ? { transitionProperty: 'background-color, border-color, color, opacity', transitionDuration: '150ms' }
  : {};

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduced(v)).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/** Sets a native tooltip (title attribute) on the web. No-op on Android. */
export function useWebTitle(ref: RefObject<unknown>, title?: string) {
  useEffect(() => {
    if (!isWeb || !title) return;
    const node = ref.current as { setAttribute?: (k: string, v: string) => void } | null;
    node?.setAttribute?.('title', title);
  }, [ref, title]);
}

/** Extra touch area so that small controls reach 44 px on touch screens. */
export function touchSlop(size: number): { top: number; bottom: number; left: number; right: number } | undefined {
  if (isWeb) return undefined;
  const extra = Math.max(0, Math.ceil((44 - size) / 2));
  return { top: extra, bottom: extra, left: extra, right: extra };
}
