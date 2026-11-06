import { View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { AppBar } from '../../ui/AppBar';
import { Screen } from '../../ui/Screen';
import { Skeleton } from '../../ui/Skeleton';

/** A money form's loading shape (specs § 3.2): two fields, then a list of rows, under the screen's app bar. */
export function FormLoading({ title }: { title: string }) {
  const { space, type } = useTheme();
  return (
    <Screen header={<AppBar title={title} />}>
      <View style={{ gap: space.s4, paddingTop: space.s1 }}>
        <Skeleton width="30%" />
        <Skeleton width="100%" height={type.heroFigure.lineHeight} />
        <Skeleton width="30%" />
        <Skeleton rows={3} />
      </View>
    </Screen>
  );
}
