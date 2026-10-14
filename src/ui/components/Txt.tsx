import type { ReactNode } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

import { fontSize, fonts, weight } from '../theme';
import { useTheme } from '../theme-context';
import { fw } from './interaction';

export type TxtVariant =
  | 'ui'
  | 'uiStrong'
  | 'button'
  | 'meta'
  | 'groupLabel'
  | 'caption'
  | 'sectionLabel'
  | 'micro'
  | 'body'
  | 'heading'
  | 'panel'
  | 'title'
  | 'section'
  | 'stat'
  | 'mono';

export type Tone = 'text' | 'muted' | 'faint' | 'accent' | 'accentText' | 'green' | 'red' | 'amber' | 'blue';

type Spec = {
  size: number;
  w: (typeof weight)[keyof typeof weight];
  tone: Tone;
  lh?: number;
  ls?: number;
  upper?: boolean;
  mono?: boolean;
  tabular?: boolean;
};

// Studio type scale (typography.md).
const SPECS: Record<TxtVariant, Spec> = {
  ui: { size: fontSize.ui, w: weight.regular, tone: 'text', lh: 17 },
  uiStrong: { size: fontSize.ui, w: weight.semi, tone: 'text', lh: 17 },
  button: { size: fontSize.ui, w: weight.medium, tone: 'text', lh: 16 },
  meta: { size: fontSize.meta, w: weight.regular, tone: 'muted', lh: 16.5 },
  groupLabel: { size: fontSize.meta, w: weight.semi, tone: 'faint', lh: 16.5 },
  caption: { size: fontSize.caption, w: weight.regular, tone: 'faint', lh: 14 },
  sectionLabel: { size: fontSize.caption, w: weight.heavy, tone: 'faint', ls: 1.2, upper: true, lh: 14 },
  micro: { size: fontSize.micro, w: weight.regular, tone: 'faint', lh: 12 },
  body: { size: fontSize.body, w: weight.regular, tone: 'text', lh: fontSize.body * 1.8 },
  heading: { size: fontSize.heading, w: weight.bold, tone: 'text', lh: 21 },
  panel: { size: fontSize.panel, w: weight.bold, tone: 'text', lh: 20 },
  title: { size: fontSize.title, w: weight.semi, tone: 'text', ls: -0.6, lh: fontSize.title * 1.3 },
  section: { size: fontSize.section, w: weight.semi, tone: 'text', ls: -0.5, lh: fontSize.section * 1.4 },
  stat: { size: fontSize.stat, w: weight.medium, tone: 'text', tabular: true, lh: 28 },
  mono: { size: fontSize.meta, w: weight.regular, tone: 'text', mono: true, lh: 18 },
};

export type TxtProps = {
  variant?: TxtVariant;
  tone?: Tone;
  numberOfLines?: number;
  selectable?: boolean;
  children?: ReactNode;
  style?: StyleProp<TextStyle>;
  accessibilityRole?: 'header' | 'text' | 'link';
  testID?: string;
};

export function Txt({ variant = 'ui', tone, numberOfLines, selectable, children, style, accessibilityRole, testID }: TxtProps) {
  const { colors } = useTheme();
  const s = SPECS[variant];
  const color = colors[(tone ?? s.tone) === 'accentText' ? 'accentText' : (tone ?? s.tone)];
  const base: TextStyle = {
    color,
    fontSize: s.size,
    fontWeight: fw(s.w),
    fontFamily: s.mono ? fonts.mono : fonts.ui,
    lineHeight: s.lh,
    letterSpacing: s.ls,
    textTransform: s.upper ? 'uppercase' : undefined,
    fontVariant: s.tabular ? ['tabular-nums'] : undefined,
  };
  return (
    <Text
      style={[base, style]}
      numberOfLines={numberOfLines}
      ellipsizeMode="tail"
      selectable={selectable ?? false}
      maxFontSizeMultiplier={1.3}
      accessibilityRole={accessibilityRole}
      testID={testID}
    >
      {children}
    </Text>
  );
}
