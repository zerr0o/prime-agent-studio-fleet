import type { ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';

import { Icon, type IconName } from '../icons';
import { useLayoutMode } from '../layout';
import { radius } from '../theme';
import { useTheme } from '../theme-context';
import { IconButton } from './Buttons';
import { Txt } from './Txt';

export type DialogProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** Icon of the 36 px accent tile in the head. */
  icon?: IconName;
  children?: ReactNode;
  /** Buttons, right aligned: secondary first, then the one primary. Use <ButtonRow align="end">. */
  actions?: ReactNode;
  /** Accessible name of the close button. When omitted there is no close button. */
  closeLabel?: string;
  width?: number;
  /** Clicking the backdrop closes the dialog (default true). */
  dismissOnBackdrop?: boolean;
};

/** Modal dialog: backdrop, 460 px, radius 15, padding 28. Escape (web) and back (Android) close it. */
export function Dialog({ visible, onClose, title, description, icon, children, actions, closeLabel, width = 460, dismissOnBackdrop = true }: DialogProps) {
  const { colors } = useTheme();
  const mode = useLayoutMode();
  const { height } = useWindowDimensions();
  const pad = mode === 'phone' ? 22 : 28;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <Pressable
          accessible={false}
          onPress={dismissOnBackdrop ? onClose : undefined}
          style={[
            { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.backdrop },
            Platform.OS === 'web' ? ({ backdropFilter: 'blur(4px)' } as object) : null,
          ]}
        />
        <View
          accessibilityViewIsModal
          accessibilityLabel={title}
          style={{
            width: '100%',
            maxWidth: width,
            maxHeight: height - 32,
            backgroundColor: colors.surfaceRaised,
            borderWidth: 1,
            borderColor: colors.dialogLine,
            borderRadius: radius.dialog,
            boxShadow: [{ offsetX: 0, offsetY: 20, blurRadius: 70, color: colors.shadow }],
            elevation: 24,
            overflow: 'hidden',
          }}
        >
          <ScrollView contentContainerStyle={{ padding: pad }} keyboardShouldPersistTaps="handled" bounces={false}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: children ? 18 : 6 }}>
              {icon ? (
                <View style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.accentBg }}>
                  <Icon name={icon} size={19} color={colors.accent} />
                </View>
              ) : null}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt variant="title" accessibilityRole="header" style={{ marginBottom: description ? 4 : 0 }}>
                  {title}
                </Txt>
                {description ? (
                  <Txt variant="meta" tone="muted" style={{ lineHeight: 17.6 }}>
                    {description}
                  </Txt>
                ) : null}
              </View>
              {closeLabel ? <IconButton icon="x" size="md" accessibilityLabel={closeLabel} onPress={onClose} /> : null}
            </View>
            {children}
            {actions ? <View style={{ marginTop: 15 }}>{actions}</View> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
