import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useStore } from 'zustand';

import { Shell } from '@/shell/Shell';
import { appStore, bootApp } from '@/state/app';
import { ToastProvider } from '@/ui/components';
import { ThemeProvider, useTheme } from '@/ui/theme-context';

export default function RootLayout() {
  const theme = useStore(appStore, (state) => state.prefs.theme);
  useEffect(() => {
    void bootApp();
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider preference={theme}>
          <Root />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Root() {
  const { colors, name } = useTheme();
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.body.style.backgroundColor = colors.bg;
      document.documentElement.style.colorScheme = name;
      document.title = 'Prime Fleet';
    }
  }, [colors.bg, name]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style={name === 'dark' ? 'light' : 'dark'} />
      <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={{ flex: 1 }}>
        <ToastProvider>
          <Shell>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg },
                animation: Platform.OS === 'web' ? 'none' : 'fade',
              }}
            />
          </Shell>
        </ToastProvider>
      </SafeAreaView>
    </View>
  );
}
