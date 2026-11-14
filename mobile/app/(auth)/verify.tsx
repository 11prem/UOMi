import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { OtpStep } from '../../src/features/auth/OtpStep';
import { useServices } from '../../src/services/useServices';
import { useSession } from '../../src/state/session';
import { toast } from '../../src/ui/Toast';

/** Verify email (specs § 4.3): the right code creates the account and signs in; the gate then moves to Home. */
export default function Verify() {
  const services = useServices();
  const { pendingId, maskedEmail } = useLocalSearchParams<{ pendingId?: string; maskedEmail?: string }>();
  if (!pendingId || !maskedEmail) return <Redirect href="/signup" />; // opened without a sign-up behind it (a web reload)

  return (
    <OtpStep
      title="Verify your email"
      masked={maskedEmail}
      resendRef={pendingId}
      onEdit={() => router.back()}
      verify={async (code) => {
        const user = await services.auth.verifySignUpOtp(pendingId, code);
        useSession.getState().signedIn(user);
        toast(`Welcome to UOMi, ${user.name.split(' ')[0]}`);
      }}
    />
  );
}
