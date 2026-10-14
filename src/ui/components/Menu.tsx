import { useCallback, useContext, useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, View, useWindowDimensions, type View as RNView } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { Icon, type IconName } from '../icons';
import { isTouch, useLayoutMode } from '../layout';
import { fonts, layout, radius } from '../theme';
import { useTheme } from '../theme-context';
import { alpha, focusRing, InertContext, usePressState, webTransition } from './interaction';
import { Txt } from './Txt';

export type MenuEntry = {
  key: string;
  label: string;
  icon?: IconName;
  /** Second line, 9 px mono (model id, address...). */
  detail?: string;
  /** Identity color: a small dot before the label. */
  color?: string;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
};
export type MenuItem = MenuEntry | { divider: true } | { label: string; section: true };

type Rect = { x: number; y: number; width: number; height: number };

function useAnchor() {
  const [node, setNode] = useState<RNView | null>(null);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const [open, setOpen] = useState(false);
  const show = useCallback(() => {
    if (!node) return;
    node.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setOpen(true);
    });
  }, [node]);
  const close = useCallback(() => setOpen(false), []);
  return { bindNode: setNode, anchor, open, show, close };
}

function ItemView({ item, mode, onDone }: { item: MenuEntry; mode: 'menu' | 'options'; onDone: () => void }) {
  const { colors } = useTheme();
  const { hovered, focused, handlers } = usePressState();
  const options = mode === 'options';
  const sel = options && item.checked;
  const fg = item.danger ? colors.red : sel ? colors.accentText : item.checked || hovered || focused ? colors.text : options ? colors.text : colors.muted;
  return (
    <Pressable
      {...handlers}
      disabled={item.disabled}
      onPress={() => {
        onDone();
        item.onPress();
      }}
      accessibilityRole={options ? 'radio' : 'menuitem'}
      accessibilityLabel={item.label}
      accessibilityState={{ disabled: !!item.disabled, selected: !!item.checked, checked: options ? !!item.checked : undefined }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        minHeight: options ? 48 : isTouch ? layout.touchTarget : 40,
        paddingVertical: options ? 8 : 9,
        paddingHorizontal: options ? 10 : 9,
        borderRadius: options ? radius.menu : radius.control,
        borderWidth: options ? 1 : 0,
        borderColor: sel ? alpha(colors.accent, 0.35) : 'transparent',
        backgroundColor: sel ? colors.accentBg : hovered || focused || pressed ? colors.surfaceHover : 'transparent',
        opacity: item.disabled ? 0.4 : 1,
        ...webTransition,
        ...(Platform.OS === 'web' ? ({ outlineWidth: 0 } as const) : {}),
      })}
    >
      {item.color ? <View style={{ width: 10, height: 10, borderRadius: 10, backgroundColor: item.color }} /> : null}
      {item.icon ? <Icon name={item.icon} size={14} color={fg} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="ui" numberOfLines={1} style={{ color: fg, fontWeight: options ? '500' : '400' }}>
          {item.label}
        </Txt>
        {item.detail && options ? (
          <Txt variant="micro" numberOfLines={1} style={{ fontFamily: fonts.mono, color: colors.pickerSecondary, marginTop: 1 }}>
            {item.detail}
          </Txt>
        ) : null}
      </View>
      {item.detail && !options ? (
        <Txt variant="micro" numberOfLines={1}>
          {item.detail}
        </Txt>
      ) : null}
      {item.checked ? <Icon name="check" size={14} color={colors.accent} /> : null}
    </Pressable>
  );
}

function ItemList({ items, mode, onDone }: { items: MenuItem[]; mode: 'menu' | 'options'; onDone: () => void }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="menu">
      {items.map((it, i) => {
        if ('divider' in it) return <View key={`d${i}`} style={{ height: 1, margin: 4, backgroundColor: colors.line }} />;
        if ('section' in it)
          return (
            <View key={`s${i}`} style={{ paddingTop: 8, paddingBottom: 4, paddingHorizontal: 9 }}>
              <Txt variant="meta" tone="faint">
                {it.label}
              </Txt>
            </View>
          );
        return <ItemView key={it.key} item={it} mode={mode} onDone={onDone} />;
      })}
    </View>
  );
}

type PopoverProps = {
  visible: boolean;
  anchor: Rect | null;
  onClose: () => void;
  items: MenuItem[];
  mode?: 'menu' | 'options';
  width?: number;
  align?: 'start' | 'end';
  sheet?: boolean;
  sheetTitle?: string;
};

