import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '../icons';
import { isTouch } from '../layout';
import { layout, radius } from '../theme';
import { useTheme } from '../theme-context';
import { focusRing, isWeb, touchSlop, usePressState, webTransition } from './interaction';
import { Txt } from './Txt';

/** 31 x 18 switch like .ps-switch. */
export function Switch({ value, onValueChange, accessibilityLabel, disabled, style }: { value: boolean; onValueChange: (v: boolean) => void; accessibilityLabel: string; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const { colors, name } = useTheme();
  const { focused, handlers } = usePressState();
  return (
    <Pressable
      {...handlers}
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      hitSlop={touchSlop(18)}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      style={[{ width: 31, height: 18, borderRadius: 15, backgroundColor: value ? colors.accent : colors.line, opacity: disabled ? 0.4 : 1, flexShrink: 0, ...webTransition, ...focusRing(colors, focused) }, style]}
    >
      <View
        style={{
          position: 'absolute',
          top: 3,
          left: value ? 16 : 3,
          width: 12,
          height: 12,
          borderRadius: 12,
          // Knob is white on the accent track, muted otherwise (near white text token in dark, surface in light).
          backgroundColor: value ? (name === 'dark' ? colors.text : colors.surface) : colors.muted,
        }}
      />
    </Pressable>
  );
}

/** 16 px checkbox. tone green is for Roadmap steps (checked = green), accent elsewhere. */
export function Checkbox({
  checked,
  onChange,
  label,
  tone = 'accent',
  indeterminate,
  disabled,
  accessibilityLabel,
  style,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  tone?: 'accent' | 'green';
  indeterminate?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const { hovered, focused, handlers } = usePressState();
  const on = checked || indeterminate;
  const fill = tone === 'green' && checked && !indeterminate ? colors.green : colors.accent;
  return (
    <Pressable
      {...handlers}
      onPress={() => onChange(!checked)}
      disabled={disabled}
      hitSlop={touchSlop(16)}
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ checked: indeterminate ? 'mixed' : checked, disabled: !!disabled }}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: isTouch ? 10 : 8, opacity: disabled ? 0.4 : 1, alignSelf: 'flex-start' }, style]}
    >
      <View
        style={{
          width: 16,
          height: 16,
          borderRadius: radius.xs,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: on ? 0 : 1.5,
          borderColor: hovered ? colors.muted : colors.faint,
          backgroundColor: on ? fill : 'transparent',
          ...webTransition,
          ...focusRing(colors, focused),
        }}
      >
        {checked && !indeterminate ? <Icon name="check" size={12} color={colors.accentInk} /> : null}
        {indeterminate ? <View style={{ width: 8, height: 1.5, borderRadius: 1, backgroundColor: colors.accentInk }} /> : null}
      </View>
      {label ? (
        <Txt variant="ui" tone="muted" numberOfLines={1}>
          {label}
        </Txt>
      ) : null}
    </Pressable>
  );
}

export type SegmentOption = { key: string; label: string; icon?: IconName };

function SegmentItem({ o, active, onPress }: { o: SegmentOption; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const { hovered, focused, handlers } = usePressState();
  return (
    <Pressable
      {...handlers}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={o.label}
      accessibilityState={{ selected: active, checked: active }}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: isTouch ? layout.touchTarget : 40,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        borderRadius: radius.control,
        backgroundColor: active ? colors.accentBg : 'transparent',
        ...webTransition,
        ...focusRing(colors, focused, -2),
      }}
    >
      {o.icon ? <Icon name={o.icon} size={14} color={active ? colors.accentText : colors.muted} /> : null}
      <Txt variant="ui" numberOfLines={1} style={{ color: active ? colors.accentText : hovered ? colors.text : colors.muted, flexShrink: 1 }}>
        {o.label}
      </Txt>
    </Pressable>
  );
}

/** 2 to 4 equal options in a surface frame; the active option is accent-bg. */
export function Segmented({ options, value, onChange, style }: { options: SegmentOption[]; value: string; onChange: (key: string) => void; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      style={[{ flexDirection: 'row', padding: 4, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface }, style]}
    >
      {options.map((o) => (
        <SegmentItem key={o.key} o={o} active={o.key === value} onPress={() => onChange(o.key)} />
      ))}
    </View>
  );
}

function Swatch({ color, label, checked, onPress }: { color: string | null; label: string; checked: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const { focused, handlers } = usePressState();
  return (
    <Pressable
      {...handlers}
      onPress={onPress}
      hitSlop={isWeb ? undefined : { top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: checked ? colors.text : 'transparent', ...focusRing(colors, focused, 2) }}
    >
      <View
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: color ?? 'transparent',
          borderWidth: color ? 0 : 1,
          borderColor: colors.line,
          borderStyle: color ? 'solid' : 'dashed',
        }}
      />
    </Pressable>
  );
}

/** Identity color choice (machines, plans, projects). The first circle is the dashed default. */
export function Swatches({
  colors: palette,
  value,
  onChange,
  defaultLabel,
  labels,
  style,
}: {
  colors: readonly string[];
  /** Selected color, or null for the default. */
  value: string | null;
  onChange: (color: string | null) => void;
  /** Label of the "default" (transparent) choice. Without it, no default choice is shown. */
  defaultLabel?: string;
  /** Accessible names of the colors, same order. */
  labels?: readonly string[];
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View accessibilityRole="radiogroup" style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: 2 }, style]}>
      {defaultLabel ? <Swatch color={null} label={defaultLabel} checked={value == null} onPress={() => onChange(null)} /> : null}
      {palette.map((c, i) => (
        <Swatch key={c} color={c} label={labels?.[i] ?? c} checked={value === c} onPress={() => onChange(c)} />
      ))}
    </View>
  );
}
