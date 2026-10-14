// Light rendering of agent text: paragraphs, headings, lists and code blocks (no HTML).
import { View } from 'react-native';

import { Txt } from '@/ui/components';
import { fonts } from '@/ui/theme';
import { useTheme } from '@/ui/theme-context';

export function Prose({ text }: { text: string }) {
  const { colors } = useTheme();
  const parts = text.split(/```/);
  return (
    <View style={{ gap: 10 }}>
      {parts.map((part, index) => {
        if (index % 2 === 1) {
          const body = part.replace(/^[\w+-]*\n/, '');
          return (
            <View key={index} style={{ backgroundColor: colors.code, borderWidth: 1, borderColor: colors.line, borderRadius: 9, padding: 12 }}>
              <Txt selectable style={{ fontFamily: fonts.mono, fontSize: 11, lineHeight: 18.7, color: colors.text }}>
                {body.replace(/\n$/, '')}
              </Txt>
            </View>
          );
        }
        return part
          .split(/\n{2,}/)
          .map((block) => block.trim())
          .filter(Boolean)
          .map((block, blockIndex) => {
            const heading = /^(#{1,6})\s+(.*)$/.exec(block);
            if (heading)
              return (
                <Txt key={`${index}-${blockIndex}`} variant={heading[1].length <= 2 ? 'panel' : 'heading'} selectable>
                  {heading[2]}
                </Txt>
              );
            return (
              <Txt key={`${index}-${blockIndex}`} variant="body" selectable>
                {block.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')}
              </Txt>
            );
          });
      })}
    </View>
  );
}
