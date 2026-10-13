import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LANGUAGE_OPTIONS, languageName, type LanguageCode } from '@/engine/languages';
import { colors, radii } from '@/theme';

type Props = {
  kind: 'source' | 'target';
  value: LanguageCode;
  disabled: boolean;
  onChange: (value: LanguageCode) => void;
};
const bodyFont = Platform.select({ android: 'sans-serif-medium', default: 'system-ui' });

/** Two independent, always-labeled horizontal scrollers fit a narrow portrait
 * screen and stay in the same reading order when the phone is turned sideways. */
export function LanguageSelector({ kind, value, disabled, onChange }: Props) {
  const label = kind === 'source' ? 'Input language' : 'Output language';
  return (
    <View testID={`${kind}-language-selector`} style={styles.group}>
      <Text style={styles.label}>{label.toUpperCase()} · {languageName(value)}</Text>
      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator
        accessibilityLabel={`${label} options`} contentContainerStyle={styles.options}>
        {LANGUAGE_OPTIONS.map((language) => {
          const selected = value === language.code;
          return <Pressable key={language.code} testID={`${kind}-language-${language.code}`}
            accessibilityRole="radio" accessibilityLabel={`${label}: ${language.name}`}
            accessibilityState={{ selected, disabled }} disabled={disabled}
            onPress={() => { if (!disabled) onChange(language.code); }}
            style={({ pressed }) => [styles.option, selected && styles.selected, disabled && styles.disabled, pressed && styles.pressed]}>
            <Text style={[styles.optionText, selected && styles.selectedText]}>{language.name}</Text>
          </Pressable>;
        })}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  group: { gap: 8, minWidth: 0, width: '100%' },
  label: { fontFamily: bodyFont, color: colors.ink, fontSize: 13, lineHeight: 20 },
  options: { gap: 8, paddingBottom: 6 },
  option: { backgroundColor: colors.cream, borderRadius: radii.pill, paddingVertical: 12, paddingHorizontal: 16,
    borderWidth: 1, borderColor: colors.inkSoft, minHeight: 44, justifyContent: 'center' },
  optionText: { fontFamily: bodyFont, color: colors.ink, fontSize: 14, lineHeight: 20 },
  selected: { backgroundColor: colors.bubbleDeep, borderColor: colors.bubbleDeep },
  selectedText: { color: colors.cream },
  disabled: { opacity: 0.65 },
  pressed: { opacity: 0.8 },
});
