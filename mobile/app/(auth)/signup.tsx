import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { COUNTRIES, maskPhone, toE164 } from '../../src/domain/phone';
import { FormInput } from '../../src/features/auth/FormInput';
import { PhoneField, regionCountry } from '../../src/features/auth/PhoneField';
import { Unavailable } from '../../src/features/auth/Unavailable';
import { PASSWORD_HINT, USERNAME_RULE, password as passwordRule, signUpSchema, type SignUpInput } from '../../src/features/auth/schemas';
import { AppError } from '../../src/services/errors';
import { useServices } from '../../src/services/useServices';
import { useTheme } from '../../src/theme/ThemeProvider';
import { AppBar } from '../../src/ui/AppBar';
import { Button } from '../../src/ui/Button';
import { Screen } from '../../src/ui/Screen';
import { toast } from '../../src/ui/Toast';
import { useDiscardGuard } from '../../src/ui/useDiscardGuard';

const AVAILABILITY_DELAY_MS = 400;

export default function SignUp() {
  const { mode } = useServices();
  return mode === 'server' ? (
    <Unavailable title="Create account" why="Accounts can’t be created from the app on this server yet. Sign in with an existing account, or use Demo mode." />
  ) : (
    <SignUpForm />
  );
}

function SignUpForm() {
  const { colors, type, space } = useTheme();
  const services = useServices();
  const initialCountry = useMemo(() => regionCountry().code, []);
  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    mode: 'onTouched', // checks a field when it loses focus, then as it changes; the whole form again on submit
    defaultValues: { username: '', name: '', country: initialCountry, phone: '', password: '', confirm: '' },
  });
  const { formState, watch } = form;
  useDiscardGuard(formState.isDirty); // Back with typed input asks "Discard changes?" (specs § 3.1)

  const country = COUNTRIES.find((c) => c.code === watch('country')) ?? COUNTRIES[0];
  const phoneE164 = toE164(watch('phone'), country.code);
  const passwordOk = passwordRule.safeParse(watch('password')).success;

  // ✓ Available / ✗ taken, 400 ms after the last keystroke (specs § 4.2)
  const username = watch('username');
  const [free, setFree] = useState<boolean | null>(null);
  useEffect(() => {
    setFree(null);
    const wanted = username.trim().toLowerCase();
    if (!USERNAME_RULE.test(wanted)) return;
    let current = true;
    const timer = setTimeout(() => {
      services.auth.checkUsername(wanted).then((ok) => current && setFree(ok), () => {});
    }, AVAILABILITY_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [username, services]);

  /** A number that already has an account, found as soon as the field loses focus rather than after the whole form. */
  async function checkPhone() {
    if (!(await form.trigger('phone'))) return;
    const e164 = toE164(form.getValues('phone'), country.code);
    if (e164 && !(await services.auth.checkPhone(e164).catch(() => true))) form.setError('phone', { message: 'Phone number already registered' });
  }

  const submit = form.handleSubmit(async (v) => {
    try {
      const { pendingId, maskedPhone } = await services.auth.signUp({
        username: v.username,
        name: v.name,
        phone: toE164(v.phone, country.code)!, // the schema accepted it for this country
        password: v.password,
      });
      form.reset(form.getValues()); // sent: the form is no longer unsaved, and Wrong number? Edit finds it as it was
      router.push({ pathname: '/verify', params: { pendingId, maskedPhone } });
    } catch (e) {
      if (!(e instanceof AppError)) return void toast('Something went wrong');
      if (e.code === 'username_taken') form.setError('username', { message: e.message }, { shouldFocus: true });
      else if (e.code === 'phone_taken') form.setError('phone', { message: e.message }, { shouldFocus: true });
      else toast(e.message);
    }
  });

  const text = { autoCapitalize: 'none', autoCorrect: false, spellCheck: false } as const;
  return (
    <Screen header={<AppBar title="Create account" />}>
      <View style={{ paddingTop: space.s2, gap: space.s4 }}>
        <FormInput
          form={form}
          name="username"
          label="Username"
          required
          helper="You’ll use this to recover your account"
          error={free === false ? '✗ Username already taken' : undefined}
          success={free ? '✓ Available' : undefined}
          autoComplete="username-new"
          textContentType="username"
          {...text}
        />
        <FormInput form={form} name="name" label="Name" required autoComplete="name" textContentType="name" autoCapitalize="words" />
        <Controller
          control={form.control}
          name="phone"
          render={({ field, fieldState }) => (
            <PhoneField
              ref={field.ref}
              label="Phone number"
              required
              value={field.value}
              country={country}
              onCountry={(c) => {
                form.setValue('country', c.code);
                if (field.value) void form.trigger('phone'); // the same digits may be wrong for the new country
              }}
              onChangeText={field.onChange}
              onBlur={() => {
                field.onBlur();
                void checkPhone();
              }}
              helper="People use it to find you. We’ll text a code to verify it."
              error={fieldState.error?.message}
              success={phoneE164 && !fieldState.error ? `We’ll text a code to ${maskPhone(phoneE164)}` : undefined}
            />
          )}
        />
        <FormInput
          form={form}
          name="password"
          password
          label="Password"
          required
          helper={PASSWORD_HINT}
          success={passwordOk ? 'Strong enough' : undefined}
          autoComplete="new-password"
          textContentType="newPassword"
          revalidate={['confirm']}
        />
        <FormInput form={form} name="confirm" password label="Confirm password" required autoComplete="new-password" textContentType="newPassword" />
        <Button label="Create account" onPress={submit} busy={formState.isSubmitting} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={[type.label, { color: colors.ink2 }]}>Already have an account?</Text>
          <Button variant="text" label="Sign in" onPress={() => router.replace('/signin')} />
        </View>
      </View>
    </Screen>
  );
}
