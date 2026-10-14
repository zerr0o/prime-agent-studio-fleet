// Line glyphs (24 px grid, 1.5 px stroke) in the style of the Studio icon kit.
import Svg, { Path } from 'react-native-svg';

const PATHS = {
  machine: 'M3 4h18v12H3V4Zm9 12v4m-5 0h10',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  inbox: 'M4 13l2.5-7h11L20 13v6H4v-6Zm0 0h5l1 2h4l1-2h5',
} as const;

export type GlyphName = keyof typeof PATHS;

export function Glyph({ name, size = 14, color }: { name: GlyphName; size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d={PATHS[name]} stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
