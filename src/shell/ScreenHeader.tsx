// Header of a screen: breadcrumb at the left, actions at the right, menu button on phones.
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useT } from '@/i18n';
import type { IconName } from '@/ui/icons';
import { Breadcrumb, Header, IconButton } from '@/ui/components';
import { useTheme } from '@/ui/theme-context';
import { useShell } from './context';

export function ScreenHeader({
  crumbs,
  icon,
  iconColor,
  actions,
  phoneActions,
}: {
  crumbs: string[];
  icon?: IconName;
  iconColor?: string;
  actions?: ReactNode;
  /** Smaller actions for phones (icon buttons), shown on the same row. Defaults to actions. */
  phoneActions?: ReactNode;
}) {
  const t = useT();
  const shell = useShell();
  const { colors } = useTheme();
  if (shell.phone)
    return (
      <View style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft, backgroundColor: colors.bg }}>
        <IconButton icon="menu" size="md" accessibilityLabel={t('nav.menu')} onPress={shell.openMenu} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Breadcrumb items={crumbs.slice(-2)} icon={icon} iconColor={iconColor} />
        </View>
        {phoneActions ?? actions ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>{phoneActions ?? actions}</View> : null}
      </View>
    );
  return <Header left={<Breadcrumb items={crumbs} icon={icon} iconColor={iconColor} />} actions={actions} />;
}
