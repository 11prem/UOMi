import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { CURRENCY_INFO } from '../../domain/money';
import { CURRENCIES, SPACE_ICONS, type Currency, type SpaceIcon } from '../../domain/types';
import { qk } from '../../services/queries';
import { useServices } from '../../services/useServices';
import { useTheme } from '../../theme/ThemeProvider';
import { lift } from '../../theme/tokens';
import { Fab } from '../../ui/Fab';
import { Field } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/IconButton';
import { size } from '../../ui/metrics';
import { Press } from '../../ui/Press';
import { Sheet } from '../../ui/Sheet';
import { TextField } from '../../ui/TextField';
import { useSpaceDraft, validSpaceName } from './draft';

const ICON_NAME: Record<SpaceIcon, string> = {
  home: 'Home', trip: 'Trip', food: 'Food', office: 'Office', friends: 'Friends', car: 'Car', party: 'Party', other: 'Other',
};

const currencyLabel = (c: Currency) => `${CURRENCY_INFO[c].symbol} ${CURRENCY_INFO[c].name}`;

/**
 * Create Space step 1 (specs § 6.1; app.js `createSpacePopup`): name (1–30), 8 icons with the first pre-selected, the
 * currency (the user's default until picked). It edits the draft store directly, so Back from Add People finds it as it was.
 * The scrim, ✕ and Android Back call `onClose`; → calls `onNext` once the name is valid.
 */
export function SpaceNamePopup({ visible, onClose, onNext }: { visible: boolean; onClose: () => void; onNext: () => void }) {
  const { colors, type, space, radius, scheme } = useTheme();
  const services = useServices();
  const draft = useSpaceDraft();
  const [touched, setTouched] = useState(false);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setTouched(false); // a fresh opening starts without the last one's error or open list
    setPicking(false);
  }, [visible]);
  // Server mode can reject with `network`: the pop-up still opens, on INR.
  const prefs = useQuery({ queryKey: qk.preferences, queryFn: () => services.profile.getPreferences() });
  const currency = draft.currency ?? prefs.data?.defaultCurrency ?? 'INR';
  const valid = validSpaceName(draft.name);

  const next = () => {
    if (!valid) return setTouched(true);
    useSpaceDraft.setState({ step: 'people', name: draft.name.trim(), currency }); // hides the pop-up before Home is covered
    onNext();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.scrim }}>
        <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onPress={onClose} accessible={false} />
        <View accessibilityViewIsModal style={{ marginHorizontal: space.s4, maxHeight: '90%', borderRadius: radius.sheet, boxShadow: lift[scheme].lift3 }}>
          <Sheet perf style={{ flexShrink: 1 }}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.s4, gap: space.s3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginRight: -space.s2 }}>
                <Text style={[type.title, { color: colors.ink }]} accessibilityRole="header">
                  New space
                </Text>
                <IconButton icon="x" label="Close" onPress={onClose} />
              </View>

              <TextField
                label="Space name"
                required
                value={draft.name}
                onChangeText={(name) => useSpaceDraft.setState({ name })}
                onBlur={() => setTouched(true)}
                onSubmitEditing={next}
                returnKeyType="next"
                maxLength={30}
                placeholder="e.g. Flat 4B"
                autoFocus
                error={touched && !valid ? 'Give the space a name' : undefined}
              />

              <View accessibilityRole="radiogroup" accessibilityLabel="Space icon" style={{ gap: space.s2 - 2 }}>
                <Text style={[type.label, { color: colors.ink }]}>Icon</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 }}>
                  {SPACE_ICONS.map((k) => {
                    const on = k === draft.icon;
                    return (
                      <Press
                        key={k}
                        accessibilityRole="radio"
                        accessibilityLabel={ICON_NAME[k]}
                        accessibilityState={{ checked: on }}
                        onPress={() => useSpaceDraft.setState({ icon: k })}
                        scaleTo={0.95}
                        style={{
                          flexBasis: '20%', // four to a row (app.css `.icon-pick`); the gaps take the rest
                          flexGrow: 1,
                          height: size.control,
                          borderRadius: radius.sheet,
                          borderWidth: size.hairline,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: on ? colors.carbon : colors.sheet,
                          borderColor: on ? colors.carbon : colors.hair,
                        }}
                      >
                        <Icon name={k} color={on ? colors.onCarbon : colors.ink2} />
                      </Press>
                    );
                  })}
                </View>
              </View>

              <Field label="Currency" helper="Every amount in this space uses it. It can’t change after the first expense.">
                <Press
                  accessibilityLabel={`Currency, ${CURRENCY_INFO[currency].name}`}
                  accessibilityState={{ expanded: picking }}
                  onPress={() => setPicking((p) => !p)}
                  scaleTo={1}
                  style={{
                    minHeight: size.control,
                    borderRadius: radius.sheet,
                    borderWidth: size.hairline,
                    borderColor: picking ? colors.carbon : colors.controlEdge,
                    backgroundColor: colors.sheet,
                    paddingHorizontal: space.s3 + 2,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text style={[type.body, { color: colors.ink }]}>{currencyLabel(currency)}</Text>
                  <View style={{ transform: [{ rotate: picking ? '-90deg' : '90deg' }] }}>
                    <Icon name="chev" size="sm" color={colors.ink2} />
                  </View>
                </Press>
                {picking && (
                  <View accessibilityRole="radiogroup" accessibilityLabel="Currency" style={{ borderWidth: size.hairline, borderColor: colors.hair, borderRadius: radius.sheet }}>
                    {CURRENCIES.map((c, i) => (
                      <Press
                        key={c}
                        accessibilityRole="radio"
                        accessibilityLabel={CURRENCY_INFO[c].name}
                        accessibilityState={{ checked: c === currency }}
                        onPress={() => {
                          useSpaceDraft.setState({ currency: c });
                          setPicking(false);
                        }}
                        scaleTo={1}
                        style={[
                          { minHeight: size.target, paddingHorizontal: space.s3, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
                          i > 0 && { borderTopWidth: size.hairline, borderTopColor: colors.hair },
                        ]}
                        pressedStyle={{ backgroundColor: colors.carbonWash }}
                      >
                        <Text style={[type.body, { color: colors.ink }]}>{currencyLabel(c)}</Text>
                        {c === currency && <Icon name="check" size="sm" color={colors.carbon} />}
                      </Press>
                    ))}
                  </View>
                )}
              </Field>

              <View style={{ alignItems: 'flex-end' }}>
                <Fab icon="chev" label="Next: add people" onPress={next} disabled={!valid} />
              </View>
            </ScrollView>
          </Sheet>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
