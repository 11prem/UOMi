/* UOMi prototype — mock data layer (frontend only). All people, amounts and spaces are synthetic demo data. */
(function () {
  const KEY = 'uomi.v1';
  const DAY = 86400000;
  const now = () => Date.now();
  const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 9);

  const CURRENCIES = {
    INR: { symbol: '₹', locale: 'en-IN', name: 'Indian rupee' },
    USD: { symbol: '$', locale: 'en-US', name: 'US dollar' },
    EUR: { symbol: '€', locale: 'en-IE', name: 'Euro' },
    GBP: { symbol: '£', locale: 'en-GB', name: 'British pound' },
    AED: { symbol: 'AED', locale: 'en-AE', name: 'UAE dirham' },
    SGD: { symbol: 'S$', locale: 'en-SG', name: 'Singapore dollar' }
  };

  const COUNTRIES = [
    { code: 'IN', name: 'India', dial: '+91', len: [10], currency: 'INR' },
    { code: 'AE', name: 'United Arab Emirates', dial: '+971', len: [9], currency: 'AED' },
    { code: 'US', name: 'United States', dial: '+1', len: [10], currency: 'USD' },
    { code: 'GB', name: 'United Kingdom', dial: '+44', len: [10], currency: 'GBP' },
    { code: 'SG', name: 'Singapore', dial: '+65', len: [8], currency: 'SGD' },
    { code: 'CA', name: 'Canada', dial: '+1', len: [10], currency: 'USD' },
    { code: 'AU', name: 'Australia', dial: '+61', len: [9], currency: 'USD' },
    { code: 'DE', name: 'Germany', dial: '+49', len: [10, 11], currency: 'EUR' },
    { code: 'NP', name: 'Nepal', dial: '+977', len: [10], currency: 'USD' },
    { code: 'LK', name: 'Sri Lanka', dial: '+94', len: [9], currency: 'USD' },
    { code: 'BD', name: 'Bangladesh', dial: '+880', len: [10], currency: 'USD' },
    { code: 'SA', name: 'Saudi Arabia', dial: '+966', len: [9], currency: 'USD' }
  ];

  const ICONS = ['home', 'trip', 'food', 'office', 'friends', 'car', 'party', 'other'];

  function seed() {
    const t = now();
    const users = [
      { id: 'u_kabir', username: 'kabir.r', name: 'Kabir Rao', phone: '+919845012331', furniture: 1 },
      { id: 'u_swetha', username: 'swetha.i', name: 'Swetha Iyer', phone: '+919880213344', furniture: 2 },
      { id: 'u_arun', username: 'arun.n', name: 'Arun Nair', phone: '+919446078812', furniture: 3 },
      { id: 'u_meera', username: 'meera.s', name: 'Meera Shah', phone: '+971501234567', furniture: 4 },
      { id: 'u_rohan', username: 'rohan.d', name: 'Rohan Das', phone: '+919830045566', furniture: 5 },
      { id: 'u_priya', username: 'priya.m', name: 'Priya Menon', phone: '+919567001122', furniture: 6 }
    ].map((u) => Object.assign(u, { password: 'demo1234', phoneVerified: true, avatar: null }));

    const sp = (id, name, icon, currency, ownerId, memberIds, serial, ago) =>
      ({ id, name, icon, currency, ownerId, memberIds, serial, createdAt: t - ago * DAY });
    const spaces = [
      sp('sp_flat', 'Flat 4B', 'home', 'INR', 'u_kabir', ['u_kabir', 'u_swetha', 'u_rohan'], 412, 60),
      sp('sp_goa', 'Goa Trip', 'trip', 'INR', 'u_arun', ['u_kabir', 'u_arun', 'u_swetha', 'u_priya'], 398, 30),
      sp('sp_office', 'Office lunches', 'food', 'INR', 'u_priya', ['u_kabir', 'u_priya', 'u_rohan'], 371, 90),
      sp('sp_dubai', 'Dubai stopover', 'trip', 'USD', 'u_kabir', ['u_kabir', 'u_meera'], 420, 12),
      sp('sp_cricket', 'Sunday cricket', 'friends', 'INR', 'u_arun', ['u_kabir', 'u_arun', 'u_rohan'], 377, 45)
    ];

    const ex = (id, spaceId, description, amountMinor, paidBy, splitType, shares, createdBy, ago) =>
      ({ id, spaceId, description, amountMinor, paidBy, splitType, shares, createdBy, date: t - ago * DAY, updatedAt: t - ago * DAY });
    const sh = (userId, amountMinor, response, input) => ({ userId, amountMinor, response, input: input ?? null });

    const expenses = [
      ex('e_groc', 'sp_flat', 'Groceries — DMart', 234000, 'u_rohan', 'equal',
        [sh('u_kabir', 78000, 'accepted'), sh('u_swetha', 78000, 'accepted'), sh('u_rohan', 78000, 'accepted')], 'u_rohan', 6),
      ex('e_wifi', 'sp_flat', 'Wi-Fi bill', 118000, 'u_kabir', 'equal',
        [sh('u_kabir', 39334, 'accepted'), sh('u_swetha', 39333, 'accepted'), sh('u_rohan', 39333, 'accepted')], 'u_kabir', 4),
      ex('e_toit', 'sp_flat', 'Dinner at Toit', 144000, 'u_swetha', 'equal',
        [sh('u_kabir', 48000, 'pending'), sh('u_swetha', 48000, 'accepted'), sh('u_rohan', 48000, 'accepted')], 'u_swetha', 0.1),
      ex('e_villa', 'sp_goa', 'Villa booking, Anjuna', 1840000, 'u_kabir', 'shares',
        [sh('u_kabir', 368000, 'accepted', 1), sh('u_arun', 736000, 'accepted', 2), sh('u_swetha', 368000, 'accepted', 1), sh('u_priya', 368000, 'accepted', 1)], 'u_kabir', 21),
      ex('e_scoot', 'sp_goa', 'Scooter rentals', 360000, 'u_arun', 'equal',
        [sh('u_kabir', 90000, 'accepted'), sh('u_arun', 90000, 'accepted'), sh('u_swetha', 90000, 'accepted'), sh('u_priya', 90000, 'accepted')], 'u_arun', 19),
      ex('e_shack', 'sp_goa', 'Beach shack lunch', 268000, 'u_swetha', 'exact',
        [sh('u_kabir', 70000, 'accepted', 700), sh('u_arun', 82000, 'accepted', 820), sh('u_swetha', 56000, 'accepted', 560), sh('u_priya', 60000, 'rejected', 600)], 'u_swetha', 18),
      ex('e_lunch', 'sp_office', 'Team lunch — Meghana Foods', 180000, 'u_priya', 'equal',
        [sh('u_kabir', 60000, 'accepted'), sh('u_priya', 60000, 'accepted'), sh('u_rohan', 60000, 'accepted')], 'u_priya', 11),
      ex('e_taxi', 'sp_dubai', 'Airport taxi', 7000, 'u_kabir', 'percent',
        [sh('u_kabir', 3500, 'accepted', 50), sh('u_meera', 3500, 'accepted', 50)], 'u_kabir', 3),
      ex('e_ground', 'sp_cricket', 'Ground booking', 80000, 'u_arun', 'equal',
        [sh('u_kabir', 40000, 'accepted'), sh('u_arun', 40000, 'accepted')], 'u_arun', 8),
      ex('e_ball', 'sp_cricket', 'New ball and tape', 80000, 'u_kabir', 'equal',
        [sh('u_kabir', 40000, 'accepted'), sh('u_rohan', 40000, 'accepted')], 'u_kabir', 7)
    ];

    const st = (id, spaceId, fromUserId, toUserId, amountMinor, status, ago, answeredAgo) =>
      ({ id, spaceId, fromUserId, toUserId, amountMinor, status, date: t - ago * DAY, answeredAt: answeredAgo == null ? null : t - answeredAgo * DAY });
    const settlements = [
      st('st_sw', 'sp_goa', 'u_swetha', 'u_kabir', 368000, 'confirmed', 14, 13),
      st('st_pr', 'sp_goa', 'u_priya', 'u_kabir', 200000, 'pending', 0.2, null),
      st('st_k1', 'sp_office', 'u_kabir', 'u_priya', 60000, 'confirmed', 10, 9),
      st('st_r1', 'sp_office', 'u_rohan', 'u_priya', 60000, 'confirmed', 10, 10)
    ];

    const nt = (userId, type, refId, spaceId, needsAnswer, read, ago, extra) =>
      Object.assign({ id: uid('n'), userId, type, refId, spaceId, needsAnswer, read, createdAt: t - ago * DAY }, extra || {});
    const notifications = [
      nt('u_kabir', 'expense_share', 'e_toit', 'sp_flat', true, false, 0.1),
      nt('u_kabir', 'payment_to_confirm', 'st_pr', 'sp_goa', true, false, 0.2),
      nt('u_kabir', 'reminder', null, 'sp_cricket', false, false, 1, { toUserId: 'u_arun', amountMinor: 40000 }),
      nt('u_kabir', 'payment_answered', 'st_k1', 'sp_office', false, true, 9, { verdict: 'confirmed' }),
      nt('u_kabir', 'added_to_space', null, 'sp_goa', false, true, 30, { byUserId: 'u_arun' }),
      nt('u_swetha', 'share_rejected', 'e_shack', 'sp_goa', false, false, 17, { byUserId: 'u_priya' }),
      nt('u_meera', 'added_to_space', null, 'sp_dubai', false, false, 12, { byUserId: 'u_kabir' })
    ];

    return {
      version: 1, users, spaces, expenses, settlements, notifications,
      session: { userId: null },
      prefs: { defaultCurrency: 'INR', theme: 'system', notificationsOn: true },
      debug: { simulateErrors: false, offline: false }
    };
  }

  let db;
  function load() {
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
    if (!db || db.version !== 1) { db = seed(); save(); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* storage unavailable: keep in memory */ } }
  function reset() { const keepTheme = db && db.prefs.theme; db = seed(); if (keepTheme) db.prefs.theme = keepTheme; save(); }

  /* ---------- formatting ---------- */
  function money(minor, currency, opts) {
    opts = opts || {};
    const c = CURRENCIES[currency] || CURRENCIES.INR;
    const value = Math.abs(minor) / 100;
    const whole = Math.abs(minor) % 100 === 0;
    const digits = opts.compact && whole ? 0 : 2;
    const n = new Intl.NumberFormat(c.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
    const sym = c.symbol.length > 1 ? c.symbol + ' ' : c.symbol;
    return (minor < 0 && opts.signed ? '–' : '') + sym + n;
  }
  function relDate(ts) {
    const d = new Date(ts), today = new Date();
    const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((start(today) - start(d)) / DAY);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }).replace(/ /g, '\u00a0');
  }
  function fullDate(ts) { return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }).replace(/ /g, '\u00a0'); }
  function monthKey(ts) { return new Date(ts).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); }
  function splitPhone(e164) {
    const c = COUNTRIES.slice().sort((a, b) => b.dial.length - a.dial.length).find((x) => e164.startsWith(x.dial));
    const dial = c ? c.dial : '';
    return { dial, nat: e164.slice(dial.length) };
  }
  function maskPhone(e164) {
    const { dial, nat } = splitPhone(e164);
    return dial + ' ' + nat.slice(0, 2) + '*'.repeat(Math.max(0, nat.length - 4)) + nat.slice(-2);
  }
  function prettyPhone(e164) {
    const { dial, nat } = splitPhone(e164);
    return dial + ' ' + (nat.length === 10 ? nat.slice(0, 5) + ' ' + nat.slice(5) : nat);
  }
  function serial(n) { return 'NO. ' + String(n).padStart(4, '0'); }

  /* ---------- lookups ---------- */
  const user = (id) => db.users.find((u) => u.id === id);
  const space = (id) => db.spaces.find((s) => s.id === id);
  const expense = (id) => db.expenses.find((e) => e.id === id);
  const settlement = (id) => db.settlements.find((s) => s.id === id);
  const me = () => user(db.session.userId);
  const first = (id) => (user(id) ? user(id).name.split(' ')[0] : 'Someone');
  const isDisputed = (e) => e.shares.some((s) => s.response === 'rejected');
  const spacesFor = (userId) => db.spaces.filter((s) => s.memberIds.includes(userId));

  /* ---------- balances: one calculator, read by every screen ---------- */
  function pairwise(spaceId) {
    const m = {}; // m[a][b] = amount a owes b (minor units)
    const add = (a, b, v) => { m[a] = m[a] || {}; m[a][b] = (m[a][b] || 0) + v; };
    db.expenses.filter((e) => e.spaceId === spaceId && !isDisputed(e)).forEach((e) => {
      e.shares.forEach((s) => { if (s.userId !== e.paidBy) add(s.userId, e.paidBy, s.amountMinor); });
    });
    db.settlements.filter((s) => s.spaceId === spaceId && s.status === 'confirmed').forEach((s) => add(s.fromUserId, s.toUserId, -s.amountMinor));
    return (a, b) => ((m[b] && m[b][a]) || 0) - ((m[a] && m[a][b]) || 0); // > 0: b owes a
  }
  function spaceBalance(spaceId, viewerId) {
    const sp = space(spaceId);
    const f = pairwise(spaceId);
    const pairs = sp.memberIds.filter((id) => id !== viewerId).map((id) => ({ userId: id, net: f(viewerId, id) }));
    const open = pairs.filter((p) => p.net !== 0);
    const owe = -open.filter((p) => p.net < 0).reduce((a, p) => a + p.net, 0);
    const owed = open.filter((p) => p.net > 0).reduce((a, p) => a + p.net, 0);
    return { pairs, open, owe, owed, net: owed - owe, currency: sp.currency, settled: open.length === 0 };
  }
  function pendingTo(spaceId, fromId, toId) {
    return db.settlements.filter((s) => s.spaceId === spaceId && s.fromUserId === fromId && s.toUserId === toId && s.status === 'pending')
      .reduce((a, s) => a + s.amountMinor, 0);
  }
  function overall(viewerId) {
    const by = {};
    spacesFor(viewerId).forEach((s) => {
      const b = spaceBalance(s.id, viewerId);
      by[b.currency] = by[b.currency] || { owe: 0, owed: 0 };
      by[b.currency].owe += b.owe; by[b.currency].owed += b.owed;
    });
    return by;
  }

  /* ---------- split maths (integer minor units, leftovers handed out in member order) ---------- */
  function distribute(total, raw) {
    const base = raw.map(Math.floor);
    let left = total - base.reduce((a, b) => a + b, 0);
    for (let i = 0; left > 0 && base.length; i = (i + 1) % base.length, left--) base[i]++;
    return base;
  }
  function computeSplit(totalMinor, type, rows) {
    const n = rows.length;
    const zero = rows.map(() => 0);
    if (!n || !(totalMinor > 0)) return { ok: false, amounts: zero, left: 0 };
    if (type === 'equal') return { ok: true, amounts: distribute(totalMinor, rows.map(() => totalMinor / n)), left: 0 };
    if (type === 'exact') {
      const amts = rows.map((r) => Math.round((parseFloat(r.input) || 0) * 100));
      const left = totalMinor - amts.reduce((a, b) => a + b, 0);
      return { ok: left === 0 && amts.every((a) => a >= 0), amounts: amts, left };
    }
    if (type === 'percent') {
      const pcts = rows.map((r) => Math.max(0, parseFloat(r.input) || 0));
      const sum = Math.round(pcts.reduce((a, b) => a + b, 0) * 100) / 100;
      const ok = Math.abs(sum - 100) < 0.001;
      const raw = pcts.map((p) => (totalMinor * p) / 100);
      return { ok, amounts: ok ? distribute(totalMinor, raw) : raw.map(Math.floor), left: Math.round((100 - sum) * 100) / 100 };
    }
    const w = rows.map((r) => Math.max(0, parseInt(r.input, 10) || 0));
    const sw = w.reduce((a, b) => a + b, 0);
    if (!sw) return { ok: false, amounts: zero, left: 0 };
    return { ok: true, amounts: distribute(totalMinor, w.map((x) => (totalMinor * x) / sw)), left: 0, totalShares: sw };
  }

  /* ---------- notifications ---------- */
  function notify(userId, type, refId, spaceId, needsAnswer, extra) {
    db.notifications.unshift(Object.assign({ id: uid('n'), userId, type, refId, spaceId, needsAnswer, read: false, createdAt: now() }, extra || {}));
  }
  function resolveNotif(refId, userId) {
    db.notifications.forEach((n) => { if (n.refId === refId && (!userId || n.userId === userId) && n.needsAnswer) { n.needsAnswer = false; n.read = true; } });
  }
  function notifText(n) {
    const sp = space(n.spaceId);
    const e = n.refId && expense(n.refId);
    const s = n.refId && settlement(n.refId);
    const cur = sp ? sp.currency : 'INR';
    const m = (v) => money(v, cur, { compact: true });
    switch (n.type) {
      case 'expense_share': {
        if (!e) return { title: 'An expense was removed', sub: sp ? sp.name : '' };
        const mine = e.shares.find((x) => x.userId === n.userId);
        return { title: first(e.createdBy) + ' added ‘' + e.description + '’', pre: 'Your share is ', fig: m(mine ? mine.amountMinor : 0), post: ' · ' + sp.name };
      }
      case 'share_rejected': {
        const r = e && e.shares.find((x) => x.userId === n.byUserId);
        return { title: first(n.byUserId) + ' rejected their ' + (r ? m(r.amountMinor) + ' ' : '') + 'share', sub: (e ? '‘' + e.description + '’ · ' : '') + (sp ? sp.name : '') };
      }
      case 'payment_to_confirm':
        return s ? { title: first(s.fromUserId) + ' says they paid you', pre: '', fig: m(s.amountMinor), post: ' · ' + sp.name } : { title: 'A payment was cancelled', sub: sp ? sp.name : '' };
      case 'payment_answered':
        return { title: (s ? first(s.toUserId) : 'They') + ' ' + n.verdict + ' your ' + (s ? m(s.amountMinor) + ' ' : '') + 'payment', sub: sp ? sp.name : '' };
      case 'added_to_space':
        return { title: first(n.byUserId) + ' added you to ‘' + (sp ? sp.name : n.spaceName) + '’', sub: sp ? sp.memberIds.length + ' people' : '' };
      case 'space_deleted':
        return { title: first(n.byUserId) + ' deleted ‘' + n.spaceName + '’', sub: 'Everyone was settled up' };
      case 'reminder':
        return { title: 'You owe ' + first(n.toUserId) + ' ' + m(n.amountMinor), sub: (sp ? sp.name : '') + ' · tap to settle up' };
      default: return { title: 'Update', sub: '' };
    }
  }

  /* ---------- actions ---------- */
  const A = {
    signIn(username, password) {
      const u = db.users.find((x) => x.username === username.trim().toLowerCase());
      if (!u || u.password !== password) return { error: 'Username or password is incorrect' };
      db.session.userId = u.id; save(); return { ok: true };
    },
    signOut() { db.session.userId = null; save(); },
    usernameTaken(name) { return db.users.some((u) => u.username === name.trim().toLowerCase()); },
    phoneTaken(e164) { return db.users.some((u) => u.phone === e164); },
    createAccount(data) {
      const u = { id: uid('u'), username: data.username.toLowerCase(), name: data.name.trim(), phone: data.phone, password: data.password, phoneVerified: true, avatar: null, furniture: (db.users.length % 6) + 1 };
      db.users.push(u); db.session.userId = u.id;
      const c = COUNTRIES.find((x) => data.phone.startsWith(x.dial));
      db.prefs.defaultCurrency = c ? c.currency : 'INR';
      save(); return u;
    },
    findByUsername(name) { return db.users.find((u) => u.username === name.trim().toLowerCase()); },
    resetPassword(userId, pw) { user(userId).password = pw; save(); },
    search(q, exclude) {
      q = q.trim().toLowerCase();
      if (!q) return [];
      const digits = q.replace(/[\s-]/g, '');
      if (/^\+?\d+$/.test(digits)) {
        const own = (me() && splitPhone(me().phone).dial) || '+91';
        const full = digits.startsWith('+') ? digits : own + digits;
        return db.users.filter((u) => u.phone === full && !exclude.includes(u.id));
      }
      return db.users.filter((u) => u.username.startsWith(q.replace(/^@/, '')) && !exclude.includes(u.id));
    },
    createSpace(name, icon, currency, memberIds) {
      const s = { id: uid('sp'), name: name.trim(), icon, currency, ownerId: me().id, memberIds: [me().id].concat(memberIds), serial: 421 + db.spaces.length, createdAt: now() };
      db.spaces.push(s);
      memberIds.forEach((id) => notify(id, 'added_to_space', null, s.id, false, { byUserId: me().id }));
      save(); return s;
    },
    updateSpace(id, patch) { Object.assign(space(id), patch); save(); },
    addMembers(id, ids) {
      const s = space(id);
      ids.forEach((m) => { if (!s.memberIds.includes(m)) { s.memberIds.push(m); notify(m, 'added_to_space', null, id, false, { byUserId: me().id }); } });
      save();
    },
    removeMember(id, userId) { const s = space(id); s.memberIds = s.memberIds.filter((m) => m !== userId); save(); },
    leaveSpace(id) { A.removeMember(id, me().id); },
    deleteSpace(id) {
      const s = space(id);
      s.memberIds.filter((m) => m !== me().id).forEach((m) => notify(m, 'space_deleted', null, null, false, { byUserId: me().id, spaceName: s.name }));
      db.spaces = db.spaces.filter((x) => x.id !== id);
      db.expenses = db.expenses.filter((e) => e.spaceId !== id);
      db.settlements = db.settlements.filter((x) => x.spaceId !== id);
      db.notifications = db.notifications.filter((n) => n.spaceId !== id);
      save();
    },
    saveExpense(data, existingId) {
      const creator = existingId ? expense(existingId).createdBy : me().id;
      let e;
      if (existingId) {
        e = expense(existingId);
        db.notifications = db.notifications.filter((n) => !(n.refId === e.id && n.type === 'expense_share'));
        Object.assign(e, data, { updatedAt: now() });
      } else {
        e = Object.assign({ id: uid('e'), createdBy: creator, updatedAt: now() }, data);
        db.expenses.push(e);
      }
      e.shares.forEach((s) => { s.response = (s.userId === e.paidBy || s.userId === creator) ? 'accepted' : 'pending'; });
      e.shares.filter((s) => s.response === 'pending').forEach((s) => notify(s.userId, 'expense_share', e.id, e.spaceId, true));
      save(); return e;
    },
    deleteExpense(id) { db.expenses = db.expenses.filter((e) => e.id !== id); db.notifications = db.notifications.filter((n) => n.refId !== id); save(); },
    answerShare(expenseId, userId, accept) {
      const e = expense(expenseId); const s = e.shares.find((x) => x.userId === userId);
      s.response = accept ? 'accepted' : 'rejected';
      resolveNotif(expenseId, userId);
      if (!accept) notify(e.createdBy, 'share_rejected', e.id, e.spaceId, false, { byUserId: userId });
      save();
    },
    recordPayment(spaceId, toUserId, amountMinor) {
      const s = { id: uid('st'), spaceId, fromUserId: me().id, toUserId, amountMinor, status: 'pending', date: now(), answeredAt: null };
      db.settlements.push(s);
      notify(toUserId, 'payment_to_confirm', s.id, spaceId, true);
      save(); return s;
    },
    answerPayment(id, confirm) {
      const s = settlement(id); s.status = confirm ? 'confirmed' : 'rejected'; s.answeredAt = now();
      resolveNotif(id, s.toUserId);
      notify(s.fromUserId, 'payment_answered', s.id, s.spaceId, false, { verdict: confirm ? 'confirmed' : 'rejected' });
      save();
    },
    cancelPayment(id) {
      const s = settlement(id); s.status = 'cancelled'; s.answeredAt = now();
      db.notifications = db.notifications.filter((n) => !(n.refId === id && n.type === 'payment_to_confirm'));
      save();
    },
    markRead(id) { const n = db.notifications.find((x) => x.id === id); if (n) n.read = true; save(); },
    markAllRead() { db.notifications.forEach((n) => { if (n.userId === me().id) n.read = true; }); save(); },
    updateProfile(patch) { Object.assign(me(), patch); save(); },
    setPref(k, v) { db.prefs[k] = v; save(); },
    setDebug(k, v) { db.debug[k] = v; save(); },
    actAs(userId) { db.session.userId = userId; save(); }
  };

  load();
  window.UOMi = {
    get db() { return db; }, save, reset, A, CURRENCIES, COUNTRIES, ICONS,
    money, relDate, fullDate, monthKey, maskPhone, prettyPhone, splitPhone, serial,
    user, space, expense, settlement, me, first, isDisputed, spacesFor,
    spaceBalance, pendingTo, overall, computeSplit, notifText
  };
})();
