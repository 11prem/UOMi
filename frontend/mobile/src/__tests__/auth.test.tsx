import path from 'path';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';
import { AppError } from '../services/errors';
import { currentServices } from '../services/useServices';
import { useSession } from '../state/session';
import { FAKE_SERVER_URL, fakeDebug } from '../../test-support/server';

// The server services read their tokens from the secure store; there is no native module under jest.
jest.mock('expo-secure-store', () => {
  const values = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => values.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void values.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void values.delete(k)),
  };
});

const APP = path.join(__dirname, '../../app');
const OTP = '6-digit code';
jest.setTimeout(30_000); // the first render of the file compiles the whole app

beforeEach(() => {
  useSession.setState({ serverUrl: FAKE_SERVER_URL, user: null, landing: '/welcome' });
});

afterEach(async () => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  useSession.setState({ serverUrl: FAKE_SERVER_URL });
  await currentServices().auth.signOut();
  await fakeDebug().resetDemoData(); // a test that signs up or resets a password must not leak into the next
});

async function open(url: string) {
  const r = await renderRouter(APP, { initialUrl: url });
  await waitFor(() => expect(r.getPathname()).toBe(url));
  return r;
}

const type = (label: string, text: string) => fireEvent.changeText(screen.getByLabelText(label), text);
const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));
const value = (label: string) => screen.getByLabelText(label).props.value;

async function fillSignUp(over: Partial<Record<'username' | 'name' | 'email' | 'phone' | 'password' | 'confirm', string>> = {}) {
  const v = { username: 'nina.b', name: 'Nina Basu', email: 'Nina.B@Example.com', phone: '98765 43210', password: 'sunny2day', confirm: 'sunny2day', ...over };
  await type('Username', v.username);
  await type('Name', v.name);
  await type('Email', v.email);
  await type('Phone number', v.phone);
  await type('Password', v.password);
  await type('Confirm password', v.confirm);
}

/** Welcome -> Create account -> a filled form -> Verify email. */
async function toVerify() {
  const r = await open('/welcome');
  await press('Create account');
  await waitFor(() => expect(r.getPathname()).toBe('/signup'));
  await fillSignUp();
  await press('Create account');
  await waitFor(() => expect(r.getPathname()).toBe('/verify'));
  return r;
}

describe('Welcome', () => {
  it('offers Create account and Sign in; long-pressing the wordmark opens the server sheet', async () => {
    const r = await open('/welcome');
    expect(screen.getByText('Shared costs, agreed by everyone in them.')).toBeTruthy();
    await press('Sign in');
    await waitFor(() => expect(r.getPathname()).toBe('/signin'));
    await press('Back');
    await waitFor(() => expect(r.getPathname()).toBe('/welcome'));

    await fireEvent(screen.getByLabelText('UOMi'), 'longPress');
    expect(await screen.findByLabelText('Server URL')).toBeTruthy();
  });
});

