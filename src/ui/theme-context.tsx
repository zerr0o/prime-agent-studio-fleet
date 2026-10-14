import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { themes, type Colors, type ThemeName } from './theme';

export type ThemePreference = ThemeName | 'system';

type ThemeValue = { name: ThemeName; colors: Colors };

const ThemeContext = createContext<ThemeValue>({ name: 'dark', colors: themes.dark });

/** Dark first, like Studio. "system" follows the device setting. */
export function ThemeProvider({ preference = 'dark', children }: { preference?: ThemePreference; children: ReactNode }) {
  const scheme = useColorScheme();
  const name: ThemeName = preference === 'system' ? (scheme === 'light' ? 'light' : 'dark') : preference;
  const value = useMemo(() => ({ name, colors: themes[name] }), [name]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
