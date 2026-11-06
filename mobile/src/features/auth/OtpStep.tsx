import { useRef, useState } from 'react';
import { Text, View, type TextInputInstance } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { useServices } from '../../services/useServices';
import { AppBar } from '../../ui/AppBar';
import { Button } from '../../ui/Button';
import { OtpInput } from '../../ui/OtpInput';
import { Screen } from '../../ui/Screen';
import { toast } from '../../ui/Toast';
import { DemoHint, DemoValue } from './DemoHint';
import { useCountdown } from './useCountdown';

const RESEND_SECONDS = 30; // specs § 3.4; the server's reply to a resend sets the next wait

type Props = {
  title: string;
  /** The number, already masked: "+91 80******31". */
  masked: string;
  /** `pendingId` (sign up) or `resetId` (forgot password): what `resendOtp` is called with. */
  resendRef: string;
  /** Checks the code. Rejects with an `AppError` for a wrong, expired or locked code; resolving means the screen is done. */
  verify: (code: string) => Promise<void>;
  /** Shows "Wrong number? Edit" (sign up only). */
  onEdit?: () => void;
};

/**
 * The shared OTP screen of Verify phone and Forgot password (specs § 3.4): six boxes, a message line, Resend code on a
 * 30 s countdown. The code is checked as soon as the sixth digit is in; a wrong one clears the boxes, shakes them and
 * puts the caret back on the first.
 */
export function OtpStep({ title, masked, resendRef, verify, onEdit }: Props) {
  const { colors, type, space } = useTheme();
  const services = useServices();
  const otp = useRef<TextInputInstance>(null);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [shake, setShake] = useState(0);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const { left, restart } = useCountdown(RESEND_SECONDS);

  async function check(entered: string) {
    if (checking) return;
    setChecking(true);
    setFailed(false);
    setMessage('');
    try {
      await verify(entered);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Something went wrong');
      setFailed(true);
      setCode('');
      setShake((n) => n + 1);
      otp.current?.focus();
    } finally {
      setChecking(false);
    }
  }

  async function resend() {
    setSending(true);
    try {
      const { resendAfterSeconds } = await services.auth.resendOtp(resendRef);
      restart(resendAfterSeconds);
      setFailed(false);
      setMessage('');
      toast(`New code sent to ${masked}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Something went wrong');
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen header={<AppBar title={title} />}>
      <View style={{ paddingTop: space.s2 }}>
        <Text style={[type.body, { color: colors.ink }]}>
          We sent a 6-digit code to <Text style={{ fontFamily: type.label.fontFamily }}>{masked}</Text>.
        </Text>
        <View style={{ marginTop: space.s6 }}>
          <OtpInput
            ref={otp}
            value={code}
            onChange={(c) => {
              setCode(c);
              if (c) {
                setFailed(false);
                setMessage('');
              }
            }}
            onComplete={check}
            error={failed}
            shakeKey={shake}
            autoFocus
          />
        </View>
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={[type.label, { marginTop: space.s2 + 2, minHeight: type.label.lineHeight, color: failed ? colors.owe : colors.ink2 }]}
        >
          {message || (checking ? 'Checking the code…' : '')}
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', marginTop: space.s3 }}>
          <Button
            variant="text"
            label={left > 0 ? `Resend code in ${left}s` : 'Resend code'}
            disabled={left > 0 || sending}
            onPress={resend}
          />
          {onEdit && <Button variant="text" label="Wrong number? Edit" onPress={onEdit} />}
        </View>
        {services.mode === 'demo' && (
          <DemoHint>
            Demo: the code is always <DemoValue>123456</DemoValue>.
          </DemoHint>
        )}
      </View>
    </Screen>
  );
}
