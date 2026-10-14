// Prime Agent Studio line icons (56) ported from the style kit, plus Prime Fleet additions.
// 24 x 24 viewBox, no fill, stroke 1.5, round caps and joins.
import { memo } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from './theme-context';

const PATHS = {
  "plus": "M12 5v14M5 12h14",
  "bell": "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4",
  "search": "m21 21-4.4-4.4M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0",
  "folder": "M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z",
  "folder-plus": "M3 7V5h6l2 2h10v13H3V7Zm9 3v7m-3-3.5h6",
  "branch": "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9a9 9 0 0 1-9 9",
  "archive": "M4 8h16v12H4V8ZM3 3h18v5H3V3Zm7 9h4",
  "settings": "m10 3-.5 2-2 .9-1.8-.6-2 3.4L5.2 10v2l-1.5 1.3 2 3.4 1.8-.6 2 .9.5 2h4l.5-2 2-.9 1.8.6 2-3.4-1.5-1.3v-2l1.5-1.3-2-3.4-1.8.6-2-.9L14 3h-4ZM15 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  "menu": "M4 6h16M4 12h16M4 18h16",
  "more": "M5 12h.01M12 12h.01M19 12h.01",
  "grip": "M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01",
  "panel": "M3 4h18v16H3V4Zm12 0v16",
  "layout": "M3 4h18v16H3V4Zm11 0v16m0-8h7",
  "map": "M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15",
  "compass": "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM16 8l-2 6-6 2 2-6 6-2Z",
  "code": "m8 6-6 6 6 6m8-12 6 6-6 6M14 4l-4 16",
  "bug": "M8 7V5a4 4 0 0 1 8 0v2M6 7h12v8a6 6 0 0 1-12 0V7Zm6 0v14M2 9h4m12 0h4M2 15h4m12 0h4M4 21l3-3m10 0 3 3",
  "sparkles": "m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Zm8-1v4m-2-2h4",
  "arrow-up-right": "M6 18 18 6M6 6h12v12",
  "arrow-up": "M12 19V5m-6 6 6-6 6 6",
  "arrow-down": "M12 5v14m-6-6 6 6 6-6",
  "model": "m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
  "stop": "M6 6h12v12H6V6",
  "shield": "M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4Zm-4 9 3 3 5-6",
  "copy": "M9 9h12v12H9V9ZM5 15H3V3h12v2",
  "download": "M12 3v12m-5-5 5 5 5-5M3 16v5h18v-5",
  "upload": "M12 21V9m-5 5 5-5 5 5M3 16v5h18v-5",
  "terminal": "m4 5 6 6-6 6m8 0h8",
  "pencil": "m16 3 5 5L8 21H3v-5L16 3Zm-2 2 5 5",
  "pin": "m9 3 12 12-3 3-5-2-4 4-5-5 4-4-2-5 3-3Zm-3 15-4 4",
  "star": "m12 2.8 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.5 6.3-.9L12 2.8Z",
  "x": "m6 6 12 12M6 18 18 6",
  "moon": "M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z",
  "sun": "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 1v2m0 18v2M1 12h2m18 0h2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  "monitor": "M2 3h20v14H2V3Zm10 14v4m-5 0h10",
  "chat": "M21 4H3v13h5l4 4 4-4h5V4Z",
  "chevron": "m9 5 7 7-7 7",
  "check": "m5 12 4 4L19 6",
  "refresh": "M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-2L20 8M4 16l2.3 3A7 7 0 0 0 17.9 17",
  "alert": "m12 3 10 18H2L12 3Zm0 5v6m0 3v.01",
  "user": "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-3a8 5 0 0 1 16 0v3",
  "brain": "M12 4C8 0 4 4 5 7c-5 1-4 7-1 8-1 5 5 8 8 4 3 4 9 1 8-4 3-1 4-7-1-8 1-3-3-7-7-3Zm0 0v15",
  "tool": "M21 3a6 6 0 0 1-8 8L5 21l-3-3 9-9a6 6 0 0 1 8-8l-4 4 3 3 3-5Z",
  "conversation": "M21 4H3v13h5l4 4 4-4h5V4Z",
  "roadmap": "M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15",
  "session": "M5 3h10l4 4v14H5V3Zm10 0v5h4M8 12h8M8 16h6",
  "agents": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  "files": "M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z",
  "preferences": "m10 3-.5 2-2 .9-1.8-.6-2 3.4L5.2 10v2l-1.5 1.3 2 3.4 1.8-.6 2 .9.5 2h4l.5-2 2-.9 1.8.6 2-3.4-1.5-1.3v-2l1.5-1.3-2-3.4-1.8.6-2-.9L14 3h-4ZM15 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  "lock": "M7 10.5h10a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5.5a2 2 0 0 1 2-2ZM8 10.5V7a4 4 0 0 1 8 0v3.5",
  "unlock": "M7 10.5h10a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5.5a2 2 0 0 1 2-2ZM8 10.5V7a4 4 0 0 1 7.8-1.3",
  "machine": "M3 4h18v12H3V4Zm9 12v4m-5 0h10",
  "scan": "M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M7 12h10",
  "trash": "M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3",
  "image": "M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3ZM9.5 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M3 17l6-6 4 4 3-3 5 5",
  "paperclip": "m21 11-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.9-2.9L15 6.5",
  // Added for Prime Fleet, same style (24 px grid, 1.5 stroke, no fill).
  "pipeline": "M3 9h6v6H3V9Zm12-6h6v6h-6V3Zm0 12h6v6h-6v-6ZM9 12h3m0-6v12m0-12h3m-3 12h3", // nodes linked, a pipeline
  "sync": "M4 12a8 8 0 0 1 13.7-5.7M18 3v4h-4M20 12a8 8 0 0 1-13.7 5.7M6 21v-4h4", // sync two copies
  "play": "M7 4v16l13-8L7 4Z", // start a run
  "link": "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7", // dependency
  "unlink": "M18.8 13.5l1.7-1.7a4.5 4.5 0 0 0-6.4-6.4l-1.7 1.7M5.2 10.5l-1.7 1.7a4.5 4.5 0 0 0 6.4 6.4l1.7-1.7M8 3v2M3 8h2M16 21v-2M21 16h-2", // remove a dependency
  "zoom-in": "m21 21-4.4-4.4M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0M10.5 7v7M7 10.5h7", // zoom in
  "zoom-out": "m21 21-4.4-4.4M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0M7 10.5h7", // zoom out
  "fit": "M4 9V4h5m6 0h5v5m0 6v5h-5M9 20H4v-5M9 9h6v6H9V9Z", // fit to view
  "question": "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5v.2M12 17v.01", // agent question
  "export": "M12 14V3m-4 4 4-4 4 4M7 9H4v12h16V9h-3", // export a file
  "import": "M12 3v11m-4-4 4 4 4-4M7 9H4v12h16V9h-3", // import a file
  "wifi-off": "M2 8.8a15 15 0 0 1 4-2.6M22 8.8a15 15 0 0 0-8-3.7M5 12.9a10 10 0 0 1 3-2M19 12.9a10 10 0 0 0-4.5-2.5M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M3 3l18 18", // offline
} as const;

export type IconName = keyof typeof PATHS;
export const iconNames = Object.keys(PATHS) as IconName[];

type IconProps = {
  name: IconName;
  size?: number;
  /** Stroke color. Defaults to the muted text token. */
  color?: string;
  /** Fill color, only for folders that carry a project color. */
  fill?: string;
  style?: StyleProp<ViewStyle>;
};

function IconBase({ name, size = 16, color, fill, style }: IconProps) {
  const { colors } = useTheme();
  const stroke = color ?? colors.muted;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      {...(Platform.OS === 'web' ? {} : { accessible: false, importantForAccessibility: 'no-hide-descendants' as const })}
      style={style}
    >
      <Path
        d={PATHS[name]}
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={fill ?? 'none'}
      />
    </Svg>
  );
}

export const Icon = memo(IconBase);
