import { useState } from 'react';
import { TextInput, View, type KeyboardTypeOptions, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';

import { Icon } from '../icons';
import { isTouch } from '../layout';
import { fontSize, fonts, radius } from '../theme';
import { useTheme } from '../theme-context';
import { alpha, isWeb, webTransition } from './interaction';
import { Kbd } from './Labels';
import { Txt } from './Txt';

const noOutline = isWeb ? ({ outlineWidth: 0 } as const) : {};

function useFocus() {
  const [focused, setFocused] = useState(false);
  return { focused, onFocus: () => setFocused(true), onBlur: () => setFocused(false) };
}

/** Border turns accent with a 2 px ring at 18 % (Studio framed fields). */
function ring(colors: { accent: string }, on: boolean): { boxShadow?: string } {
  return on && isWeb ? { boxShadow: `0 0 0 2px ${alpha(colors.accent, 0.18)}` } : {};
}

export type TextFieldProps = {
  label?: string;
  /** Small faint word next to the label, like "optional". */
  hint?: string;
  help?: string;
  error?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secure?: boolean;
  mono?: boolean;
  multiline?: boolean;
  /** Minimum height of a multiline field in px. */
  minHeight?: number;
  editable?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
  /** Field fill. bg is for fields inside dialogs and cards, surface for fields on the page background. */
  fill?: 'bg' | 'surface';
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function TextField({
  label,
  hint,
  help,
  error,
  value,
  onChangeText,
  placeholder,
  secure,
  mono,
  multiline,
  minHeight = 84,
  editable = true,
  keyboardType,
  autoCapitalize = 'none',
  autoFocus,
  onSubmitEditing,
  fill = 'bg',
  accessibilityLabel,
  style,
  testID,
}: TextFieldProps) {
  const { colors } = useTheme();
  const f = useFocus();
  const border = error ? colors.red : f.focused ? colors.accent : colors.line;
  const inputStyle: TextStyle = {
            width: '100%',
            paddingVertical: 11,
            paddingHorizontal: 12,
            borderWidth: 1,
            borderColor: border,
            borderRadius: radius.control,
            backgroundColor: fill === 'bg' ? colors.bg : colors.surface,
            color: colors.text,
            fontSize: isTouch ? 14 : fontSize.body,
            fontFamily: mono ? fonts.mono : fonts.ui,
            opacity: editable ? 1 : 0.5,
            minHeight: multiline ? minHeight : undefined,
            textAlignVertical: multiline ? 'top' : 'center',
            ...webTransition,
            ...noOutline,
            ...ring(colors, f.focused),
  };
  return (
    <View style={style}>
      {label ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 9 }}>
          <Txt variant="ui" style={{ fontWeight: '500' }}>
            {label}
          </Txt>
          {hint ? (
            <Txt variant="micro" style={{ marginLeft: 4 }}>
              {hint}
            </Txt>
          ) : null}
        </View>
      ) : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        selectionColor={colors.accent}
        cursorColor={colors.accent}
        secureTextEntry={secure}
        multiline={multiline}
        editable={editable}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        autoFocus={autoFocus}
        onSubmitEditing={onSubmitEditing}
        onFocus={f.onFocus}
        onBlur={f.onBlur}
        accessibilityLabel={accessibilityLabel ?? label ?? placeholder}
        accessibilityState={{ disabled: !editable }}
        testID={testID}
        style={inputStyle}
      />
      {error ? (
        <Txt variant="meta" tone="red" style={{ marginTop: 6, lineHeight: 17.6 }}>
          {error}
        </Txt>
      ) : help ? (
        <Txt variant="meta" tone="muted" style={{ marginTop: 6, lineHeight: 17.6 }}>
          {help}
        </Txt>
      ) : null}
    </View>
  );
}

type SearchProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  accessibilityLabel?: string;
  onSubmitEditing?: () => void;
  style?: StyleProp<ViewStyle>;
};

/** Borderless sidebar search: 15 px icon, 11 px input, kbd hint. Icon and text turn accent on focus. */
export function SearchField({ value, onChangeText, placeholder, kbd, accessibilityLabel, onSubmitEditing, style }: SearchProps & { kbd?: string }) {
  const { colors } = useTheme();
  const f = useFocus();
  const fg = f.focused ? colors.accent : colors.faint;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 1, minHeight: isTouch ? 44 : 26 }, style]}>
      <Icon name="search" size={15} color={fg} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        selectionColor={colors.accent}
        cursorColor={colors.accent}
        autoCapitalize="none"
        autoCorrect={false}
        onFocus={f.onFocus}
        onBlur={f.onBlur}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        returnKeyType="search"
        style={{ flex: 1, minWidth: 0, height: 26, padding: 0, color: f.focused ? colors.accent : colors.text, fontSize: isTouch ? 14 : fontSize.meta, fontFamily: fonts.ui, ...noOutline }}
      />
      {kbd && !value ? <Kbd label={kbd} /> : null}
    </View>
  );
}

/** Framed 44 px search for dialogs and panels. */
export function SearchBox({ value, onChangeText, placeholder, accessibilityLabel, onSubmitEditing, style }: SearchProps) {
  const { colors } = useTheme();
  const f = useFocus();
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          height: 44,
          paddingHorizontal: 12,
          borderWidth: 1,
          borderColor: f.focused ? colors.accent : colors.line,
          borderRadius: radius.menu,
          backgroundColor: colors.bg,
          ...webTransition,
          ...ring(colors, f.focused),
        },
        style,
      ]}
    >
      <Icon name="search" size={16} color={f.focused ? colors.accent : colors.pickerSecondary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor={colors.pickerSecondary}
        selectionColor={colors.accent}
        cursorColor={colors.accent}
        autoCapitalize="none"
        autoCorrect={false}
        onFocus={f.onFocus}
        onBlur={f.onBlur}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        returnKeyType="search"
        style={{ flex: 1, minWidth: 0, height: 42, padding: 0, color: colors.text, fontSize: isTouch ? 16 : fontSize.body, fontFamily: fonts.ui, ...noOutline }}
      />
    </View>
  );
}
