import { useRef, type ReactNode } from 'react';
import { Pressable, View, type StyleProp, type View as RNView, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '../icons';
import { isTouch } from '../layout';
import { fontSize, layout, radius, weight } from '../theme';
import { useTheme } from '../theme-context';
import { fw, focusRing, touchSlop, usePressState, useInert, useWebTitle, webTransition } from './interaction';
import { Kbd } from './Labels';
import { Spinner } from './Status';
import { Txt } from './Txt';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'tinted' | 'quiet' | 'text';

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  compact?: boolean;
  icon?: IconName;
  iconRight?: IconName;
  /** Shortcut hint shown at the right, like "Ctrl N". */
  kbd?: string;
  disabled?: boolean;
  loading?: boolean;
  /** Full width. tinted and quiet are always full width. */
  full?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Button({
  label,
  onPress,
  variant = 'secondary',
  compact,
  icon,
  iconRight,
  kbd,
  disabled,
  loading,
  full,
  accessibilityLabel,
  style,
  testID,
}: ButtonProps) {
  const { colors } = useTheme();
  const { hovered, focused, handlers } = usePressState();
  const inert = useInert();
  const off = disabled || loading;

  let bg: string = 'transparent';
  let border: string = 'transparent';
  let fg: string = colors.text;
  switch (variant) {
    case 'primary':
      bg = hovered ? colors.accentStrong : colors.accent;
      fg = colors.accentInk;
      break;
    case 'danger':
      bg = colors.red;
      fg = colors.bg;
      break;
    case 'tinted':
      bg = hovered ? colors.surfaceHover : colors.accentBg;
      border = hovered ? colors.accent : colors.tintedLine;
      fg = colors.accentText;
      break;
    case 'secondary':
    case 'quiet':
      border = colors.line;
      bg = hovered ? colors.surfaceHover : 'transparent';
      fg = hovered ? colors.text : colors.muted;
      break;
    case 'text':
      fg = hovered ? colors.text : colors.muted;
      break;
  }

  const wide = full || variant === 'tinted' || variant === 'quiet';
  const framed = variant !== 'text';
  const fontPx = compact ? fontSize.caption : variant === 'quiet' ? fontSize.meta : fontSize.ui;
  const iconPx = variant === 'tinted' ? 16 : 13;
  const minHeight = compact ? layout.touchTarget - 12 : undefined;
  const container: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: variant === 'tinted' ? 'flex-start' : 'center',
    gap: variant === 'tinted' || variant === 'quiet' ? 9 : 7,
    paddingVertical: !framed ? 3 : compact ? 6 : variant === 'tinted' ? 11 : variant === 'quiet' ? 8 : 9,
    paddingHorizontal: !framed ? 0 : compact ? 10 : variant === 'tinted' ? 12 : variant === 'quiet' ? 12 : 13,
    minHeight: framed ? (isTouch && !compact ? layout.touchTarget : minHeight) : undefined,
    borderWidth: framed ? 1 : 0,
    borderColor: border,
    borderRadius: radius.control,
    backgroundColor: bg,
    alignSelf: wide ? 'stretch' : undefined,
    opacity: disabled ? 0.4 : 1,
    ...webTransition,
    ...focusRing(colors, focused),
  };
  const ref = useRef<RNView>(null);
  const height = compact ? 32 : 36;

  return (
    <Pressable
      ref={ref}
      {...handlers}
      onPress={off ? undefined : onPress}
      disabled={off}
      focusable={!inert}
      accessible={!inert}
      accessibilityRole={inert ? undefined : 'button'}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      hitSlop={framed ? touchSlop(height) : touchSlop(20)}
      testID={testID}
      style={({ pressed }) => [container, pressed && !off && variant !== 'primary' ? { backgroundColor: colors.surfaceHover } : null, style]}
    >
      {loading ? <Spinner size={13} color={variant === 'primary' || variant === 'danger' ? fg : undefined} /> : icon ? <Icon name={icon} size={iconPx} color={fg} /> : null}
      <Txt
        variant="button"
        numberOfLines={1}
        style={{
          color: fg,
          fontSize: fontPx,
          fontWeight: fw(variant === 'tinted' ? weight.semi : variant === 'quiet' ? weight.regular : weight.medium),
          flexShrink: 1,
        }}
      >
        {label}
      </Txt>
      {iconRight ? <Icon name={iconRight} size={iconPx} color={fg} /> : null}
      {kbd ? (
        <View style={{ marginLeft: 'auto' }}>
          <Kbd label={kbd} tint={variant === 'tinted'} />
        </View>
      ) : null}
    </Pressable>
  );
}

/** Row of buttons with the Studio gap (9 px). Buttons are inline: always place them in a row like this. */
export function ButtonRow({ children, align = 'start', style }: { children: ReactNode; align?: 'start' | 'end'; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 9, justifyContent: align === 'end' ? 'flex-end' : 'flex-start' }, style]}>
      {children}
    </View>
  );
}

export type IconButtonSize = 'sm' | 'md' | 'header';
const BOX: Record<IconButtonSize, { box: number; icon: number }> = {
  sm: { box: 23, icon: 15 },
  md: { box: 32, icon: 18 },
  header: { box: 28, icon: 16 },
};

export type IconButtonProps = {
  icon: IconName;
  /** Required. Also used as the tooltip on the web unless title is given. */
  accessibilityLabel: string;
  title?: string;
  onPress?: () => void;
  size?: IconButtonSize;
  active?: boolean;
  disabled?: boolean;
  /** Color override for the idle icon (for example a machine color). */
  color?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function IconButton({ icon, accessibilityLabel, title, onPress, size = 'md', active, disabled, color, style, testID }: IconButtonProps) {
  const { colors } = useTheme();
  const { hovered, focused, handlers } = usePressState();
  const inert = useInert();
  const ref = useRef<RNView>(null);
  useWebTitle(ref, title ?? accessibilityLabel);
  const d = BOX[size];
  const fg = active ? colors.accent : hovered ? colors.text : (color ?? colors.muted);
  return (
    <Pressable
      ref={ref}
      {...handlers}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      focusable={!inert}
      accessible={!inert}
      accessibilityRole={inert ? undefined : 'button'}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      hitSlop={touchSlop(d.box)}
      testID={testID}
      style={({ pressed }) => [
        {
          width: d.box,
          height: d.box,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.control,
          backgroundColor: active ? colors.accentBg : hovered || pressed ? colors.surfaceHover : 'transparent',
          opacity: disabled ? 0.4 : 1,
          flexShrink: 0,
          ...webTransition,
          ...focusRing(colors, focused),
        },
        style,
      ]}
    >
      <Icon name={icon} size={d.icon} color={fg} />
    </Pressable>
  );
}
