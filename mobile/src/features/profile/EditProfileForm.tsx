import { useRef, useState } from 'react';
import { View, type TextInputInstance } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { prettyPhone } from '../../domain/phone';
import type { User } from '../../domain/types';
import { AppError } from '../../services/errors';
import { useServices } from '../../services/useServices';
import { useSession } from '../../state/session';
import { useTheme } from '../../theme/ThemeProvider';
import { AppBar } from '../../ui/AppBar';
import { BottomSheet } from '../../ui/BottomSheet';
import { Button } from '../../ui/Button';
import { Fab } from '../../ui/Fab';
import { MemberPlate } from '../../ui/MemberPlate';
import { OfflineBanner } from '../../ui/OfflineBanner';
import { LedgerRow, Rows } from '../../ui/Rows';
import { Screen } from '../../ui/Screen';
import { SpaceIcon } from '../../ui/SpaceIcon';
import { TextField } from '../../ui/TextField';
import { toast } from '../../ui/Toast';
import { useDiscardGuard } from '../../ui/useDiscardGuard';
import { pickPhoto } from './pickPhoto';
import { ReadOnlyField } from './ReadOnlyField';

const NAME_MAX = 50;

/**
 * Edit Profile (specs § 13.1; app.js `R.editProfile`): the photo (camera, gallery or remove) and the name. The username
 * is the recovery key and the phone would need its own code, so both are shown but locked. `user` is what is stored now.
 */
export function EditProfileForm({ user }: { user: User }) {
  const { space } = useTheme();
  const services = useServices();
  const queryClient = useQueryClient();
  const nameRef = useRef<TextInputInstance>(null);
  const [name, setName] = useState(user.name);
  const [avatar, setAvatar] = useState(user.avatarUrl);
  const [touched, setTouched] = useState(false);
  const [rejected, setRejected] = useState<string>();
  const [photoOpen, setPhotoOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirty = name !== user.name || avatar !== user.avatarUrl;
  const leave = useDiscardGuard(dirty);

  const clean = name.trim();
  const problem = !clean ? 'Enter your name' : undefined;
  const error = rejected ?? (touched ? problem : undefined);

  async function choose(source: 'camera' | 'gallery') {
    setPhotoOpen(false);
    try {
      const uri = await pickPhoto(source);
      if (uri) setAvatar(uri);
    } catch {
      toast(source === 'camera' ? 'Couldn’t open the camera' : 'Couldn’t open your photos');
    }
  }

  async function save() {
    if (saving) return;
    setTouched(true);
    if (problem) return void nameRef.current?.focus(); // the first (only) invalid field
    setSaving(true);
    try {
      const updated = await services.profile.update({ name: clean, ...(avatar !== user.avatarUrl && { avatarUrl: avatar }) });
      useSession.setState({ user: updated }); // in place: `signedIn` would clear the cache
      void queryClient.invalidateQueries(); // a new name or photo shows in every member list
      toast('Profile saved');
      leave(() => router.back());
    } catch (e) {
      if (e instanceof AppError && e.code === 'validation_error') setRejected(e.message);
      else toast(e instanceof Error ? e.message : 'Something went wrong. Your data is safe.');
      setSaving(false);
    }
  }

  return (
    <Screen header={
        <>
          <AppBar title="Edit profile" />
          <OfflineBanner />
        </>
      } fab={<Fab icon="check" label="Save profile" onPress={() => void save()} disabled={saving} />}>
      <View style={{ gap: space.s3, paddingTop: space.s2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s4, paddingBottom: space.s2 }}>
          <MemberPlate user={{ name: clean || user.name, plate: user.plate, avatarUrl: avatar }} lg />
          <Button variant="text" icon="camera" label="Change photo" onPress={() => setPhotoOpen(true)} />
        </View>
        <TextField
          ref={nameRef}
          label="Name"
          required
          value={name}
          onChangeText={(t) => {
            setName(t);
            setRejected(undefined);
          }}
          onBlur={() => setTouched(true)}
          onSubmitEditing={() => void save()}
          returnKeyType="done"
          autoComplete="name"
          maxLength={NAME_MAX}
          error={error}
        />
        <ReadOnlyField label="Username" value={`@${user.username}`} why="Your recovery key, so it can’t be changed." />
        {!!user.phone && <ReadOnlyField label="Phone number" value={prettyPhone(user.phone)} why="Changing your number isn’t available yet." />}
      </View>

      <BottomSheet visible={photoOpen} onClose={() => setPhotoOpen(false)} title="Profile photo">
        <Rows nested>
          <LedgerRow left={<SpaceIcon name="camera" />} title="Take photo" onPress={() => void choose('camera')} />
          <LedgerRow left={<SpaceIcon name="plus" />} title="Choose from gallery" onPress={() => void choose('gallery')} />
          {!!avatar && (
            <LedgerRow
              left={<SpaceIcon name="trash" />}
              title="Remove photo"
              onPress={() => {
                setAvatar(null);
                setPhotoOpen(false);
              }}
            />
          )}
        </Rows>
      </BottomSheet>
    </Screen>
  );
}
