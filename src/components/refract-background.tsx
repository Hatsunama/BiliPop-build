import { StyleSheet, View } from 'react-native';

// The canonical renderer is Android-native. Web preview is intentionally static.
export function RefractBackground({ paused: _paused = false }: { paused?: boolean }) {
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#0A0B0E' }]} />;
}
