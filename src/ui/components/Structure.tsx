import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '../icons';
import { useLayoutMode } from '../layout';
import { layout, radius } from '../theme';
import { useTheme } from '../theme-context';
import { Button } from './Buttons';
import { Dot, type DotKind } from './Status';
import { Txt } from './Txt';
import { useWindowDimensions } from 'react-native';

/** Icon tile (36 px, radius 10, accent background). */
export function IconTile({ icon, size = 36 }: { icon: IconName; size?: number }) {
  const { colors } = useTheme();
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.accentBg }}>
      <Icon name={icon} size={Math.round(size * 0.53)} color={colors.accent} />
    </View>
  );
}

/** One icon tile, one short title, one helpful sentence, at most one action. */
export function EmptyState({
  icon,
  title,
  text,
  actionLabel,
  onAction,
  actionPrimary,
  style,
}: {
  icon: IconName;
  title: string;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Accent-filled action. Only if no other primary button is in the view. */
  actionPrimary?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ alignItems: 'center', paddingVertical: 36, paddingHorizontal: 24, gap: 14 }, style]}>
      <IconTile icon={icon} />
      <View style={{ alignItems: 'center', gap: 6, maxWidth: 360 }}>
        <Txt variant="heading" style={{ textAlign: 'center' }}>
          {title}
        </Txt>
        <Txt variant="meta" tone="muted" style={{ textAlign: 'center', lineHeight: 17.6 }}>
          {text}
        </Txt>
      </View>
      {actionLabel ? <Button label={actionLabel} onPress={onAction} variant={actionPrimary ? 'primary' : 'secondary'} /> : null}
    </View>
  );
}

/** Machine identity: tinted monitor icon (or a dot), the name, an optional status dot. Never a filled background. */
export function MachineChip({
  name,
  color,
  status,
  variant = 'icon',
  muted,
  style,
}: {
  name: string;
  color: string;
  status?: DotKind;
  variant?: 'icon' | 'dot';
  /** Offline machines get a muted name. */
  muted?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0 }, style]}>
      {variant === 'dot' ? <View style={{ width: 10, height: 10, borderRadius: 10, backgroundColor: color }} /> : <Icon name="machine" size={14} color={color} />}
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <Txt variant="ui" tone={muted ? 'muted' : 'text'} numberOfLines={1}>
          {name}
        </Txt>
      </View>
      {status ? <Dot kind={status} /> : null}
    </View>
  );
}

/** Folder or monitor icon, muted parents, faint "/", the current page in text color. The current page truncates first. */
export function Breadcrumb({ items, icon = 'folder', iconColor, fillIcon }: { items: string[]; icon?: IconName; iconColor?: string; fillIcon?: boolean }) {
  const { colors } = useTheme();
  const last = items.length - 1;
  return (
    <View accessibilityRole="header" accessibilityLabel={items.join(' / ')} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0, flexShrink: 1, overflow: 'hidden' }}>
      <Icon name={icon} size={15} color={iconColor ?? colors.muted} fill={fillIcon ? iconColor : undefined} />
      {items.map((it, i) => (
        <View key={`${i}-${it}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0, flexShrink: i === last ? 1 : 0, maxWidth: i === last ? undefined : 160 }}>
          <View style={{ minWidth: 0, flexShrink: 1 }}>
            <Txt variant="ui" tone={i === last ? 'text' : 'muted'} numberOfLines={1}>
              {it}
            </Txt>
          </View>
          {i < last ? (
            <Txt variant="ui" tone="faint">
              /
            </Txt>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** 67 px bar: breadcrumb at the left, actions at the right. Two rows on phones. */
export function Header({ left, actions, leading }: { left: ReactNode; actions?: ReactNode; leading?: ReactNode }) {
  const { colors } = useTheme();
  const mode = useLayoutMode();
  const { width } = useWindowDimensions();
  const border = { borderBottomWidth: 1, borderBottomColor: colors.lineSoft, backgroundColor: colors.bg } as const;
  if (mode === 'phone') {
    return (
      <View style={{ minHeight: 58, paddingVertical: 6, paddingHorizontal: 13, gap: 4, ...border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}>
          {leading}
          <View style={{ flex: 1, minWidth: 0 }}>{left}</View>
        </View>
        {actions ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingBottom: 4 }}>{actions}</View> : null}
      </View>
    );
  }
  return (
    <View style={{ height: layout.headerHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingHorizontal: width >= layout.wide ? 35 : 27, ...border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        {leading}
        <View style={{ flexShrink: 1, minWidth: 0 }}>{left}</View>
      </View>
      {actions ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }}>{actions}</View> : null}
    </View>
  );
}

/** Panel body: title (15/600), muted subtitle, then content. Padding 18. */
export function Panel({ title, subtitle, actions, children, padding = 18, style }: { title: string; subtitle?: string; actions?: ReactNode; children?: ReactNode; padding?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ padding }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="panel" accessibilityRole="header" numberOfLines={1}>
            {title}
          </Txt>
          {subtitle ? (
            <Txt variant="body" tone="muted" numberOfLines={1} style={{ marginTop: 2, lineHeight: 20 }}>
              {subtitle}
            </Txt>
          ) : null}
        </View>
        {actions ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>{actions}</View> : null}
      </View>
      {children ? <View style={{ marginTop: 14 }}>{children}</View> : null}
    </View>
  );
}
