import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { balanceText, overallLines } from '../../src/domain/phrases';
import { HomeCard, HomeCardSkeleton, STRIP } from '../../src/features/home/HomeCard';
import { endSpaceDraft, startSpaceDraft, useSpaceDraft } from '../../src/features/space/draft';
import { serial } from '../../src/features/space/format';
import { SectionHeading } from '../../src/features/space/SectionHeading';
import { SpaceNamePopup } from '../../src/features/space/SpaceNamePopup';
import { qk } from '../../src/services/queries';
import { useServices } from '../../src/services/useServices';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Icon } from '../../src/ui/Icon';
import { size } from '../../src/ui/metrics';
import { OfflineBanner } from '../../src/ui/OfflineBanner';
import { Press } from '../../src/ui/Press';
import { LedgerRow, Rows } from '../../src/ui/Rows';
import { Screen } from '../../src/ui/Screen';
import { Sheet } from '../../src/ui/Sheet';
import { Skeleton } from '../../src/ui/Skeleton';
import { SpaceIcon } from '../../src/ui/SpaceIcon';
import { StateBox } from '../../src/ui/StateBox';
import { Wordmark } from '../../src/ui/Wordmark';

/** Home (specs § 5; app.js `R.home`): the notification card and Create Space, the overall net per currency, the spaces. */
export default function Home() {
  const { colors, type, space, radius } = useTheme();
  const services = useServices();
  const naming = useSpaceDraft((s) => s.step === 'name');
  const notifications = useQuery({ queryKey: qk.notifications, queryFn: () => services.notifications.list() });
  const unread = useQuery({ queryKey: qk.unread, queryFn: () => services.notifications.unreadCount() });
  const spaces = useQuery({ queryKey: qk.spaces, queryFn: () => services.spaces.list() });
  const overall = useQuery({ queryKey: qk.overall, queryFn: () => services.spaces.overall() });
  useEffect(endSpaceDraft, []); // a session's Home starts without a pop-up, whatever the last session left open

  const queries = [notifications, unread, spaces, overall];
  const failed = queries.some((q) => q.isError); // data already loaded stays on screen under the error
  const n = unread.data ?? 0;
  const tone = { owe: colors.owe, owed: colors.owed, muted: colors.ink2 };

  return (
    <Screen tabs header={<OfflineBanner />}>
      <Wordmark />
      {failed && <StateBox kind="error" onRetry={() => queries.forEach((q) => q.isError && q.refetch())} />}

      <Press
        onPress={() => router.navigate('/notifications')}
        accessibilityLabel={n ? `Notifications, ${n} unread notification${n === 1 ? '' : 's'}` : 'Notifications'}
        scaleTo={1}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s2, alignSelf: 'flex-start', minHeight: size.target, marginTop: space.s2, marginBottom: space.s2 }}
      >
        <Text style={[type.title, { color: colors.ink }]}>Notifications</Text>
        {n > 0 && (
          <View style={{ minWidth: size.badge, height: size.badge, borderRadius: radius.pill, backgroundColor: colors.badge, paddingHorizontal: space.s2 - 2, justifyContent: 'center' }}>
            <Text style={[type.label, { color: colors.onBadge, textAlign: 'center' }]}>{n}</Text>
          </View>
        )}
      </Press>

      {/* The copies under a pending bill stick out 10 × 14 px: the gap and the margin below leave room for them. */}
      <View style={{ flexDirection: 'row', gap: space.s5, marginBottom: space.s4 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {notifications.data ? <HomeCard notifications={notifications.data} /> : !notifications.isError && <HomeCardSkeleton />}
        </View>
        <Press
          onPress={startSpaceDraft}
          accessibilityLabel="Create Space"
          scaleTo={0.97}
          style={{
            width: STRIP.tile,
            minHeight: STRIP.height,
            backgroundColor: colors.sheet,
            borderWidth: size.hairline,
            borderColor: colors.hair,
            borderRadius: radius.sheet,
            alignItems: 'center',
            justifyContent: 'center',
            gap: space.s2 + 2,
          }}
          pressedStyle={{ backgroundColor: colors.carbonWash }}
        >
          <Icon name="plus" size="lg" color={colors.carbon} />
          <Text style={[type.body, { fontFamily: type.label.fontFamily, color: colors.ink }]}>Create Space</Text>
        </Press>
      </View>

      <SectionHeading>Running total</SectionHeading>
      <View style={{ borderTopWidth: size.hairline, borderBottomWidth: size.hairline, borderColor: colors.hairStrong, paddingVertical: space.s2 }}>
        {overall.data
          ? overallLines(overall.data).map((l) => (
              <Text key={l.text} style={[type.title, { color: tone[l.tone], paddingVertical: space.s1 }]}>
                {l.text}
              </Text>
            ))
          : !overall.isError && <Skeleton width="60%" height={type.title.lineHeight} />}
      </View>

      <SectionHeading>Spaces</SectionHeading>
      {spaces.data ? (
        spaces.data.length ? (
          <Rows>
            {spaces.data.map(({ space: s, balance }) => {
              const b = balanceText(balance);
              return (
                <LedgerRow
                  key={s.id}
                  left={<SpaceIcon name={s.icon} />}
                  title={s.name}
                  sub={serial(s.serial)}
                  amount={b.text}
                  amountSub={b.sub || undefined}
                  tone={b.tone}
                  onPress={() => router.push(`/space/${s.id}`)}
                />
              );
            })}
          </Rows>
        ) : (
          <Sheet>
            <StateBox kind="empty" icon="users" title="No spaces yet" body="Tap + to create your first space." />
          </Sheet>
        )
      ) : (
        !spaces.isError && <Skeleton rows={4} />
      )}

      <SpaceNamePopup visible={naming} onClose={endSpaceDraft} onNext={() => router.push('/space/add-people')} />
    </Screen>
  );
}
