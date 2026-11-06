import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { COUNTRIES, type Country } from '../../domain/phone';
import { useTheme } from '../../theme/ThemeProvider';
import { BottomSheet } from '../../ui/BottomSheet';
import { Icon } from '../../ui/Icon';
import { LedgerRow, Rows } from '../../ui/Rows';
import { TextField } from '../../ui/TextField';

type Props = { visible: boolean; selected: string; onPick: (country: Country) => void; onClose: () => void };

/** The searchable country list behind the dial-code button on Create Account (specs § 4.2; prototype `countrySheet`). */
export function CountrySheet({ visible, selected, onPick, onClose }: Props) {
  const { colors, type } = useTheme();
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  const q = query.trim().toLowerCase().replace(/^\+/, '');
  const shown = COUNTRIES.filter((c) => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q || c.dial.slice(1).startsWith(q));

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Country">
      <TextField label="Search countries" value={query} onChangeText={setQuery} autoComplete="off" autoCorrect={false} />
      {shown.length ? (
        <Rows nested>
          {shown.map((c) => (
            <LedgerRow
              key={c.code}
              title={c.name}
              amount={c.dial}
              tone="muted"
              right={c.code === selected ? <Icon name="check" size="sm" color={colors.carbon} /> : undefined}
              accessibilityLabel={`${c.name} ${c.dial}`}
              onPress={() => {
                onPick(c);
                onClose();
              }}
            />
          ))}
        </Rows>
      ) : (
        <Text style={[type.body, { color: colors.ink2 }]}>No country matches “{query.trim()}”</Text>
      )}
    </BottomSheet>
  );
}
