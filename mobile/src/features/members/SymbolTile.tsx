import { Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { FONT_CAP, size } from '../../ui/metrics';

/** The currency row's tile (app.js `R.members`): the symbol in the 40 px space-icon tile. The kit's `SpaceIcon` takes icons only. */
export function SymbolTile({ symbol }: { symbol: string }) {
  const { colors, type, radius } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size.spaceIcon, height: size.spaceIcon, borderRadius: radius.sheet, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.carbonWash }}
    >
      <Text style={[type.body, { fontFamily: type.stamp.fontFamily /* Text Bold */, color: colors.carbon }]} maxFontSizeMultiplier={FONT_CAP} numberOfLines={1} adjustsFontSizeToFit>
        {symbol}
      </Text>
    </View>
  );
}
