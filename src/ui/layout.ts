import { Platform, useWindowDimensions } from 'react-native';

import { layout } from './theme';

export type LayoutMode = 'phone' | 'tablet' | 'desktop';

/** Touch device: Android (and iOS). The web build is pointer first. */
export const isTouch = Platform.OS !== 'web';

/** phone < 760, tablet < 1080, desktop otherwise (Studio breakpoints). */
export function modeForWidth(width: number): LayoutMode {
  if (width < layout.mobile) return 'phone';
  if (width < layout.compactShell) return 'tablet';
  return 'desktop';
}

export function useLayoutMode(): LayoutMode {
  const { width } = useWindowDimensions();
  return modeForWidth(width);
}
