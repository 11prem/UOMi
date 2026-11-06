import { useQuery } from '@tanstack/react-query';
import { EditProfileForm } from '../src/features/profile/EditProfileForm';
import { qk } from '../src/services/queries';
import { useServices } from '../src/services/useServices';
import { AppBar } from '../src/ui/AppBar';
import { NotOnServer } from '../src/ui/NotOnServer';
import { Screen } from '../src/ui/Screen';
import { Skeleton } from '../src/ui/Skeleton';
import { StateBox } from '../src/ui/StateBox';

/** Edit Profile: the stored user, then the form. The server has no endpoint to change a profile yet. */
export default function ProfileEdit() {
  const services = useServices();
  const me = useQuery({ queryKey: qk.profile, queryFn: () => services.profile.get(), enabled: services.mode !== 'server' });
  const header = <AppBar title="Edit profile" />;

  if (services.mode === 'server') {
    return (
      <Screen header={header}>
        <NotOnServer why="The UOMi server you’re connected to can’t change a profile yet. Demo mode can." />
      </Screen>
    );
  }
  if (me.data) return <EditProfileForm user={me.data} />;
  return <Screen header={header}>{me.isError ? <StateBox kind="error" onRetry={() => me.refetch()} /> : <Skeleton rows={3} />}</Screen>;
}
