// App shell: sidebar on tablets and desktops, drawer on phones (Studio layout).
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLayoutMode } from '@/ui/layout';
import { layout } from '@/ui/theme';
import { useTheme } from '@/ui/theme-context';
import { ShellContext } from './context';
import { Sidebar } from './Sidebar';

export function Shell({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const mode = useLayoutMode();
  const { width } = useWindowDimensions();
  const [menu, setMenu] = useState(false);
  const phone = mode === 'phone';
  const sidebarWidth = width >= layout.wide ? layout.sidebarWide : width < layout.narrow ? layout.sidebarNarrow : layout.sidebarWidth;
  const value = { openMenu: () => setMenu(true), closeMenu: () => setMenu(false), phone };
  return (
    <ShellContext.Provider value={value}>
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.bg }}>
        {!phone ? (
          <View style={{ width: sidebarWidth, borderRightWidth: 1, borderRightColor: colors.lineSoft }}>
            <Sidebar />
          </View>
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
      </View>
      {phone ? (
        <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)} statusBarTranslucent>
          <View style={{ flex: 1, flexDirection: 'row' }}>
            <SafeAreaView edges={['top', 'bottom', 'left']} style={{ width: Math.min(320, width * 0.86), backgroundColor: colors.sidebar, borderRightWidth: 1, borderRightColor: colors.lineSoft }}>
              <Sidebar onNavigate={() => setMenu(false)} />
            </SafeAreaView>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" style={{ flex: 1, backgroundColor: colors.backdrop }} onPress={() => setMenu(false)} />
          </View>
        </Modal>
      ) : null}
    </ShellContext.Provider>
  );
}
