import { useEffect, useState } from 'react';
import { AccessibilityInfo, AppState, StyleSheet, type ViewProps } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';

const NativeBackground = requireNativeViewManager<ViewProps & { motionEnabled: boolean }>('BiliPopBackground');

export function RefractBackground({ paused = false }: { paused?: boolean }) {
  const [reduceMotion, setReduceMotion] = useState(true);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    let mounted = true;
    let preferenceChanged = false;
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      preferenceChanged = true;
      if (mounted) setReduceMotion(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted && !preferenceChanged) setReduceMotion(value); }).catch(() => {
      // Prefer a still background when the platform cannot report this preference.
    });
    const state = AppState.addEventListener('change', (value) => setActive(value === 'active'));
    return () => { mounted = false; motion.remove(); state.remove(); };
  }, []);
  return <NativeBackground pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill}
    motionEnabled={active && !reduceMotion && !paused} />;
}
