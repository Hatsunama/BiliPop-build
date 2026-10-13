import { useCallback, useEffect, useRef } from 'react';
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
  const scroll = useRef<ScrollView>(null);
  const viewportWidth = useRef(0);
  const contentWidth = useRef(0);
  const optionLayouts = useRef<Partial<Record<LanguageCode, { x: number; width: number }>>>({});
  const lastReveal = useRef('');
  const revealSelected = useCallback(() => {
    const option = optionLayouts.current[value];
    const viewport = viewportWidth.current;
    const content = contentWidth.current;
    // Native layout events can arrive in any order. Wait until the selected
    // pill and scroll range exist rather than scrolling against an empty strip.
    // Native positions and widths can round separately at the final edge.
    // Allow one layout unit of rounding, but clamp to the actual content below.
    if (!scroll.current || !option || viewport <= 0 || content + 1 < option.x + option.width || option.width <= 0) return;
    const geometry = `${value}:${viewport}:${content}:${option.x}:${option.width}`;
    if (lastReveal.current === geometry) return;
    const x = Math.max(0, Math.min(content - viewport, option.x + option.width / 2 - viewport / 2));
    scroll.current.scrollTo({ x, animated: false });
    lastReveal.current = geometry;
  }, [value]);
  useEffect(revealSelected, [revealSelected]);

  const label = kind === 'source' ? 'Input language' : 'Output language';
  return (
    <View testID={`${kind}-language-selector`} style={styles.group}>
      <Text style={styles.label}>{label.toUpperCase()} · {languageName(value)}</Text>
      <ScrollView ref={scroll} horizontal nestedScrollEnabled showsHorizontalScrollIndicator
        accessibilityLabel={`${label} options`} contentContainerStyle={styles.options}
        onLayout={({ nativeEvent: { layout } }) => { viewportWidth.current = layout.width; revealSelected(); }}
        onContentSizeChange={(width) => { contentWidth.current = width; revealSelected(); }}>
        {LANGUAGE_OPTIONS.map((language) => {
          const selected = value === language.code;
          return <Pressable key={language.code} testID={`${kind}-language-${language.code}`}
            onLayout={({ nativeEvent: { layout } }) => {
              optionLayouts.current[language.code] = { x: layout.x, width: layout.width };
              revealSelected();
            }}
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