describe('sign up', () => {
  it('sign up → verify with 123456 → lands on Home', async () => {
    const r = await toVerify();
    expect(screen.getByText('ni****@example.com')).toBeTruthy(); // the address is masked
    await type(OTP, '123456');
    await waitFor(() => expect(r.getPathname()).toBe('/'));
    expect(useSession.getState().user).toMatchObject({ username: 'nina.b', name: 'Nina Basu', email: 'nina.b@example.com' });
    expect(screen.getByRole('tab', { name: 'Home' })).toBeTruthy();
  });

  it('shows every problem on submit and keeps the user on the form', async () => {
    const r = await open('/signup');
    await press('Create account');
    expect(await screen.findByText('Enter a username')).toBeTruthy();
    expect(screen.getByText('Enter your name')).toBeTruthy();
    expect(screen.getByText('Enter your email')).toBeTruthy();
    expect(screen.getByText('At least 8 characters, with a letter and a number', { exact: false })).toBeTruthy();
    expect(screen.getByText('Confirm your password')).toBeTruthy();
    expect(r.getPathname()).toBe('/signup');
  });

  it('checks each field when it loses focus', async () => {
    await open('/signup');
    await type('Username', 'Ab');
    await fireEvent(screen.getByLabelText('Username'), 'blur');
    expect(await screen.findByText('Use 3–20 lowercase letters, numbers, _ or .')).toBeTruthy();

    await type('Email', 'nina.b@example');
    await fireEvent(screen.getByLabelText('Email'), 'blur');
    expect(await screen.findByText('Enter a valid email address')).toBeTruthy();

    await type('Password', 'sunny2day');
    await type('Confirm password', 'sunny2da');
    await fireEvent(screen.getByLabelText('Confirm password'), 'blur');
    expect(await screen.findByText('Passwords don’t match')).toBeTruthy();
    await type('Password', 'sunny2da1'); // changing the password re-checks the confirmation
    await type('Confirm password', 'sunny2da1');
    await waitFor(() => expect(screen.queryByText('Passwords don’t match')).toBeNull());
  });

  it('shows ✓ Available or ✗ taken 400 ms after typing stops', async () => {
    await open('/signup');
    await type('Username', 'kabir.r');
    expect(screen.queryByText('✗ Username already taken')).toBeNull(); // not before the pause
    expect(await screen.findByText('✗ Username already taken', {}, { timeout: 2000 })).toBeTruthy();
    await type('Username', 'nina.b');
    expect(await screen.findByText('✓ Available', {}, { timeout: 2000 })).toBeTruthy();
  });

  it('flags an email that already has an account when the field loses focus, whatever its case', async () => {
    await open('/signup');
    await type('Email', 'Kabir.R@example.com'); // Kabir's email in the fake backend's data
    await fireEvent(screen.getByLabelText('Email'), 'blur');
    expect(await screen.findByText('Email already registered')).toBeTruthy();
  });

  it('says where the code will go once the email is valid, and asks for a phone number but no country picker', async () => {
    await open('/signup');
    await type('Email', 'nina.b@example.com');
    expect(await screen.findByText('We’ll email a code to ni****@example.com')).toBeTruthy();
    expect(screen.getByLabelText('Phone number')).toBeTruthy(); // kept on the account; the code goes to the email
    expect(screen.queryByLabelText(/Change country/)).toBeNull();
  });

  it('Back with typed input asks "Discard changes?"', async () => {
    const r = await open('/signup');
    await type('Username', 'nina.b');
    await press('Back');
    expect(await screen.findByText('Discard changes?')).toBeTruthy();
    await press('Keep editing');
    expect(r.getPathname()).toBe('/signup');
    await press('Back');
    await press('Discard');
    await waitFor(() => expect(r.getPathname()).toBe('/welcome'));
  });

  it('Wrong email? Edit returns to the form with every field kept', async () => {
    const r = await toVerify();
    await press('Wrong email? Edit');
    await waitFor(() => expect(r.getPathname()).toBe('/signup'));
    expect(value('Username')).toBe('nina.b');
    expect(value('Name')).toBe('Nina Basu');
    expect(value('Email')).toBe('Nina.B@Example.com');
  });
});

describe('verify email', () => {
  it('wrong OTP clears boxes and shows "That code is incorrect"', async () => {
    const r = await toVerify();
    await type(OTP, '000000');
    expect(await screen.findByText('That code is incorrect')).toBeTruthy();
    expect(value(OTP)).toBe('');
    expect(r.getPathname()).toBe('/verify');
    expect(useSession.getState().user).toBeNull(); // no account until the email is verified

    await type(OTP, '1');
    expect(screen.queryByText('That code is incorrect')).toBeNull(); // typing again clears the message
  });

  it('the fifth wrong code says to wait 10 minutes', async () => {
    await toVerify();
    for (let i = 0; i < 5; i++) await type(OTP, '000000');
    expect(await screen.findByText('Too many attempts — try again in 10 minutes')).toBeTruthy();
  });

  it('Resend code waits 30 s, then sends a new code', async () => {
    await toVerify();
    const resend = screen.getByRole('button', { name: /Resend code in 3\ds/ });
    expect(resend.props.accessibilityState.disabled).toBe(true);

    const real = Date.now;
    jest.spyOn(Date, 'now').mockImplementation(() => real() + 31_000);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resend code' }).props.accessibilityState.disabled).toBe(false), { timeout: 2500 });
    await press('Resend code');
    expect(await screen.findByText('New code sent to ni****@example.com')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: /Resend code in/ })).toBeTruthy()); // the count starts again
  });

  it('a resend reply without a usable wait still keeps Resend disabled, from the first render', async () => {
    await toVerify();
    const real = Date.now;
    jest.spyOn(Date, 'now').mockImplementation(() => real() + 31_000);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resend code' }).props.accessibilityState.disabled).toBe(false), { timeout: 2500 });
    jest.spyOn(currentServices().auth, 'resendOtp').mockResolvedValue({} as { resendAfterSeconds: number }); // a reply with no number
    await press('Resend code');
    // No gap in which the button is enabled: right after the reply it already counts down from the default 30 s
    const again = await screen.findByRole('button', { name: /Resend code in 30s/ });
    expect(again.props.accessibilityState.disabled).toBe(true);
  });
});

