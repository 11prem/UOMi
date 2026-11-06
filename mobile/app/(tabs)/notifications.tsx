import { useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { AppNotification } from '../../src/domain/types';
import { groupByDay, targetOf } from '../../src/features/notifications/model';
import { NeedsAnswerCard } from '../../src/features/notifications/NeedsAnswerCard';
import { NotificationRow } from '../../src/features/notifications/NotificationRow';
import { SectionHeading } from '../../src/features/space/SectionHeading';
import { qk } from '../../src/services/queries';
import { useServices } from '../../src/services/useServices';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Button } from '../../src/ui/Button';
import { size } from '../../src/ui/metrics';
import { OfflineBanner } from '../../src/ui/OfflineBanner';
import { Rows } from '../../src/ui/Rows';
import { Screen } from '../../src/ui/Screen';
import { Sheet } from '../../src/ui/Sheet';
import { Skeleton } from '../../src/ui/Skeleton';
import { StateBox } from '../../src/ui/StateBox';
import { toast } from '../../src/ui/Toast';

/** Notifications (specs § 11; app.js `R.notifs`): what needs an answer, then everything earlier by day. */
export default function Notifications() {
  const { colors, type, space, radius } = useTheme();
  const services = useServices();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: qk.notifications, queryFn: () => services.notifications.list() });

  // Invalidate (never write the cache by hand): the badge, Home's card and this list all read the same keys.
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.notifications });
  const markAll = useMutation({ mutationFn: () => services.notifications.markAllRead(), onSuccess: refresh, onError: (e) => toast(e.message) });
  const markRead = useMutation({ mutationFn: (id: string) => services.notifications.markRead(id), onSuccess: refresh, onError: (e) => toast(e.message) });

  /** A tap marks the item read and opens what it is about; the page doesn't wait for the write. */
  function open(n: AppNotification) {
    if (!n.read) markRead.mutate(n.id);
    const to = targetOf(n);
    if (to) router.push(to);
  }

  // An answered bill is already out of the refreshed list's "needs an answer"; it stays up here until its peel is over.
  const [peeling, setPeeling] = useState<string[]>([]);
  const all = list.data;
  const needs = all?.filter((n) => n.needsAnswer || peeling.includes(n.id)) ?? [];
  const earlier = all?.filter((n) => !n.needsAnswer && !peeling.includes(n.id)) ?? [];

  return (
    <Screen tabs header={<OfflineBanner />}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.s2 }}>
        <Text accessibilityRole="header" style={[type.display, { color: colors.ink, paddingTop: space.s1, paddingBottom: space.s4 }]}>
          Notifications
        </Text>
        {!!all?.some((n) => !n.read) && (
          <Button variant="text" label="Mark all as read" busy={markAll.isPending} onPress={() => markAll.mutate()} style={{ marginBottom: space.s2 }} />
        )}
      </View>

      {list.isError && <StateBox kind="error" onRetry={() => list.refetch()} />}
      {!all && !list.isError && <Skeleton rows={4} />}
      {all?.length === 0 && (
        <Sheet>
          <StateBox kind="empty" icon="bell" title="No notifications yet" body="When someone adds an expense with you in it, it lands here." />
        </Sheet>
      )}

      {needs.length > 0 && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s2, marginBottom: space.s2 + 2 }}>
            <Text accessibilityRole="header" style={[type.title, { color: colors.ink }]}>
              Needs your answer
            </Text>
            <View
              accessible
              accessibilityLabel={`${needs.length} to answer`}
              style={{ minWidth: size.badge, height: size.badge, borderRadius: radius.pill, backgroundColor: colors.badge, paddingHorizontal: space.s2 - 2, justifyContent: 'center' }}
            >
              <Text style={[type.label, { color: colors.onBadge, textAlign: 'center' }]}>{needs.length}</Text>
            </View>
          </View>
          {/* The copies under each bill stick out 10 × 14 px: the margin and the gap leave room for them. */}
          <View style={{ gap: space.s6 + 2, marginRight: space.s3, marginBottom: space.s4 }}>
            {needs.map((n) => (
              <NeedsAnswerCard key={n.id} n={n} onOpen={open} onLeaving={(on) => setPeeling((ids) => (on ? [...ids, n.id] : ids.filter((id) => id !== n.id)))} />
            ))}
          </View>
        </>
      )}

      {earlier.length > 0 && (
        <>
          <SectionHeading>Earlier</SectionHeading>
          {groupByDay(earlier).map((g) => (
            <View key={g.key}>
              <Text accessibilityRole="header" style={[type.serial, { color: colors.ink2, paddingTop: space.s2, paddingBottom: space.s2 }]}>
                {g.label}
              </Text>
              <Rows>
                {g.items.map((n) => (
                  <NotificationRow key={n.id} n={n} onOpen={open} />
                ))}
              </Rows>
            </View>
          ))}
        </>
      )}
    </Screen>
  );
}
