import { Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';

export type StateBoxProps = {
  kind: 'empty' | 'error';
  /** Error defaults to the prototype's "Couldn’t load this". */
  title?: string;
  body?: string;
  /** Error: shows the Retry button. */
  onRetry?: () => void;
  /** The action that fixes an empty state ("Clear filters"). */
  action?: { label: string; onPress: () => void };
  /** Defaults to `alert` for errors, none for empty. */
  icon?: IconName;
};

const ERROR_TITLE = 'Couldn’t load this';
const ERROR_BODY = 'The connection dropped while loading. Your data is safe.';

/** The empty and error panels of every data screen (specs § 3.2; app.css `.state-box`). Keep data already on screen above it. */
export function StateBox({ kind, title, body, onRetry, action, icon }: StateBoxProps) {
  const { colors, type, space } = useTheme();
  const error = kind === 'error';
  const glyph = icon ?? (error ? 'alert' : undefined);
  const text = body ?? (error ? ERROR_BODY : undefined);
  return (
    <View
      accessibilityLiveRegion={error ? 'polite' : undefined}
      style={{ alignItems: 'center', paddingVertical: space.s10 + space.s2, paddingHorizontal: space.s6, gap: space.s2 + 2 }}
    >
      {glyph && <Icon name={glyph} size="lg" color={colors.carbon} />}
      <Text style={[type.title, { color: colors.ink, textAlign: 'center' }]} accessibilityRole="header">
        {title ?? (error ? ERROR_TITLE : '')}
      </Text>
      {!!text && <Text style={[type.body, { color: colors.ink2, textAlign: 'center' }]}>{text}</Text>}
      {error && onRetry && <Button variant="secondary" block={false} icon="refresh" label="Retry" onPress={onRetry} style={{ marginTop: space.s2 }} />}
      {action && <Button variant="secondary" block={false} label={action.label} onPress={action.onPress} style={{ marginTop: space.s2 }} />}
    </View>
  );
}