describe('sign in', () => {
  it('invalid credentials message', async () => {
    const r = await open('/signin');
    await type('Username', 'kabir.r');
    await type('Password', 'wrong-pass1');
    await press('Sign in');
    expect(await screen.findByText('Username or password is incorrect')).toBeTruthy();
    expect(r.getPathname()).toBe('/signin');
    expect(useSession.getState().user).toBeNull();
  });

  it('invalid credentials shows the required copy, not the server’s own wording', async () => {
    jest.spyOn(currentServices().auth, 'signIn').mockRejectedValue(new AppError('invalid_credentials', 'Incorrect username or password.'));
    const r = await open('/signin');
    await type('Username', 'kabir.r');
    await type('Password', 'whatever1');
    await press('Sign in');
    expect(await screen.findByText('Username or password is incorrect')).toBeTruthy();
    expect(screen.queryByText('Incorrect username or password.')).toBeNull();
    expect(r.getPathname()).toBe('/signin');
  });

  it('too many attempts says how many minutes, from retry_after_seconds', async () => {
    jest.spyOn(currentServices().auth, 'signIn').mockRejectedValue(new AppError('too_many_attempts', 'Slow down', { retry_after_seconds: 540 }));
    await open('/signin');
    await type('Username', 'kabir.r');
    await type('Password', 'whatever1');
    await press('Sign in');
    expect(await screen.findByText('Too many attempts — try again in 9 minutes')).toBeTruthy();
  });

  it('asks for both fields before calling the service', async () => {
    const signIn = jest.spyOn(currentServices().auth, 'signIn');
    await open('/signin');
    await press('Sign in');
    expect(await screen.findByText('Enter your username')).toBeTruthy();
    expect(screen.getByText('Enter your password')).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('signs in and leaves for Home', async () => {
    const r = await open('/signin');
    await type('Username', 'kabir.r');
    await type('Password', 'demo1234');
    await press('Sign in');
    await waitFor(() => expect(r.getPathname()).toBe('/'));
    expect(useSession.getState().user?.username).toBe('kabir.r');
  });
});

describe('forgot password', () => {
  it('an unknown username looks like a known one until the new password is saved, and then nothing is changed', async () => {
    const r = await open('/forgot');
    await type('Username', 'nobody.here');
    await press('Send code');
    await waitFor(() => expect(r.getPathname()).toBe('/forgot-otp'));
    expect(screen.getByText('no*********@example.com')).toBeTruthy();
    expect(screen.queryByText('We couldn’t find that username')).toBeNull();
    await type(OTP, '123456');
    await waitFor(() => expect(r.getPathname()).toBe('/reset'));
    await type('New password', 'fresh2pass');
    await type('Confirm password', 'fresh2pass');
    await press('Save password');
    expect(await screen.findByText(/not found/i)).toBeTruthy(); // a toast: no account was changed or created
    expect(r.getPathname()).toBe('/reset');
    await expect(currentServices().auth.signIn('nobody.here', 'fresh2pass')).rejects.toMatchObject({ code: 'invalid_credentials' });
  });

  it('reset → Sign In with username prefilled, and the new password works', async () => {
    const r = await open('/signin');
    await press('Forgot password?');
    await waitFor(() => expect(r.getPathname()).toBe('/forgot'));
    await type('Username', 'kabir.r');
    await press('Send code');
    await waitFor(() => expect(r.getPathname()).toBe('/forgot-otp'));
    expect(screen.getByText('ka*****@example.com')).toBeTruthy(); // the registered email, masked

    await type(OTP, '123456');
    await waitFor(() => expect(r.getPathname()).toBe('/reset'));
    await type('New password', 'fresh2pass');
    await type('Confirm password', 'fresh2pass');
    await press('Save password');

    await waitFor(() => expect(r.getPathname()).toBe('/signin'));
    expect(screen.getByText('Password updated')).toBeTruthy();
    expect(value('Username')).toBe('kabir.r');

    await type('Password', 'fresh2pass');
    await press('Sign in');
    await waitFor(() => expect(r.getPathname()).toBe('/'));
  });

  it('reset checks the new password and its confirmation', async () => {
    const r = await open('/forgot');
    await type('Username', 'kabir.r');
    await press('Send code');
    await waitFor(() => expect(r.getPathname()).toBe('/forgot-otp'));
    await type(OTP, '123456');
    await waitFor(() => expect(r.getPathname()).toBe('/reset'));
    await type('New password', 'short');
    await type('Confirm password', 'different1');
    await press('Save password');
    expect(await screen.findByText('At least 8 characters, with a letter and a number', { exact: false })).toBeTruthy();
    expect(screen.getByText('Passwords don’t match')).toBeTruthy();
    expect(r.getPathname()).toBe('/reset');
  });

  it('a wrong code on the reset screen shows the same message', async () => {
    const r = await open('/forgot');
    await type('Username', 'kabir.r');
    await press('Send code');
    await waitFor(() => expect(r.getPathname()).toBe('/forgot-otp'));
    await type(OTP, '111111');
    expect(await screen.findByText('That code is incorrect')).toBeTruthy();
    expect(r.getPathname()).toBe('/forgot-otp');
  });
});

describe('real server services', () => {
  it('Create Account is the real form, with a phone number', async () => {
    useSession.setState({ serverUrl: 'http://x', user: null });
    const r = await open('/welcome');
    await press('Create account');
    await waitFor(() => expect(r.getPathname()).toBe('/signup'));
    expect(screen.getByLabelText('Username')).toBeTruthy();
    expect(screen.getByLabelText('Phone number')).toBeTruthy();
    expect(screen.queryByText('Not available on this server yet')).toBeNull();
  });

  it('Create account sends the phone as E.164 and goes to the code screen, which never shows the code', async () => {
    useSession.setState({ serverUrl: 'http://x', user: null });
    const signUp = jest.spyOn(currentServices().auth, 'signUp').mockResolvedValue({ pendingId: 'su_1', maskedEmail: 'ni*****@example.com' });
    const r = await open('/signup');
    await fillSignUp();
    await press('Create account');
    await waitFor(() => expect(r.getPathname()).toBe('/verify'));
    expect(signUp).toHaveBeenCalledWith({ username: 'nina.b', name: 'Nina Basu', email: 'nina.b@example.com', phone: '+919876543210', password: 'sunny2day' });
    expect(screen.getByText('ni*****@example.com')).toBeTruthy();
    expect(screen.queryByText(/123456/)).toBeNull(); // the code is typed from the email (or the development setting), never shown
  });

  it('the code screen never shows a code, whichever backend sent it', async () => {
    await toVerify();
    expect(screen.queryByText(/the code is always/)).toBeNull();
    expect(screen.queryByText('123456')).toBeNull();
  });

  it('a phone the server already has is shown under the phone field', async () => {
    useSession.setState({ serverUrl: 'http://x', user: null });
    jest.spyOn(currentServices().auth, 'signUp').mockRejectedValue(new AppError('phone_taken', 'Phone number already registered'));
    const r = await open('/signup');
    await fillSignUp();
    await press('Create account');
    expect(await screen.findByText('Phone number already registered')).toBeTruthy();
    expect(r.getPathname()).toBe('/signup');
  });

  it('a phone that cannot be one is refused before anything is sent', async () => {
    useSession.setState({ serverUrl: 'http://x', user: null });
    const signUp = jest.spyOn(currentServices().auth, 'signUp');
    await open('/signup');
    await fillSignUp({ phone: '12' });
    await press('Create account');
    expect(await screen.findByText(/Enter a valid phone number/)).toBeTruthy();
    expect(signUp).not.toHaveBeenCalled();
  });

  it('Forgot password? opens the real form, and Sign In stays a form', async () => {
    useSession.setState({ serverUrl: 'http://x', user: null });
    const r = await open('/signin');
    expect(screen.queryByText('demo1234')).toBeNull(); // no sample accounts are listed
    await press('Forgot password?');
    await waitFor(() => expect(r.getPathname()).toBe('/forgot'));
    expect(screen.getByLabelText('Username')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send code' })).toBeTruthy();
    expect(screen.queryByText('Not available on this server yet')).toBeNull();
  });
});
