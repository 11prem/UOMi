import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { OtpStep } from '../../src/features/auth/OtpStep';
import { resetToken } from '../../src/features/auth/resetToken';
import { useServices } from '../../src/services/useServices';

/** Forgot password, step 2 (specs § 4.5b): the code sent to the registered phone. The right one opens New password. */
export default function ForgotOtp() {
  const services = useServices();
  const { resetId, maskedPhone } = useLocalSearchParams<{ resetId?: string; maskedPhone?: string }>();
  if (!resetId || !maskedPhone) return <Redirect href="/forgot" />;

  return (
    <OtpStep
      title="Enter the code"
      masked={maskedPhone}
      resendRef={resetId}
      verify={async (code) => {
        resetToken.set((await services.auth.verifyResetOtp(resetId, code)).resetToken);
        router.replace('/reset'); // Back from New password goes to the username step, not to a spent code
      }}
    />
  );
}