/** Popover under its trigger, or a bottom sheet on phones. */
function Popover({ visible, anchor, onClose, items, mode = 'menu', width, align = 'end', sheet, sheetTitle }: PopoverProps) {
  const { colors } = useTheme();
  const win = useWindowDimensions();
  const insets = useContext(SafeAreaInsetsContext);
  const [h, setH] = useState(0);
  const shadow = { boxShadow: [{ offsetX: 0, offsetY: 20, blurRadius: 70, color: colors.shadow }], elevation: 12 } as const;
  const body = (
    <ScrollView bounces={false} keyboardShouldPersistTaps="handled" style={{ maxHeight: win.height * (sheet ? 0.7 : 0.8) }}>
      <ItemList items={items} mode={mode} onDone={onClose} />
    </ScrollView>
  );
  let panel: ReactNode;
  if (sheet || !anchor) {
    panel = (
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: 10,
          paddingBottom: 10 + (insets?.bottom ?? 0),
          backgroundColor: colors.surfaceRaised,
          borderTopWidth: 1,
          borderColor: colors.line,
          borderTopLeftRadius: radius.dialog,
          borderTopRightRadius: radius.dialog,
          ...shadow,
        }}
      >
        {sheetTitle ? (
          <View style={{ paddingHorizontal: 9, paddingTop: 4, paddingBottom: 8 }}>
            <Txt variant="sectionLabel">{sheetTitle}</Txt>
          </View>
        ) : null}
        {body}
      </View>
    );
  } else {
    const w = width ?? Math.min(248, win.width - 24);
    let left = align === 'end' ? anchor.x + anchor.width - w : anchor.x;
    left = Math.max(12, Math.min(left, win.width - w - 12));
    let top = anchor.y + anchor.height + 4;
    if (h && top + h > win.height - 12 && anchor.y - 4 - h >= 12) top = anchor.y - 4 - h;
    panel = (
      <View
        onLayout={(e) => setH(e.nativeEvent.layout.height)}
        style={{
          position: 'absolute',
          left,
          top,
          width: w,
          padding: 5,
          opacity: h ? 1 : 0,
          backgroundColor: colors.surfaceRaised,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: radius.menu,
          ...shadow,
        }}
      >
        {body}
      </View>
    );
  }
  return (
    <Modal visible={visible} transparent animationType={sheet ? 'slide' : 'none'} onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable accessible={false} onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: sheet ? colors.backdrop : 'transparent' }} />
      {panel}
    </Modal>
  );
}

export type MenuButtonProps = {
  /** Draws the trigger (an IconButton, a pill...). It is inert: MenuButton handles press and focus. */
  renderTrigger: (open: boolean) => ReactNode;
  items: MenuItem[];
  accessibilityLabel: string;
  align?: 'start' | 'end';
  /** auto: bottom sheet on phones. */
  sheet?: 'auto' | 'never' | 'always';
  sheetTitle?: string;
  disabled?: boolean;
};

export function MenuButton({ renderTrigger, items, accessibilityLabel, align = 'end', sheet = 'auto', sheetTitle, disabled }: MenuButtonProps) {
  const { colors } = useTheme();
  const mode = useLayoutMode();
  const { bindNode, anchor, open, show, close } = useAnchor();
  const { focused, handlers } = usePressState();
  const asSheet = sheet === 'always' || (sheet === 'auto' && mode === 'phone');
  return (
    <>
      <Pressable
        ref={bindNode}
        collapsable={false}
        {...handlers}
        onPress={show}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ expanded: open, disabled: !!disabled }}
        style={{ borderRadius: radius.control, ...focusRing(colors, focused) }}
      >
        <InertContext.Provider value>
          <View pointerEvents="none">{renderTrigger(open)}</View>
        </InertContext.Provider>
      </Pressable>
      <Popover visible={open} anchor={anchor} onClose={close} items={items} align={align} sheet={asSheet} sheetTitle={sheetTitle} />
    </>
  );
}

export type SelectOption = { value: string; label: string; color?: string; detail?: string; icon?: IconName };

/** 40 px select frame (.ps-select) that opens a menu of options as wide as itself. */
export function Select({
  value,
  options,
  onChange,
  placeholder,
  label,
  accessibilityLabel,
  disabled,
}: {
  value: string | null;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const { bindNode, anchor, open, show, close } = useAnchor();
  const { hovered, focused, handlers } = usePressState();
  const current = options.find((o) => o.value === value);
  const items: MenuItem[] = options.map((o) => ({ key: o.value, label: o.label, color: o.color, detail: o.detail, icon: o.icon, checked: o.value === value, onPress: () => onChange(o.value) }));
  return (
    <View>
      {label ? (
        <View style={{ marginBottom: 9 }}>
          <Txt variant="ui" style={{ fontWeight: '500' }}>
            {label}
          </Txt>
        </View>
      ) : null}
      <Pressable
        ref={bindNode}
        collapsable={false}
        {...handlers}
        onPress={show}
        disabled={disabled}
        accessibilityRole="combobox"
        accessibilityLabel={accessibilityLabel ?? label ?? placeholder}
        accessibilityValue={{ text: current?.label }}
        accessibilityState={{ expanded: open, disabled: !!disabled }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 9,
          minHeight: isTouch ? layout.touchTarget : 40,
          paddingVertical: 9,
          paddingHorizontal: 12,
          borderWidth: 1,
          borderColor: open || hovered || focused ? colors.accent : colors.line,
          borderRadius: radius.menu,
          backgroundColor: colors.surface,
          opacity: disabled ? 0.4 : 1,
          ...webTransition,
          ...focusRing(colors, focused),
        }}
      >
        {current?.color ? <View style={{ width: 10, height: 10, borderRadius: 10, backgroundColor: current.color }} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="ui" numberOfLines={1} tone={current ? 'text' : 'faint'}>
            {current?.label ?? placeholder ?? ''}
          </Txt>
        </View>
        <View style={{ transform: [{ rotate: '90deg' }] }}>
          <Icon name="chevron" size={14} color={colors.faint} />
        </View>
      </Pressable>
      <Popover
        visible={open}
        anchor={anchor}
        onClose={close}
        items={items}
        mode="options"
        width={anchor?.width}
        align="start"
      />
    </View>
  );
}
