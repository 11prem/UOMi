import { useState } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { SPACE_ICONS, type Space, type SpaceIcon } from '../../domain/types';
import { useServices } from '../../services/useServices';
import { useTheme } from '../../theme/ThemeProvider';
import { BottomSheet } from '../../ui/BottomSheet';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { size } from '../../ui/metrics';
import { Press } from '../../ui/Press';
import { TextField } from '../../ui/TextField';
import { toast } from '../../ui/Toast';
import { errorText, refreshMoney } from '../expense/refresh';

const ICON_NAME: Record<SpaceIcon, string> = {
  home: 'Home', trip: 'Trip', food: 'Food', office: 'Office', friends: 'Friends', car: 'Car', party: 'Party', other: 'Other',
};

/**
 * "Edit space" (specs § 10 → § 6.1 rules; app.js `editSpacePopup`): the name (1–30 after trimming) and the icon. Any
 * member may change them. Mount it with a new `key` per opening so it starts from the space as it is.
 */
export function EditSpaceSheet({ visible, space: s, onClose }: { visible: boolean; space: Space; onClose: () => void }) {
  const { colors, type, space, radius } = useTheme();
  const services = useServices();
  const queryClient = useQueryClient();
  const [name, setName] = useState(s.name);
  const [icon, setIcon] = useState(s.icon);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const valid = name.trim().length >= 1 && name.trim().length <= 30;

  async function save() {
    if (!valid) return setTouched(true);
    setSaving(true);
    try {
      await services.spaces.update(s.id, { name: name.trim(), icon });
    } catch (e) {
      setSaving(false);
      return toast(errorText(e));
    }
    void refreshMoney(queryClient);
    toast('Space updated');
    onClose();
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Edit space">
      <View style={{ gap: space.s3 }}>
        <TextField
          label="Space name"
          required
          value={name}
          onChangeText={setName}
          onBlur={() => setTouched(true)}
          maxLength={30}
          error={touched && !valid ? 'Give the space a name' : undefined}
        />
        <View accessibilityRole="radiogroup" accessibilityLabel="Space icon" style={{ gap: space.s2 - 2 }}>
          <Text style={[type.label, { color: colors.ink }]}>Icon</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 }}>
            {SPACE_ICONS.map((k) => {
              const on = k === icon;
              return (
                <Press
                  key={k}
                  accessibilityRole="radio"
                  accessibilityLabel={ICON_NAME[k]}
                  accessibilityState={{ checked: on }}
                  onPress={() => setIcon(k)}
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
        <Button label="Save" onPress={save} busy={saving} style={{ marginTop: space.s2 }} />
      </View>
    </BottomSheet>
  );
}
