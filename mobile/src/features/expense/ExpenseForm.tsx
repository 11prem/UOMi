import { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { router } from 'expo-router';
import { parseAmountInput } from '../../domain/money';
import { computeSplit } from '../../domain/split';
import type { Expense, Space, SplitType, User } from '../../domain/types';
import type { Services } from '../../services/types';
import { useTheme } from '../../theme/ThemeProvider';
import { AppBar } from '../../ui/AppBar';
import { Chip } from '../../ui/Chip';
import { Fab } from '../../ui/Fab';
import { Field } from '../../ui/Field';
import { OfflineBanner } from '../../ui/OfflineBanner';
import { Screen } from '../../ui/Screen';
import { TextField } from '../../ui/TextField';
import { toast } from '../../ui/Toast';
import { useDiscardGuard } from '../../ui/useDiscardGuard';
import { AmountField } from './AmountField';
import { amountProblem, cleanDecimal, cleanWhole, minorToText } from './amountText';
import { DateField } from './DateField';
import { errorText, refreshMoney } from './refresh';
import { clearedValues, splitRows, valueText, type SplitValues } from './split';
import { SplitEditor, type SplitTone } from './SplitEditor';

export type ExpenseInput = Parameters<Services['expenses']['create']>[0];

type Draft = {
  description: string;
  amount: string;
  paidBy: string;
  type: SplitType;
  date: number;
  on: Record<string, boolean>;
  values: SplitValues;
};

/** A new expense: everyone ticked, paid by the viewer, split equally, today. An edit: the expense as stored. */
function initialDraft(space: Space, meId: string, e?: Expense): Draft {
  const on: Record<string, boolean> = {};
  const values: SplitValues = {};
  for (const id of space.memberIds) {
    const share = e?.shares.find((s) => s.userId === id);
    on[id] = e ? !!share : true;
    values[id] = e && share ? valueText(e.splitType, share.input) : '';
  }
  return {
    description: e?.description ?? '',
    amount: e ? minorToText(e.amountMinor) : '',
    paidBy: e?.paidBy ?? meId,
    type: e?.splitType ?? 'equal',
    date: e?.date ?? Date.now(),
    on,
    values,
  };
}

export type ExpenseFormProps = {
  title: 'Add expense' | 'Edit expense';
  space: Space;
  members: User[];
  meId: string;
  /** Edit: the expense to start from. */
  expense?: Expense;
  onSubmit: (input: ExpenseInput) => Promise<unknown>;
  /** "Expense added" / "Expense updated". */
  savedToast: string;
  /** Queries to refresh besides the money ones (the edited expense). */
  refresh?: QueryKey[];
};

/**
 * Add / Edit Expense (specs § 8.1–8.2; app.js `expenseForm`): description, the hero amount, who paid, the split with its
 * live helper line, the date. ✓ is enabled once the split is valid; it saves, goes back and toasts. Leaving with unsaved
 * input asks "Discard changes?" (Review Focus 4).
 */
export function ExpenseForm({ title, space: s, members, meId, expense, onSubmit, savedToast, refresh = [] }: ExpenseFormProps) {
  const { space } = useTheme();
  const queryClient = useQueryClient();
  const [initial] = useState(() => initialDraft(s, meId, expense));
  const initialJson = useRef(JSON.stringify(initial)).current;
  const [d, setD] = useState(initial);
  const [touched, setTouched] = useState({ description: false, amount: false });
  const [saving, setSaving] = useState(false);
  const leave = useDiscardGuard(JSON.stringify(d) !== initialJson);

  const people = useMemo(() => Object.fromEntries(members.map((u) => [u.id, u])), [members]);
  const description = d.description.trim();
  const total = parseAmountInput(d.amount);
  const rows = splitRows(s.memberIds, d.on, d.values, d.type);
  const split = computeSplit(total ?? 0, d.type, rows, s.currency);
  const amounts = Object.fromEntries(split.amounts.map((a) => [a.userId, a.amountMinor]));
  // specs § 8.2: a share count is a whole number ≥ 1 — a ticked 0 would send someone a ₹0.00 share to answer.
  const zeroShare = d.type === 'shares' && rows.some((r) => r.input === 0);
  const helper = zeroShare && total !== null ? 'Each person ticked needs at least 1 share' : split.helper;
  const valid = description.length > 0 && total !== null && split.valid && !zeroShare;

  let tone: SplitTone = 'muted';
  if (total !== null && rows.length) {
    if (zeroShare) tone = 'pending';
    else if (split.valid) tone = d.type === 'exact' || d.type === 'percent' ? 'owed' : 'ink';
    else tone = / over$/.test(split.helper) ? 'owe' : 'pending';
  }

  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setType = (type: SplitType) => setD((x) => (x.type === type ? x : { ...x, type, values: clearedValues(s.memberIds, x.on, type) }));
  const toggle = (id: string) => {
    if (d.on[id] && rows.length === 1) return toast('At least one person must be in the split');
    // Unticking drops the person's value; ticking adds them with nothing typed (1 share).
    setD((x) => ({ ...x, on: { ...x.on, [id]: !x.on[id] }, values: { ...x.values, [id]: !x.on[id] && x.type === 'shares' ? '1' : '' } }));
  };
  const setValue = (id: string, text: string) =>
    setD((x) => ({ ...x, values: { ...x.values, [id]: x.type === 'shares' ? cleanWhole(text) : cleanDecimal(text) } }));

  async function save() {
    if (!valid || total === null || saving) return;
    // A bad timestamp would be stored as is; the day list never offers a future day, so this is the last guard.
    if (!Number.isFinite(d.date) || d.date > Date.now()) return toast('The date can’t be in the future');
    setSaving(true);
    try {
      await onSubmit({
        spaceId: s.id,
        description,
        amountMinor: total,
        paidBy: d.paidBy,
        splitType: d.type,
        date: d.date,
        shares: rows.map((r, i) => ({ userId: r.userId, input: r.input, amountMinor: split.amounts[i].amountMinor, response: 'pending' })),
      });
    } catch (e) {
      setSaving(false);
      return toast(errorText(e));
    }
    void refreshMoney(queryClient, ...refresh);
    leave(() => router.back());
    toast(savedToast);
  }

  return (
    <Screen
      header={
        <>
          <AppBar title={title} backTo={s.name} />
          <OfflineBanner />
        </>
      }
      fab={<Fab icon="check" label="Save expense" onPress={save} disabled={!valid || saving} />}
    >
      <View style={{ gap: space.s4, paddingTop: space.s1 }}>
        <TextField
          label="Description"
          required
          value={d.description}
          onChangeText={(description) => set({ description })}
          onBlur={() => setTouched((t) => ({ ...t, description: true }))}
          maxLength={50}
          placeholder="e.g. Dinner"
          autoFocus={!expense}
          returnKeyType="next"
          error={touched.description && !description ? 'Add a short description' : undefined}
        />
        <AmountField
          label="Amount"
          required
          currency={s.currency}
          value={d.amount}
          onChangeText={(amount) => set({ amount })}
          onBlur={() => setTouched((t) => ({ ...t, amount: true }))}
          error={touched.amount && total === null ? amountProblem(d.amount) : undefined}
        />
        <Field label="Paid by">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 }}>
            {s.memberIds.map((id) => (
              <Chip
                key={id}
                label={id === meId ? 'You' : (people[id]?.name ?? 'Someone').split(/\s+/)[0]}
                selected={d.paidBy === id}
                onPress={() => set({ paidBy: id })}
              />
            ))}
          </View>
        </Field>
        <SplitEditor
          memberIds={s.memberIds}
          people={people}
          meId={meId}
          currency={s.currency}
          type={d.type}
          on={d.on}
          values={d.values}
          amounts={amounts}
          helper={helper}
          tone={tone}
          onType={setType}
          onToggle={toggle}
          onValue={setValue}
        />
        <DateField value={d.date} onChange={(date) => set({ date })} />
      </View>
    </Screen>
  );
}
