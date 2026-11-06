import { Text, View } from 'react-native';
import { useTheme } from '../src/theme/ThemeProvider';

// Placeholder until Task 10 builds the real navigation.
export default function Index() {
  const { colors, type } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ground }}>
      <Text style={[type.wordmark, { color: colors.carbon }]}>UOMi</Text>
    </View>
  );
}
