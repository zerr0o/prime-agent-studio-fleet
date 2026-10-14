// Prime Agent Studio tokens (Studio 4.3), ported from the prime-agent-studio-style kit.
// Use these values only. Never add a new gray or purple.
import { Platform } from 'react-native';

export type ThemeName = 'dark' | 'light';

export type Colors = {
  sidebar: string;
  bg: string;
  surface: string;
  surfaceRaised: string;
  surfaceHover: string;
  code: string;
  line: string;
  lineSoft: string;
  text: string;
  muted: string;
  faint: string;
  pickerSecondary: string;
  accent: string;
  accentStrong: string;
  accentBg: string;
  accentText: string;
  accentInk: string;
  green: string;
  blue: string;
  amber: string;
  red: string;
  backdrop: string;
  dialogLine: string;
  tintedLine: string;
  composerLine: string;
  composerLineFocus: string;
  shadow: string;
};

const dark: Colors = {
  sidebar: '#151618',
  bg: '#1b1c1e',
  surface: '#222326',
  surfaceRaised: '#26272b',
  surfaceHover: '#2b2c30',
  code: '#161719',
  line: '#303135',
  lineSoft: '#28292d',
  text: '#ededea',
  muted: '#96979d',
  faint: '#777983',
  pickerSecondary: '#9a9ba1',
  accent: '#b7b2e7',
  accentStrong: '#cbc7f3',
  accentBg: '#302e40',
  accentText: '#d4d0f4',
  accentInk: '#252132',
  green: '#96bca5',
  blue: '#88b6f6',
  amber: '#dab982',
  red: '#e8a2a2',
  backdrop: '#00000088',
  dialogLine: '#77717f66',
  tintedLine: '#79738e45',
  composerLine: '#414047',
  composerLineFocus: '#8f88a9',
  shadow: '#00000055',
};

const light: Colors = {
  sidebar: '#f1f0ec',
  bg: '#faf9f6',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  surfaceHover: '#eae9e5',
  code: '#f0f0ed',
  line: '#deded8',
  lineSoft: '#e9e8e2',
  text: '#28282e',
  muted: '#6e707b',
  faint: '#797b84',
  pickerSecondary: '#656771',
  accent: '#7771b2',
  accentStrong: '#635b9f',
  accentBg: '#eae7f6',
  accentText: '#5f568f',
  accentInk: '#252132',
  green: '#4f8568',
  blue: '#286ac4',
  amber: '#947036',
  red: '#ae4f50',
  backdrop: '#00000088',
  dialogLine: '#77717f66',
  tintedLine: '#79738e45',
  composerLine: '#414047',
  composerLineFocus: '#8f88a9',
  shadow: '#1c1c2820',
};

export const palettes = {
  // Identity only, never state. First entry of each Studio palette is "default" (transparent).
  project: ['#3b82f6', '#16a34a', '#d97706', '#dc2626', '#8b5cf6'],
  plan: ['#0d9488', '#db2777', '#4f46e5', '#65a30d', '#ea580c'],
  // Machine colors, assigned in this order: cyan, yellow, fuchsia, slate, brown.
  device: ['#0891b2', '#ca8a04', '#c026d3', '#64748b', '#92400e'],
} as const;

export const themes: Record<ThemeName, Colors> = { dark, light };

export const fonts = {
  ui: Platform.select({
    web: "'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif",
    default: undefined, // system font on Android and iOS
  }),
  mono: Platform.select({
    web: "'Cascadia Code', 'SFMono-Regular', Consolas, monospace",
    android: 'monospace',
    ios: 'Menlo',
    default: 'monospace',
  }),
};

// Type scale in px (Studio root is 14 px; 12 px is the workhorse).
export const fontSize = {
  micro: 9,
  caption: 10,
  meta: 11,
  ui: 12,
  body: 13,
  heading: 14,
  panel: 15,
  title: 19,
  section: 20,
  stat: 23,
  brand: 26,
} as const;

// Weights used by Studio: 400, 500, 550, 600, 650 (700 only for card titles).
export const weight = {
  regular: '400',
  medium: '500',
  semi: '550',
  bold: '600',
  heavy: '650',
  card: '700',
} as const;

export const radius = {
  xs: 4,
  sm: 6,
  control: 7,
  pillButton: 8,
  menu: 9,
  md: 10,
  card: 12,
  composer: 13,
  dialog: 15,
  full: 999,
} as const;

export const layout = {
  sidebarWidth: 272,
  sidebarNarrow: 245,
  sidebarWide: 286,
  detailWidth: 276,
  headerHeight: 67,
  tabbarHeight: 35,
  rowHeight: 38,
  touchTarget: 44,
  // Breakpoints (width in px)
  mobile: 760,
  compactShell: 1080,
  narrow: 1250,
  wide: 1600,
} as const;

export const motion = { fast: 150, toast: 200, pulse: 1700 } as const;
