import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { isValidEmail, maskEmail, normalizeEmail } from '../../src/domain/email';
import { normalizePhone } from '../../src/domain/phone';
import { FormInput } from '../../src/features/auth/FormInput';
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
  const { colors, type, space } = useTheme();
  const services = useServices();
  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    mode: 'onTouched', // checks a field when it loses focus, then as it changes; the whole form again on submit
    defaultValues: { username: '', name: '', email: '', phone: '', password: '', confirm: '' },
  });
  const { formState, watch } = form;
  useDiscardGuard(formState.isDirty); // Back with typed input asks "Discard changes?" (specs § 3.1)

  const email = normalizeEmail(watch('email'));
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

  /** An email that already has an account, found as soon as the field loses focus rather than after the whole form. */
  async function checkEmail() {
    if (!(await form.trigger('email'))) return;
    if (!(await services.auth.checkEmail(normalizeEmail(form.getValues('email'))).catch(() => true))) form.setError('email', { message: 'Email already registered' });
  }

  /** A 422 from a server lists each field that was refused: put each message under its own field. Returns true if any was shown. */
  function showFieldProblems(e: AppError) {
    const fields = Array.isArray(e.extra?.fields) ? (e.extra.fields as { field?: unknown; message?: unknown }[]) : [];
    const known: Record<string, keyof SignUpInput> = { username: 'username', name: 'name', email: 'email', phone: 'phone', password: 'password', confirm_password: 'confirm' };
    let shown = false;
    for (const f of fields) {
      const name = typeof f.field === 'string' ? known[f.field] : undefined;
      if (name && typeof f.message === 'string') {
        form.setError(name, { message: f.message });
        shown = true;
      }
    }
    return shown;
  }

  const submit = form.handleSubmit(async (v) => {
    try {
      const { pendingId, maskedEmail } = await services.auth.signUp({
        username: v.username,
        name: v.name,
        email: normalizeEmail(v.email),
        phone: normalizePhone(v.phone) ?? v.phone,
        password: v.password,
      });
      form.reset(form.getValues()); // sent: the form is no longer unsaved, and Wrong email? Edit finds it as it was
      router.push({ pathname: '/verify', params: { pendingId, maskedEmail } });
    } catch (e) {
      if (!(e instanceof AppError)) return void toast('Something went wrong');
      if (e.code === 'username_taken') form.setError('username', { message: e.message }, { shouldFocus: true });
      else if (e.code === 'email_taken' || e.code === 'invalid_email') form.setError('email', { message: e.message }, { shouldFocus: true });
      else if (e.code === 'phone_taken') form.setError('phone', { message: e.message }, { shouldFocus: true });
      else if (!showFieldProblems(e)) toast(e.message);
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
        <FormInput
          form={form}
          name="email"
          label="Email"
          required
          helper="We’ll email a code to verify it, and use it if you forget your password."
          success={isValidEmail(email) ? `We’ll email a code to ${maskEmail(email)}` : undefined}
          onBlur={() => void checkEmail()}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          {...text}
        />
        <FormInput
          form={form}
          name="phone"
          label="Phone number"
          required
          helper="With the country code if it isn’t an Indian number, e.g. +1 415 555 0100"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          {...text}
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
