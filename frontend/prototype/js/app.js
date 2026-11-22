/* UOMi prototype — screens, navigation, motion. Reads and writes only through window.UOMi (data.js). */
(function () {
  const U = window.UOMi;
  const A = U.A;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const screensEl = $('#screens'), tabbarEl = $('#tabbar'), deviceEl = $('#device');

  /* ---------- icons: one authored stroke set ---------- */
  const P = {
    home: '<path d="M4 10.5L12 4l8 6.5V20h-5v-6H9v6H4z"/>',
    bell: '<path d="M6 16v-5a6 6 0 0112 0v5l1.5 2h-15zM10 20.5h4"/>',
    receipt: '<path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2zM9 8.5h6M9 12.5h6"/>',
    user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    chev: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M3 3l18 18M10.6 6.1A9.6 9.6 0 0112 6c6 0 9.5 6 9.5 6a16 16 0 01-3.2 3.8M6.2 7.7A16 16 0 002.5 12S6 18 12 18c1.6 0 3-.4 4.2-1"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
    users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5c.9-3 3.4-4.8 6.5-4.8s5.6 1.8 6.5 4.8M16 5.2a3.5 3.5 0 010 6.6M18 14.9c1.7.6 3 2.2 3.5 4.6"/>',
    logout: '<path d="M14 4.5H6.5v15H14M10.5 12h10M17 8.5l3.5 3.5-3.5 3.5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    moon: '<path d="M19.5 14.5A8 8 0 019.5 4.5a8 8 0 1010 10z"/>',
    lock: '<path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 017 0v3"/>',
    alert: '<path d="M12 4l9 16H3zM12 10v4.5M12 17.5v.5"/>',
    wifioff: '<path d="M3 3l18 18M8.5 16.5a5 5 0 017 0M5 12.5a10 10 0 015.5-2.9M19 12.5a10 10 0 00-2.4-1.7M12 20h.01"/>',
    trip: '<path d="M2.5 13.5l19-8-5.5 15-3-6.5zM13 14l8.5-8.5"/>',
    food: '<path d="M3.5 11h17a8.5 8.5 0 01-17 0zM8 7.5c0-1.5 1-1.5 1-3M12 7.5c0-1.5 1-1.5 1-3M16 7.5c0-1.5 1-1.5 1-3"/>',
    office: '<path d="M3.5 8h17v11h-17zM9 8V5.5h6V8M3.5 12.5c5 2 12 2 17 0"/>',
    friends: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5c.9-3 3.4-4.8 6.5-4.8s5.6 1.8 6.5 4.8M16 5.2a3.5 3.5 0 010 6.6M18 14.9c1.7.6 3 2.2 3.5 4.6"/>',
    car: '<path d="M5 16.5v-4l2-5h10l2 5v4zM5 16.5v2h2.5v-2M16.5 16.5v2H19v-2M5 12.5h14"/>',
    party: '<path d="M4 10h16v3H4zM5.5 13v7h13v-7M12 10v10M12 10C9 10 7.5 8.8 7.5 7.3S9.5 5 12 10zM12 10c3 0 4.5-1.2 4.5-2.7S14.5 5 12 10z"/>',
    other: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
    camera: '<path d="M4 8h3.5L9 5.5h6L16.5 8H20v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    more: '<circle cx="12" cy="6" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="18" r="1.2"/>',
    swap: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
    calendar: '<path d="M4.5 6h15v14h-15zM4.5 10h15M8.5 3.5v4M15.5 3.5v4"/>',
    bug: '<path d="M12 6.5v13M5 9h14M7 9v6a5 5 0 0010 0V9M3.5 13H7M17 13h3.5M9 6.5a3 3 0 016 0"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 11-2.2-5.3M19.5 4.5v4h-4"/>'
  };
  const ICON_NAME = { home: 'Home', trip: 'Trip', food: 'Food', office: 'Office', friends: 'Friends', car: 'Car', party: 'Party', other: 'Other' };
  const ic = (n, cls) => `<svg class="i ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || P.other}</svg>`;

  /* ---------- small helpers ---------- */
  const m = (minor, cur, compact) => U.money(minor, cur, { compact: compact !== false });
  const initials = (u) => u.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const plate = (u, lg) => u ? `<span class="plate${lg ? ' lg' : ''}" style="--m: var(--m${u.furniture})" aria-hidden="true">${u.avatar ? `<img src="${u.avatar}" alt="">` : esc(initials(u))}</span>` : '';
  const youOr = (id) => (id === U.me().id ? 'You' : U.first(id));
  const balPhrase = (b, compact) => {
    if (b.settled) return { cls: 'muted', text: 'Settled up', sub: '' };
    const people = b.open.length;
    const who = (list) => (list.length === 1 ? U.first(list[0].userId) : list.length + ' people');
    if (b.owe && b.owed && b.net === 0) return { cls: 'muted', text: m(0, b.currency) + ' net', sub: people + ' open balances' };
    if (b.net < 0) return { cls: 'owe', text: 'You owe ' + m(-b.net, b.currency, compact), sub: who(b.open.filter((p) => p.net < 0)) };
    return { cls: 'owed', text: 'You’re owed ' + m(b.net, b.currency, compact), sub: who(b.open.filter((p) => p.net > 0)) };
  };
  const stagger = (html, i) => html.replace(/^<(\w+)/, `<$1 style="--i:${i}"`);
  const loaded = {};
  function focusKey(el) {
    if (!el || !el.closest || !el.closest('#device')) return null;
    if (el.id) return '#' + CSS.escape(el.id);
    if (el.matches('h1, .appbar .title')) return ':is(h1, .appbar .title)';
    const attrs = ['data-act', 'data-go', 'data-tab', 'data-type', 'data-tog', 'data-in', 'data-ico', 'data-k', 'data-v', 'data-id', 'data-yes'];
    const sel = attrs.filter((a) => el.hasAttribute(a)).map((a) => `[${a}="${CSS.escape(el.getAttribute(a))}"]`).join('');
    return sel || null;
  }
  function refocus(key) { if (!key) return; const t = document.querySelector('#device ' + key); if (!t || t.disabled) return; if (!t.matches('button, input, select, textarea, a, [tabindex]')) t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true }); }
  function needsSkeleton(key) { if (loaded[key]) return false; loaded[key] = true; setTimeout(refresh, 480); return true; }
  const skelRows = (n) => `<div class="sheet rows">${Array.from({ length: n }, () => `<div class="row"><div class="main"><div class="skel" style="width:55%"></div><div class="skel" style="width:30%;margin-top:8px;height:11px"></div></div><div class="skel" style="width:80px"></div></div>`).join('')}</div>`;
  const offlineBanner = () => (U.db.debug.offline ? `<div class="banner">${ic('wifioff', 'sm')} You’re offline — showing last saved data</div>` : '');
  const errorBox = () => `<div class="state-box">${ic('alert', 'lg')}<h3>Couldn’t load this</h3><p>The connection dropped while loading. Your data is safe.</p><button class="btn secondary" data-act="retry" style="width:auto;margin-top:8px">${ic('refresh', 'sm')} Retry</button></div>`;
  function guardOffline() { if (U.db.debug.offline) { toast('You’re offline — try again when you’re connected'); return true; } return false; }

  /* ---------- theme ---------- */
  function applyTheme() {
    const pref = U.db.prefs.theme;
    const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $$('[data-pc-theme]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pcTheme === pref)));
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  /* ---------- toast ---------- */
  function toast(msg) {
    const host = $('#toasts');
    host.style.bottom = tabbarEl.classList.contains('hidden') ? 'calc(var(--safe-bottom) + 84px)' : '';
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    host.innerHTML = ''; host.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('in')));
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 200); }, Math.max(3500, msg.length * 70));
  }

  /* ---------- overlays ---------- */
  let overlayStack = [];
  function syncInert() { const on = overlayStack.length > 0; screensEl.inert = on; tabbarEl.inert = on; }
  function openOverlay(inner, kind, onClose) {
    const o = document.createElement('div');
    o.className = 'overlay';
    o.innerHTML = `<div class="scrim" data-close></div>${inner}`;
    deviceEl.appendChild(o);
    const prevFocus = document.activeElement; const prevKey = focusKey(prevFocus);
    requestAnimationFrame(() => requestAnimationFrame(() => o.classList.add('open')));
    const close = () => new Promise((res) => {
      o.classList.remove('open');
      overlayStack = overlayStack.filter((x) => x.el !== o); syncInert();
      if (onClose) { const f = onClose; onClose = null; f(); }
      setTimeout(() => { o.remove(); if (prevFocus && prevFocus.isConnected) prevFocus.focus({ preventScroll: true }); else refocus(prevKey); res(); }, kind === 'sheet' ? 320 : 200);
    });
    o.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
    overlayStack.push({ el: o, close }); syncInert();
    setTimeout(() => { const f = o.querySelector('[autofocus], input, button:not([data-close])'); if (f) f.focus({ preventScroll: true }); }, 60);
    return { el: o, close };
  }
  function confirmDialog({ title, body, ok, danger, cancel }) {
    return new Promise((res) => {
      let done = false; const finish = (v) => { if (!done) { done = true; res(v); } };
      const d = openOverlay(`<div class="dialog sheet" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t" ${body ? 'aria-describedby="dlg-b"' : ''}>
        <h2 id="dlg-t">${esc(title)}</h2>${body ? `<p id="dlg-b">${esc(body)}</p>` : ''}
        <div class="acts"><button class="text-btn" data-r="0">${esc(cancel || 'Cancel')}</button><button class="text-btn${danger ? ' danger' : ''}" data-r="1">${esc(ok)}</button></div></div>`, 'dialog', () => finish(false));
      d.el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-r]'); if (b) { finish(b.dataset.r === '1'); d.close(); }
      });
    });
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlayStack.length) overlayStack[overlayStack.length - 1].close(); });

  /* ---------- router ---------- */
  const TABS = ['home', 'notifs', 'trans', 'profile'];
  let stack = [];
  let dirty = false;
  const R = {};

  function build(entry) {
    const s = R[entry.name](entry.params || {});
    const el = document.createElement('section');
    el.className = 'screen' + (s.tabs ? ' has-tabs' : '') + (s.fab ? ' has-fab' : '');
    el.dataset.route = entry.name;
    el.innerHTML = s.html;
    el._s = s;
    return el;
  }
  function setTabs(entry) {
    const show = TABS.includes(entry.name);
    tabbarEl.classList.toggle('hidden', !show);
    if (show) renderTabbar(entry.name);
  }
  function mount(el) { if (el._s.mount) el._s.mount(el); }
  function announceScreen(el) {
    const h = el.querySelector('h1, .appbar .title, .wordmark');
    const name = h ? h.textContent.trim() : 'UOMi';
    document.title = name + ' \u2014 UOMi prototype';
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  function go(name, params, mode) {
    mode = mode || 'push';
    if (overlayStack.length) overlayStack.forEach((o) => o.close());
    const entry = { name, params: params || {} };
    const old = screensEl.lastElementChild;
    if (mode === 'push') { stack.push(entry); history.pushState({ d: stack.length }, ''); }
    else if (mode === 'root') { stack = [entry]; history.replaceState({ d: 1 }, ''); }
    else { stack[stack.length - 1] = entry; }
    dirty = false;
    const el = build(entry);
    screensEl.appendChild(el); mount(el); setTabs(entry);
    transition(old, el, mode === 'push' ? 'push' : 'fade');
    if (!el.querySelector('[autofocus]')) announceScreen(el);
  }
  function transition(old, el, mode) {
    if (!old) return;
    const r = reduce();
    const D = r ? 180 : 320, E = 'cubic-bezier(0.32, 0.72, 0, 1)';
    old.classList.add('is-under');
    if (mode === 'push' && !r) {
      el.animate([{ transform: 'translateX(100%)', boxShadow: '0 0 0 rgba(0,0,0,0)' }, { transform: 'translateX(0)', boxShadow: '-12px 0 32px rgba(17,20,33,.14)' }], { duration: D, easing: E });
      old.animate([{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(-24%)', opacity: .6 }], { duration: D, easing: E, fill: 'forwards' });
    } else if (mode === 'pop' && !r) {
      el.animate([{ transform: 'translateX(-24%)', opacity: .6 }, { transform: 'translateX(0)', opacity: 1 }], { duration: D, easing: E });
      old.animate([{ transform: getComputedStyle(old).transform === 'none' ? 'translateX(0)' : getComputedStyle(old).transform }, { transform: 'translateX(100%)' }], { duration: D, easing: E, fill: 'forwards' });
    } else {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: r ? 160 : 200, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    }
    setTimeout(() => old.remove(), D);
  }
  async function back(fromGesture) {
    if (overlayStack.length) { overlayStack[overlayStack.length - 1].close(); history.pushState({ d: stack.length }, ''); return; }
    if (stack.length <= 1) return;
    if (dirty && !fromGesture) {
      history.pushState({ d: stack.length }, '');
      const ok = await confirmDialog({ title: 'Discard changes?', body: 'What you’ve typed here will be lost.', ok: 'Discard', danger: true, cancel: 'Keep editing' });
      if (!ok) return;
      dirty = false; history.back(); return;
    }
    const old = screensEl.lastElementChild;
    stack.pop();
    const entry = stack[stack.length - 1];
    const el = build(entry);
    screensEl.insertBefore(el, old); mount(el); setTabs(entry);
    if (fromGesture === 'done') { old.remove(); return; }
    transition(old, el, 'pop');
    announceScreen(el);
  }
  window.addEventListener('popstate', () => { if (skipNextPop) { skipNextPop = false; return; } back(); });
  const uiBack = () => { if (stack.length > 1) history.back(); };
  function refresh(keepScroll) {
    const old = screensEl.lastElementChild; if (!old) return;
    const fk = focusKey(document.activeElement);
    const sc = old.querySelector('.scroll'); const top = sc ? sc.scrollTop : 0;
    const entry = stack[stack.length - 1];
    if (!R[entry.name]) return;
    const el = build(entry);
    old.replaceWith(el); mount(el); setTabs(entry);
    const ns = el.querySelector('.scroll'); if (ns && keepScroll !== false) ns.scrollTop = top;
    renderBadges(); refocus(fk);
  }
  function tab(name) {
    if (stack[stack.length - 1].name === name) { const sc = $('.scroll', screensEl.lastElementChild); if (sc) sc.scrollTo({ top: 0, behavior: reduce() ? 'auto' : 'smooth' }); return; }
    go(name, {}, 'root');
  }

  /* edge-swipe back (iOS) — follows the finger, commits past 35% */
  (function edgeSwipe() {
    let sx = 0, active = false, el = null, under = null, w = 390;
    deviceEl.addEventListener('pointerdown', (e) => {
      const rect = deviceEl.getBoundingClientRect();
      if (e.clientX - rect.left > 22 || stack.length <= 1 || overlayStack.length || TABS.includes(stack[stack.length - 1].name)) return;
      active = true; sx = e.clientX; w = rect.width; el = screensEl.lastElementChild; under = null;
    });
    deviceEl.addEventListener('pointermove', (e) => {
      if (!active) return;
      const dx = Math.max(0, e.clientX - sx);
      if (!under && dx > 6) {
        under = build(stack[stack.length - 2]); under.classList.add('is-under');
        screensEl.insertBefore(under, el); mount(under);
      }
      if (under) {
        el.style.transform = `translateX(${dx}px)`; el.style.boxShadow = '-12px 0 32px rgba(17,20,33,.14)';
        under.style.transform = `translateX(${-0.24 * (w - dx)}px)`; under.style.opacity = String(0.6 + 0.4 * dx / w);
      }
    });
    const end = (e) => {
      if (!active) return; active = false;
      if (!under) return;
      const dx = Math.max(0, e.clientX - sx);
      const commit = dx > w * 0.35;
      const D = 240, E = 'cubic-bezier(0.32, 0.72, 0, 1)';
      el.animate([{ transform: `translateX(${dx}px)` }, { transform: commit ? 'translateX(100%)' : 'translateX(0)' }], { duration: D, easing: E, fill: 'forwards' });
      under.animate([{ transform: under.style.transform, opacity: under.style.opacity }, { transform: commit ? 'translateX(0)' : 'translateX(-24%)', opacity: commit ? 1 : .6 }], { duration: D, easing: E, fill: 'forwards' });
      const u = under, top = el;
      setTimeout(() => {
        if (commit) {
          top.remove();
          u.getAnimations().forEach((a) => a.cancel());
          u.style.transform = ''; u.style.opacity = ''; u.classList.remove('is-under');
          stack.pop(); setTabs(stack[stack.length - 1]); dirty = false;
          skipNextPop = true; history.back();
        } else { u.remove(); top.style.transform = ''; top.style.boxShadow = ''; top.getAnimations().forEach((a) => a.cancel()); }
      }, D);
    };
    deviceEl.addEventListener('pointerup', end);
    deviceEl.addEventListener('pointercancel', end);
  })();
  let skipNextPop = false;

  /* ---------- tab bar ---------- */
  function unreadCount() { const me = U.me(); return me ? U.db.notifications.filter((n) => n.userId === me.id && !n.read).length : 0; }
  function renderTabbar(active) {
    const unread = unreadCount();
    const t = (id, icon, label) => `<button class="tab" data-tab="${id}" ${active === id ? 'aria-current="page"' : ''} aria-label="${label}${id === 'notifs' && unread ? ', ' + unread + ' unread' : ''}"><span class="ind"></span>${ic(icon)}${id === 'notifs' && unread ? '<span class="dot"></span>' : ''}${label}</button>`;
    tabbarEl.innerHTML = t('home', 'home', 'Home') + t('notifs', 'bell', 'Notifications') + t('trans', 'receipt', 'Transactions') + t('profile', 'user', 'Profile');
  }
  function renderBadges() { if (!tabbarEl.classList.contains('hidden')) { const fk = focusKey(document.activeElement); renderTabbar(stack[stack.length - 1].name); refocus(fk); } }

  const appbar = (title, actions, sub) => `<header class="appbar"><button class="icon-btn" data-back aria-label="${sub ? 'Back to ' + esc(sub) : 'Back'}">${ic('back')}</button><h1 class="title">${esc(title)}</h1>${actions || ''}</header>`;

  /* =====================================================================
     AUTH
     ===================================================================== */
  R.welcome = () => ({
    html: `<div class="scroll" style="display:flex;flex-direction:column;padding-top:40px">
      <p class="wordmark" style="font-size:56px;line-height:60px;letter-spacing:-.03em">UOMi</p>
      <p style="font-size:var(--fs-title);line-height:28px;margin-top:12px;max-width:300px">Shared costs, agreed by everyone in them.</p>
      <div style="margin:44px 0 0 0" aria-hidden="true">
        <div class="sheet perf bill" style="min-height:0;padding:14px">
          <div style="display:flex;justify-content:space-between"><span class="serial">NO. 0412</span><span class="meta">Today</span></div>
          <p style="margin-top:10px;font-weight:400">Dinner at Toit</p>
          <p class="label muted" style="margin-top:2px">Paid by Swetha · split 3 ways</p>
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:48px"><span class="muted">Your share</span><span class="fig" style="font-size:var(--fs-figure);line-height:var(--lh-figure)">₹480</span></div>
          <span class="stamp" style="right:20px;top:44px">Agreed</span>
        </div>
      </div>
      <p class="form-note" style="margin-top:22px">Every expense is copied to the people in it. It only counts once they accept their share.</p>
      <div style="margin-top:auto;padding-top:32px;display:flex;flex-direction:column;gap:12px">
        <button class="btn" data-go="signup">Create account</button>
        <button class="btn secondary" data-go="signin">Sign in</button>
      </div></div>`
  });

  const field = (id, label, input, helper, opts) => {
    const req = opts && opts.req;
    if (!/aria-describedby=/.test(input)) input = input.replace('<input ', `<input aria-describedby="${id}-h" `);
    if (req) input = input.replace('<input ', '<input aria-required="true" ');
    return `<div class="field" id="f-${id}"><label for="${id}">${esc(label)}${req ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>${input}<p class="helper" id="${id}-h" aria-live="polite">${helper || ''}</p></div>`;
  };
  const pw = (id, ac) => `<div class="input-wrap"><input class="input" id="${id}" type="password" autocomplete="${ac}" aria-describedby="${id}-h"><button class="icon-btn" type="button" data-act="eye" data-for="${id}" aria-label="Show password">${ic('eye', 'sm')}</button></div>`;
  function setField(id, msg, ok) {
    const f = $('#f-' + id); if (!f) return;
    f.classList.toggle('invalid', !!msg && !ok);
    const h = $('#' + id + '-h'); h.textContent = msg || ''; h.classList.toggle('ok', !!ok);
    const inp = $('#' + id); if (inp) inp.setAttribute('aria-invalid', String(!!msg && !ok));
  }

  let signupDraft = null;
  R.signup = (p) => {
    const d = p.draft || { username: '', name: '', country: 'IN', nat: '', password: '' };
    const c = U.COUNTRIES.find((x) => x.code === d.country);
    return {
      html: appbar('Create account') + `<div class="scroll"><form class="form" novalidate id="su" style="padding-top:8px">
        ${field('su-user', 'Username', `<input class="input" id="su-user" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(d.username)}" aria-describedby="su-user-h">`, 'You’ll use this to recover your account', { req: 1 })}
        ${field('su-name', 'Name', `<input class="input" id="su-name" autocomplete="name" value="${esc(d.name)}">`, '', { req: 1 })}
        <div class="field" id="f-su-phone"><label for="su-phone">Phone number <span class="req" aria-hidden="true">*</span></label>
          <div class="prefix-wrap"><button type="button" class="prefix-btn" data-act="country" aria-label="${esc(c.code)} ${esc(c.dial)}, ${esc(c.name)}. Change country" aria-haspopup="dialog">${esc(c.code)} ${esc(c.dial)} ${ic('chev', 'sm')}</button>
          <input class="input" id="su-phone" inputmode="tel" autocomplete="tel-national" value="${esc(d.nat)}" aria-describedby="su-phone-h"></div>
          <p class="helper" id="su-phone-h" aria-live="polite">People use it to find you. We’ll text a code to verify it.</p></div>
        ${field('su-pw', 'Password', pw('su-pw', 'new-password'), 'At least 8 characters, with a letter and a number', { req: 1 })}
        ${field('su-pw2', 'Confirm password', pw('su-pw2', 'new-password'), '', { req: 1 })}
        <button class="btn" type="submit">Create account</button>
        <p class="form-note" style="text-align:center">Already have an account? <button type="button" class="text-btn" data-go="signin" data-mode="replace">Sign in</button></p>
      </form></div>`,
      mount(el) {
        const form = $('#su', el); let country = d.country; let t;
        const draft = () => ({ username: $('#su-user', el).value.trim(), name: $('#su-name', el).value, country, nat: $('#su-phone', el).value.replace(/\D/g, ''), password: $('#su-pw', el).value });
        form.addEventListener('input', () => { dirty = true; });
        const checkUser = () => {
          const v = $('#su-user', el).value.trim().toLowerCase();
          if (!v) return setField('su-user', 'You’ll use this to recover your account', true) || false;
          if (!/^[a-z0-9_.]{3,20}$/.test(v)) { setField('su-user', 'Use 3–20 lowercase letters, numbers, _ or .'); return false; }
          if (A.usernameTaken(v)) { setField('su-user', 'That username is taken'); return false; }
          setField('su-user', 'Available', true); return true;
        };
        $('#su-user', el).addEventListener('input', () => { clearTimeout(t); t = setTimeout(checkUser, 400); });
        const checkPhone = () => {
          const cc = U.COUNTRIES.find((x) => x.code === country); const nat = $('#su-phone', el).value.replace(/\D/g, '');
          if (!cc.len.includes(nat.length)) { setField('su-phone', 'Enter a ' + cc.len.join(' or ') + '-digit number for ' + cc.name); return null; }
          const full = cc.dial + nat;
          if (A.phoneTaken(full)) { setField('su-phone', 'This number already has an account'); return null; }
          setField('su-phone', 'We’ll text a code to ' + U.maskPhone(full), true); return full;
        };
        $('#su-phone', el).addEventListener('blur', checkPhone);
        const checkPw = () => { const v = $('#su-pw', el).value; if (v.length < 8 || !/[a-z]/i.test(v) || !/\d/.test(v)) { setField('su-pw', 'At least 8 characters, with a letter and a number'); return false; } setField('su-pw', 'Strong enough', true); return true; };
        $('#su-pw', el).addEventListener('blur', checkPw);
        const checkPw2 = () => { if ($('#su-pw2', el).value !== $('#su-pw', el).value || !$('#su-pw2', el).value) { setField('su-pw2', 'Passwords don’t match'); return false; } setField('su-pw2', '', true); return true; };
        $('#su-pw2', el).addEventListener('blur', checkPw2);
        $('#su-name', el).addEventListener('blur', () => setField('su-name', $('#su-name', el).value.trim() ? '' : 'Enter your name'));
        el._country = (code) => { country = code; const st = stack[stack.length - 1]; st.params = { draft: draft() }; refresh(); };
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const okU = checkUser(), okN = !!$('#su-name', el).value.trim(), full = checkPhone(), okP = checkPw(), okP2 = checkPw2();
          if (!okN) setField('su-name', 'Enter your name');
          if (!(okU && okN && full && okP && okP2)) { const bad = $('.field.invalid .input', el); if (bad) bad.focus(); return; }
          signupDraft = Object.assign(draft(), { phone: full }); dirty = false;
          go('verify', { purpose: 'signup', phone: full });
        });
      }
    };
  };

  function countrySheet(onPick) {
    const list = () => U.COUNTRIES.map((c) => `<button class="row" data-code="${c.code}"><span class="main"><span class="n">${esc(c.name)}</span></span><span class="muted label">${esc(c.dial)}</span></button>`).join('');
    const s = openOverlay(`<div class="bsheet" role="dialog" aria-modal="true" aria-labelledby="cs-h"><div class="grab"></div>
      <div class="bs-h"><h2 id="cs-h">Country</h2><button class="icon-btn" data-close aria-label="Close">${ic('x')}</button></div>
      <div class="bs-body"><div class="input-wrap" style="margin-bottom:8px"><input class="input" id="cs-q" placeholder="Search countries" autocomplete="off"></div><div class="sheet rows" id="cs-list">${list()}</div></div></div>`, 'sheet');
    $('#cs-q', s.el).addEventListener('input', (e) => { const q = e.target.value.toLowerCase(); $$('#cs-list .row', s.el).forEach((r) => { r.hidden = !r.textContent.toLowerCase().includes(q); }); });
    s.el.addEventListener('click', (e) => { const b = e.target.closest('[data-code]'); if (b) { s.close(); onPick(b.dataset.code); } });
  }

  /* shared OTP screen */
  R.verify = (p) => {
    const masked = U.maskPhone(p.phone);
    return {
      html: appbar(p.purpose === 'signup' ? 'Verify your phone' : 'Enter the code') + `<div class="scroll" style="padding-top:8px">
        <p>We sent a 6-digit code to <b>${esc(masked)}</b>.</p>
        <div class="otp" id="otp" role="group" aria-label="6-digit code" style="margin-top:24px">${Array.from({ length: 6 }, (_, i) => `<input inputmode="numeric" maxlength="${i === 0 ? 6 : 1}" ${i === 0 ? 'autocomplete="one-time-code" autofocus' : 'autocomplete="off"'} aria-label="Digit ${i + 1} of 6" aria-describedby="otp-h">`).join('')}</div>
        <p class="helper" id="otp-h" role="alert" style="margin-top:10px"></p>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
          <button class="text-btn" id="resend" disabled>Resend code in 30s</button>
          ${p.purpose === 'signup' ? '<button class="text-btn" data-back>Wrong number? Edit</button>' : ''}
        </div>
        <p class="demo-hint">Demo: the code is always <b>123456</b>.</p></div>`,
      mount(el) {
        const boxes = $$('#otp input', el); let tries = 0; let left = 30;
        const rs = $('#resend', el);
        let tick;
        const startTimer = () => { clearInterval(tick); left = 30; rs.disabled = true; rs.textContent = 'Resend code in 30s'; tick = setInterval(() => { if (!el.isConnected) return clearInterval(tick); left--; if (left <= 0) { rs.disabled = false; rs.textContent = 'Resend code'; clearInterval(tick); } else rs.textContent = 'Resend code in ' + left + 's'; }, 1000); };
        startTimer();
        rs.addEventListener('click', () => { toast('New code sent to ' + masked); startTimer(); });
        const code = () => boxes.map((b) => b.value).join('');
        const fill = (digits) => { digits.split('').slice(0, 6).forEach((d, i) => { boxes[i].value = d; }); boxes[Math.min(digits.length, 5)].focus(); check(); };
        boxes.forEach((b, i) => {
          b.addEventListener('input', () => { const v = b.value.replace(/\D/g, ''); if (v.length > 1) { fill(v); return; } b.value = v; if (b.value && i < 5) boxes[i + 1].focus(); check(); });
          b.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !b.value && i > 0) boxes[i - 1].focus(); });
          b.addEventListener('paste', (e) => { e.preventDefault(); fill((e.clipboardData.getData('text') || '').replace(/\D/g, '')); });
        });
        const grp = $('#otp', el), h = $('#otp-h', el);
        function check() {
          if (code().length < 6) { grp.classList.remove('error'); h.textContent = ''; return; }
          if (code() === '123456') {
            h.textContent = 'Verified'; h.classList.add('ok');
            boxes.forEach((b) => { b.disabled = true; });
            setTimeout(() => {
              if (p.purpose === 'signup') { A.createAccount(signupDraft); signupDraft = null; go('home', {}, 'root'); toast('Welcome to UOMi, ' + U.me().name.split(' ')[0]); }
              else go('reset', { userId: p.userId }, 'replace');
            }, 350);
            return;
          }
          tries++;
          grp.classList.add('error'); grp.classList.remove('shake'); void grp.offsetWidth; grp.classList.add('shake');
          h.textContent = tries >= 5 ? 'Too many attempts — try again in 10 minutes' : 'That code is incorrect';
          h.parentElement && $('#otp-h', el).classList.remove('ok');
          boxes.forEach((b) => b.setAttribute('aria-invalid', 'true'));
          setTimeout(() => { boxes.forEach((b) => { b.value = ''; }); if (tries < 5) boxes[0].focus({ preventScroll: true }); else boxes.forEach((b) => { b.disabled = true; }); }, 1200);
        }
      }
    };
  };

  R.signin = (p) => ({
    html: appbar('Sign in') + `<div class="scroll"><form class="form" novalidate id="si" style="padding-top:8px">
      ${field('si-user', 'Username', `<input class="input" id="si-user" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(p.username || '')}">`, '')}
      ${field('si-pw', 'Password', pw('si-pw', 'current-password'), '')}
      <div style="margin-top:-12px"><button type="button" class="text-btn" data-go="forgot">Forgot password?</button></div>
      <button class="btn" type="submit" id="si-go">Sign in</button>
      <p class="form-note" style="text-align:center">New here? <button type="button" class="text-btn" data-go="signup" data-mode="replace">Create an account</button></p>
    </form><p class="demo-hint">Demo accounts: <b>kabir.r</b>, swetha.i, arun.n, meera.s, rohan.d, priya.m — password <b>demo1234</b>.</p></div>`,
    mount(el) {
      $('#si', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const b = $('#si-go', el); b.disabled = true; b.innerHTML = '<span class="spin" aria-hidden="true"></span> Signing in';
        await wait(500);
        const r = A.signIn($('#si-user', el).value, $('#si-pw', el).value);
        if (r.error) { b.disabled = false; b.textContent = 'Sign in'; setField('si-pw', r.error); $('#si-pw', el).focus(); return; }
        go('home', {}, 'root');
      });
    }
  });

  R.forgot = () => ({
    html: appbar('Forgot password') + `<div class="scroll"><form class="form" novalidate id="fp" style="padding-top:8px">
      <p>Enter your username. We’ll text a code to the phone number on your account.</p>
      ${field('fp-user', 'Username', `<input class="input" id="fp-user" autocomplete="username" autocapitalize="none" spellcheck="false" autofocus>`, '')}
      <button class="btn" type="submit">Send code</button></form></div>`,
    mount(el) {
      $('#fp', el).addEventListener('submit', (e) => {
        e.preventDefault();
        const u = A.findByUsername($('#fp-user', el).value);
        if (!u) { setField('fp-user', 'We couldn’t find that username'); return; }
        go('verify', { purpose: 'reset', phone: u.phone, userId: u.id });
      });
    }
  });

  R.reset = (p) => ({
    html: appbar('New password') + `<div class="scroll"><form class="form" novalidate id="rp" style="padding-top:8px">
      ${field('rp-pw', 'New password', pw('rp-pw', 'new-password'), 'At least 8 characters, with a letter and a number')}
      ${field('rp-pw2', 'Confirm password', pw('rp-pw2', 'new-password'), '')}
      <button class="btn" type="submit">Save password</button></form></div>`,
    mount(el) {
      $('#rp', el).addEventListener('submit', (e) => {
        e.preventDefault();
        const a = $('#rp-pw', el).value, b = $('#rp-pw2', el).value;
        if (a.length < 8 || !/[a-z]/i.test(a) || !/\d/.test(a)) return setField('rp-pw', 'At least 8 characters, with a letter and a number');
        setField('rp-pw', '', true);
        if (a !== b) return setField('rp-pw2', 'Passwords don’t match');
        A.resetPassword(p.userId, a);
        stack = [{ name: 'welcome', params: {} }];
        go('signin', { username: U.user(p.userId).username }, 'push');
        toast('Password updated — sign in with your new password');
      });
    }
  });

  /* =====================================================================
     HOME
     ===================================================================== */
  function pendingCard(n, opts) {
    const t = U.notifText(n);
    const isPay = n.type === 'payment_to_confirm';
    const lbl = isPay ? 'payment' : 'share';
    return `<div class="dup ${isPay ? 'yellow' : ''}" data-card="${n.id}" style="height:100%">
      <div class="sheet perf bill">
        <button class="bill-open" ${opts && opts.tap ? `data-act="open-notif" data-id="${n.id}"` : 'tabindex="-1"'}>
        <span class="t" style="display:block">${esc(t.title)}</span>
        <span class="s" style="display:block">${esc(t.pre || '')}<span class="fig">${esc(t.fig || '')}</span>${esc(t.post || t.sub || '')}</span></button>
        <div class="acts">
          <button class="round no" data-act="answer" data-id="${n.id}" data-yes="0" aria-label="Reject ${lbl}: ${esc(t.title)}">${ic('x', 'sm')}</button>
          <button class="round yes" data-act="answer" data-id="${n.id}" data-yes="1" aria-label="${isPay ? 'Confirm' : 'Accept'} ${lbl}: ${esc(t.title)}">${ic('check', 'sm')}</button>
        </div></div></div>`;
  }
  const lastFig = {};
  function figSpan(key, text, extra) {
    const changed = lastFig[key] !== undefined && lastFig[key] !== text; lastFig[key] = text;
    return `<span class="fig${changed ? ' figure-swap' : ''}" ${extra || ''}>${esc(text)}</span>`;
  }
  function spaceRow(s, i, me) {
    const b = U.spaceBalance(s.id, me.id); const ph = balPhrase(b);
    return stagger(`<button class="row" data-go="space" data-p='${JSON.stringify({ id: s.id })}'>
      <span class="space-ico">${ic(s.icon)}</span>
      <span class="main"><span class="n" style="display:block">${esc(s.name)}</span><span class="serial">${U.serial(s.serial)}</span></span>
      <span class="r"><span class="amt ${ph.cls}" style="display:block">${esc(ph.text)}</span>${ph.sub ? `<span class="sub" style="display:block">${esc(ph.sub)}</span>` : ''}</span></button>`, i);
  }
  R.home = () => {
    const me = U.me();
    const unread = unreadCount();
    if (U.db.debug.simulateErrors) return { tabs: true, html: `<div class="scroll"><p class="wordmark">UOMi</p>${errorBox()}</div>` };
    const skel = needsSkeleton('home');
    const answer = U.db.notifications.find((n) => n.userId === me.id && n.needsAnswer);
    const latest = U.db.notifications.find((n) => n.userId === me.id);
    const ov = U.overall(me.id);
    const curs = Object.keys(ov).filter((c) => ov[c].owe || ov[c].owed);
    const lines = curs.flatMap((c) => [ov[c].owe ? ['You owe', m(ov[c].owe, c), 'owe-' + c] : null, ov[c].owed ? ['You’re owed', m(ov[c].owed, c), 'owed-' + c] : null]).filter(Boolean);
    const spaces = U.spacesFor(me.id).slice().sort((a, b) => lastActivity(b.id) - lastActivity(a.id));
    let card;
    if (answer) card = pendingCard(answer, { tap: true });
    else if (latest) { const t = U.notifText(latest); card = `<button class="sheet perf bill bill-open" data-act="open-notif" data-id="${latest.id}"><span class="t" style="display:block">${esc(t.title)}</span><span class="s" style="display:block">${esc(t.sub || ((t.pre || '') + (t.fig || '') + (t.post || '')))}</span></button>`; }
    else card = `<div class="sheet perf bill empty"><p>You’re all caught up</p></div>`;
    return {
      tabs: true,
      html: `${offlineBanner()}<div class="scroll">
        <h1 class="wordmark">UOMi</h1>
        <h2 class="section-h" style="margin-top:12px"><button data-tab="notifs" style="display:inline-flex;gap:8px;align-items:center">Notifications ${unread ? `<span class="badge" aria-hidden="true">${unread}</span><span class="sr">, ${unread} unread</span>` : ''}</button></h2>
        <div class="home-top">${skel ? '<div class="sheet bill"><div class="skel" style="width:80%"></div><div class="skel" style="width:60%;margin-top:10px"></div></div>' : card}
          <button class="sheet create-tile" data-act="create-space" aria-label="Create Space">${ic('plus', 'lg')}<span class="label">Create Space</span></button></div>
        <h2 class="section-h" id="rt-h">Running total</h2>
        <section class="total" aria-labelledby="rt-h">
          ${skel ? '<div class="line"><div class="skel" style="width:40%"></div></div>' : lines.length ? lines.map(([l, v, k]) => `<div class="line"><span>${l}${curs.length > 1 ? ` <span class="meta">${esc(k.split('-')[1])}</span>` : ''}</span>${figSpan(k, v)}</div>`).join('') : '<p class="settled">You’re all settled up</p>'}</section>
        <h2 class="section-h">Spaces</h2>
        ${skel ? skelRows(4) : spaces.length ? `<div class="sheet rows enter">${spaces.map((s, i) => spaceRow(s, i, me)).join('')}</div>` : `<div class="sheet state-box">${ic('users', 'lg')}<h3>No spaces yet</h3><p>Tap + to create your first space.</p></div>`}
      </div>`
    };
  };
  function lastActivity(spaceId) {
    const t = [U.space(spaceId).createdAt].concat(U.db.expenses.filter((e) => e.spaceId === spaceId).map((e) => e.updatedAt), U.db.settlements.filter((s) => s.spaceId === spaceId).map((s) => s.date));
    return Math.max.apply(null, t);
  }

  /* the signature: carbon copy peels away and the stamp lands */
  async function answer(nid, yes, cardEl) {
    if (guardOffline()) return;
    const n = U.db.notifications.find((x) => x.id === nid); if (!n) return;
    const isPay = n.type === 'payment_to_confirm';
    const dup = cardEl || $(`[data-card="${nid}"]`);
    if (dup) {
      $$('button', dup).forEach((b) => { b.disabled = true; });
      dup.classList.add(yes ? 'peel' : 'tear');
      const st = document.createElement('span');
      st.className = 'stamp land' + (yes ? '' : ' red');
      st.textContent = yes ? (isPay ? 'Received' : 'Agreed') : (isPay ? 'Not received' : 'Rejected');
      st.style.right = '14px'; st.style.top = '40px';
      $('.sheet', dup).appendChild(st);
      await wait(reduce() ? 300 : 720);
    }
    if (isPay) A.answerPayment(n.refId, yes); else A.answerShare(n.refId, n.userId, yes);
    toast(isPay ? (yes ? 'Payment confirmed — balance updated' : 'Payment marked as not received') : (yes ? 'Share accepted — balance updated' : 'Share rejected — ' + U.first(U.expense(n.refId).createdBy) + ' will be told'));
    refresh();
  }

  /* =====================================================================
     CREATE SPACE: pop-up → add people
     ===================================================================== */
  function createSpacePopup(draft) {
    draft = draft || { name: '', icon: 'home', currency: U.db.prefs.defaultCurrency };
    const o = openOverlay(`<div class="popup sheet perf" role="dialog" aria-modal="true" aria-labelledby="cs-t">
      <div style="display:flex;justify-content:space-between;align-items:center;margin:-6px -8px 6px 0"><h2 id="cs-t" style="font-size:var(--fs-title);line-height:var(--lh-title);font-weight:600">New space</h2><button class="icon-btn" data-close aria-label="Close">${ic('x')}</button></div>
      <div class="form" style="gap:14px">
        ${field('cs-name', 'Space name', `<input class="input" id="cs-name" maxlength="30" placeholder="e.g. Flat 4B" value="${esc(draft.name)}" autofocus>`, '', { req: 1 })}
        <div class="field"><span class="lbl">Icon</span><div class="icon-pick" role="group" aria-label="Space icon">${U.ICONS.map((k) => `<button type="button" data-ico="${k}" aria-pressed="${k === draft.icon}" aria-label="${ICON_NAME[k]}">${ic(k)}</button>`).join('')}</div></div>
        <div class="field"><label for="cs-cur">Currency</label><select class="select" id="cs-cur">${Object.keys(U.CURRENCIES).map((c) => `<option value="${c}" ${c === draft.currency ? 'selected' : ''}>${esc(U.CURRENCIES[c].symbol)} ${esc(U.CURRENCIES[c].name)}</option>`).join('')}</select><p class="helper">Every amount in this space uses it. It can’t change after the first expense.</p></div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:4px"><button class="round yes" id="cs-next" style="width:56px;height:56px;border-radius:28px" aria-label="Next: add people" ${draft.name.trim() ? '' : 'disabled'}>${ic('chev')}</button></div></div>`, 'popup');
    const nm = $('#cs-name', o.el), next = $('#cs-next', o.el);
    nm.addEventListener('input', () => { next.disabled = !nm.value.trim(); });
    o.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ico]');
      if (b) { $$('[data-ico]', o.el).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draft.icon = b.dataset.ico; }
    });
    next.addEventListener('click', () => {
      draft.name = nm.value.trim(); draft.currency = $('#cs-cur', o.el).value;
      if (!draft.name) return setField('cs-name', 'Give the space a name');
      o.close(); go('addPeople', { draft, picked: [] });
    });
  }

  R.addPeople = (p) => {
    const existing = p.spaceId ? U.space(p.spaceId) : null;
    const title = existing ? existing.name : p.draft.name;
    const already = existing ? existing.memberIds : [U.me().id];
    const picked = (p.picked || []).map(U.user);
    return {
      html: appbar(title, '', existing ? 'Add people' : 'New space') + `<div class="scroll">
        <div class="input-wrap" style="margin-top:4px"><span style="position:absolute;left:12px;color:var(--ink-2)">${ic('search', 'sm')}</span>
          <input class="input" id="ap-q" style="padding-left:42px" placeholder="Phone number or username" autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="Search people by phone number or username" autofocus></div>
        <p class="helper" style="margin-top:6px">Search a whole phone number or a username.</p>
        <div id="ap-res" style="margin-top:8px" aria-live="polite"></div>
        <h2 class="section-h">Members</h2>
        <ol class="sheet rows" style="list-style:none;margin:0;padding:0" id="ap-list">
          ${existing ? existing.memberIds.map((id, i) => `<li class="row" style="min-height:56px"><span class="label muted" style="width:20px">${i + 1}.</span>${plate(U.user(id))}<span class="main">${esc(youOr(id))}</span></li>`).join('') : `<li class="row" style="min-height:56px"><span class="label muted" style="width:20px">1.</span>${plate(U.me())}<span class="main">You</span><span class="tag owner">Owner</span></li>`}
          ${picked.map((u, i) => `<li class="row enter" style="min-height:56px"><span class="label muted" style="width:20px">${already.length + i + 1}.</span>${plate(u)}<span class="main">${esc(u.name)}<span class="sub" style="display:block">@${esc(u.username)}</span></span><button class="icon-btn" data-act="ap-remove" data-id="${u.id}" aria-label="Remove ${esc(u.name)}">${ic('x', 'sm')}</button></li>`).join('')}
        </ol></div>
        <button class="fab" id="ap-ok" aria-label="${existing ? 'Add selected people' : 'Create space'}" ${picked.length ? '' : 'disabled'}>${ic('check')}</button>`,
      fab: true,
      mount(el) {
        const q = $('#ap-q', el), res = $('#ap-res', el); let t;
        if (picked.length) dirty = true;
        const show = () => {
          const v = q.value; if (!v.trim()) { res.innerHTML = ''; return; }
          const found = A.search(v, already.concat(p.picked || []));
          res.innerHTML = found.length ? `<div class="sheet rows enter">${found.map((u, i) => stagger(`<button class="row" data-act="ap-add" data-id="${u.id}" aria-label="Add ${esc(u.name)}, @${esc(u.username)}">${plate(u)}<span class="main">${esc(u.name)}<span class="sub" style="display:block">@${esc(u.username)}</span></span>${ic('plus', 'sm')}</button>`, i)).join('')}</div>` :
            `<p class="form-note" style="padding:8px 2px">No UOMi user found for ‘${esc(v.trim())}’.</p>`;
        };
        q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(show, 300); });
        $('#ap-ok', el).addEventListener('click', () => {
          if (guardOffline()) return;
          dirty = false;
          if (existing) { A.addMembers(existing.id, p.picked); toast(picked.length + (picked.length === 1 ? ' person' : ' people') + ' added'); uiBack(); return; }
          const s = A.createSpace(p.draft.name, p.draft.icon, p.draft.currency, p.picked);
          stack = [{ name: 'home', params: {} }, stack[stack.length - 1]];
          go('space', { id: s.id }, 'replace');
          toast('Space created');
        });
      }
    };
  };

  /* =====================================================================
     SPACE PAGE
     ===================================================================== */
  function activityRows(items, cur, me) {
    let lastMonth = '';
    return items.map((it, i) => {
      const mk = U.monthKey(it.date); const head = mk !== lastMonth ? `<h3 class="label caps muted" style="padding:16px 2px 8px">${esc(mk)}</h3>` : ''; lastMonth = mk;
      return head + `<div class="sheet rows" style="margin-bottom:-1px">${it.kind === 'e' ? expenseRow(it.x, cur, me) : paymentRow(it.x, cur, me)}</div>`;
    }).join('');
  }
  function expenseRow(e, cur, me) {
    const mine = e.shares.find((s) => s.userId === me.id);
    let right, cls;
    if (U.isDisputed(e)) { right = 'Not counted'; cls = 'muted'; }
    else if (e.paidBy === me.id) { const lent = e.amountMinor - (mine ? mine.amountMinor : 0); right = lent ? 'You lent ' + m(lent, cur) : 'Your own'; cls = 'owed'; }
    else if (mine) { right = 'You owe ' + m(mine.amountMinor, cur); cls = 'owe'; }
    else { right = 'Not involved'; cls = 'muted'; }
    const needs = mine && mine.response === 'pending';
    return `<button class="row" data-go="exp" data-p='${JSON.stringify({ id: e.id })}'>
      <span class="space-ico" style="background:var(--sheet-2);color:var(--ink-2)">${ic('receipt', 'sm')}</span>
      <span class="main"><span class="n" style="display:block">${esc(e.description)}</span><span class="sub" style="display:block">Paid by ${esc(youOr(e.paidBy).replace(/^You$/, 'you'))} · ${m(e.amountMinor, cur)} · ${esc(U.relDate(e.date))}</span>
      ${needs ? '<span class="tag pending" style="margin-top:6px">Needs your answer</span>' : ''}${U.isDisputed(e) ? '<span class="tag disputed" style="margin-top:6px">Disputed</span>' : ''}</span>
      <span class="r"><span class="label ${cls}">${esc(right)}</span></span></button>`;
  }
  function paymentRow(s, cur, me) {
    const status = s.status === 'pending' ? '<span class="tag pending" style="margin-top:6px">Pending</span>' : s.status === 'rejected' ? '<span class="tag disputed" style="margin-top:6px">Rejected</span>' : s.status === 'cancelled' ? '<span class="tag" style="margin-top:6px;color:var(--ink-2)">Cancelled</span>' : '';
    return `<button class="row" data-go="pay" data-p='${JSON.stringify({ id: s.id })}'>
      <span class="space-ico" style="background:var(--carbon-wash)">${ic('swap', 'sm')}</span>
      <span class="main"><span class="n" style="display:block">${esc(youOr(s.fromUserId))} paid ${esc(youOr(s.toUserId).replace('You', 'you'))}</span><span class="sub" style="display:block">${esc(U.relDate(s.date))}</span>${status}</span>
      <span class="r"><span class="label fig">${m(s.amountMinor, cur)}</span></span></button>`;
  }
  R.space = (p) => {
    const s = U.space(p.id); const me = U.me();
    if (!s) return { html: appbar('Space') + `<div class="scroll"><div class="state-box"><h3>This space no longer exists</h3></div></div>` };
    if (U.db.debug.simulateErrors) return { html: appbar(s.name) + `<div class="scroll">${errorBox()}</div>` };
    const skel = needsSkeleton('space-' + s.id);
    const b = U.spaceBalance(s.id, me.id); const ph = balPhrase(b, false);
    const items = U.db.expenses.filter((e) => e.spaceId === s.id).map((x) => ({ kind: 'e', x, date: x.date }))
      .concat(U.db.settlements.filter((x) => x.spaceId === s.id).map((x) => ({ kind: 's', x, date: x.date })))
      .sort((a, c) => c.date - a.date);
    const open = b.open.slice().sort((x, y) => Math.abs(y.net) - Math.abs(x.net));
    const all = !!p.all;
    return {
      fab: true,
      html: `<header class="appbar"><button class="icon-btn" data-back aria-label="Back">${ic('back')}</button><span class="space-ico" style="width:32px;height:32px">${ic(s.icon, 'sm')}</span><h1 class="title">${esc(s.name)}</h1><button class="icon-btn" data-go="members" data-p='${JSON.stringify({ id: s.id })}' aria-label="Members and space settings">${ic('users')}</button></header>
      ${offlineBanner()}<div class="scroll">
        <section class="sheet" style="padding:16px;position:relative;margin-top:4px">
          <p class="serial">${U.serial(s.serial)} · ${esc(U.CURRENCIES[s.currency].symbol)} ${esc(s.currency)}</p>
          ${skel ? '<div class="skel" style="width:60%;height:28px;margin-top:10px"></div>' : `<p style="margin-top:6px;font-size:var(--fs-figure);line-height:var(--lh-figure);font-weight:600" class="${ph.cls === 'muted' ? '' : ph.cls}">${b.settled ? 'Settled up' : b.net === 0 ? 'Balanced, with open debts' : esc(ph.text)}</p>`}
          ${b.settled && !skel ? '<span class="stamp" style="right:16px;top:20px">Settled</span>' : ''}
          ${!skel && open.length ? `<div style="margin-top:10px;border-top:1px solid var(--hair)">${(all ? open : open.slice(0, 3)).map((x) => `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--hair)">${plate(U.user(x.userId))}<span style="flex:1">${x.net < 0 ? 'You owe ' + esc(U.first(x.userId)) : esc(U.first(x.userId)) + ' owes you'}</span><span class="fig ${x.net < 0 ? 'owe' : 'owed'}">${m(Math.abs(x.net), s.currency)}</span></div>`).join('')}
            ${open.length > 3 && !all ? `<button class="text-btn" data-act="see-all">See all ${open.length}</button>` : ''}</div>` : ''}
          ${!skel && b.owe ? `<button class="btn secondary" style="margin-top:14px" data-go="settle" data-p='${JSON.stringify({ id: s.id })}'>${ic('swap', 'sm')} Settle up</button>` : ''}
        </section>
        <h2 class="section-h">Expenses</h2>
        ${skel ? skelRows(3) : items.length ? `<div class="enter">${activityRows(items, s.currency, me)}</div>` : `<div class="sheet state-box">${ic('receipt', 'lg')}<h3>No expenses yet</h3><p>Tap + to add the first one.</p></div>`}
      </div><button class="fab" data-go="expNew" data-p='${JSON.stringify({ spaceId: s.id })}' aria-label="Add expense">${ic('plus')}</button>`
    };
  };

  /* =====================================================================
     ADD / EDIT EXPENSE (four split types)
     ===================================================================== */
  R.expNew = (p) => expenseForm(p.spaceId, null);
  R.expEdit = (p) => { const e = U.expense(p.id); return expenseForm(e.spaceId, e); };
  function expenseForm(spaceId, e) {
    const s = U.space(spaceId); const me = U.me(); const cur = s.currency;
    const st = { desc: e ? e.description : '', amount: e ? String(e.amountMinor / 100) : '', paidBy: e ? e.paidBy : me.id, type: e ? e.splitType : 'equal', date: e ? e.date : Date.now(),
      on: {}, input: {} };
    s.memberIds.forEach((id) => { const sh = e && e.shares.find((x) => x.userId === id); st.on[id] = e ? !!sh : true; st.input[id] = sh && sh.input != null ? String(sh.input) : ''; });
    const today = new Date().toISOString().slice(0, 10);
    return {
      html: appbar(e ? 'Edit expense' : 'Add expense', '', s.name) + `<div class="scroll"><form class="form" id="ex" novalidate style="padding-top:4px">
        ${field('ex-desc', 'Description', `<input class="input" id="ex-desc" maxlength="50" placeholder="e.g. Dinner" value="${esc(st.desc)}" autofocus>`, '', { req: 1 })}
        <div class="field" id="f-ex-amt"><label for="ex-amt">Amount <span class="req" aria-hidden="true">*</span></label>
          <div class="amount-input"><span class="cur">${esc(U.CURRENCIES[cur].symbol)}</span><input id="ex-amt" inputmode="decimal" placeholder="0" value="${esc(st.amount)}" aria-describedby="ex-amt-h"></div><p class="helper" id="ex-amt-h"></p></div>
        <div class="field"><label for="ex-paid">Paid by</label><select class="select" id="ex-paid">${s.memberIds.map((id) => `<option value="${id}" ${id === st.paidBy ? 'selected' : ''}>${esc(id === me.id ? 'You' : U.user(id).name)}</option>`).join('')}</select></div>
        <div class="field"><span class="lbl">Split</span>
          <div class="seg" role="group" aria-label="Split type">${[['equal', 'Equally'], ['exact', 'Exact'], ['percent', 'Percent'], ['shares', 'Shares']].map(([k, l]) => `<button type="button" data-type="${k}" aria-pressed="${k === st.type}">${l}</button>`).join('')}</div>
          <div class="sheet" style="margin-top:10px"><div id="ex-split"></div><div class="split-status" id="ex-status" role="status"></div></div></div>
        <div class="field"><label for="ex-date">Date</label><input class="input" type="date" id="ex-date" max="${today}" value="${new Date(st.date).toISOString().slice(0, 10)}"></div>
      </form></div>
      <button class="fab" id="ex-save" aria-label="Save expense">${ic('check')}</button>`,
      fab: true,
      mount(el) {
        const split = $('#ex-split', el), save = $('#ex-save', el);
        const amtMinor = () => Math.round((parseFloat($('#ex-amt', el).value) || 0) * 100);
        const rows = () => s.memberIds.filter((id) => st.on[id]).map((id) => ({ userId: id, input: st.type === 'shares' ? (st.input[id] || '1') : st.input[id] }));
        function draw(focusId, caret) {
          const r = rows(); const res = U.computeSplit(amtMinor(), st.type, r);
          const per = {}; r.forEach((x, i) => { per[x.userId] = res.amounts[i]; });
          let status = '';
          if (st.type === 'equal') status = r.length && amtMinor() ? `<span>${m(Math.floor(amtMinor() / r.length), cur, false)} each</span><span class="muted">${r.length} people</span>` : '<span class="muted">Enter an amount to see each share</span>';
          if (st.type === 'exact') status = res.left === 0 && amtMinor() ? '<span class="owed">Adds up to the total</span>' : res.left > 0 ? `<span class="pending-t">${m(res.left, cur, false)} left to assign</span>` : `<span class="owe">${m(-res.left, cur, false)} over the total</span>`;
          if (st.type === 'percent') status = res.ok ? '<span class="owed">Adds up to 100%</span>' : res.left > 0 ? `<span class="pending-t">${res.left}% left</span>` : `<span class="owe">${-res.left}% over</span>`;
          if (st.type === 'shares') status = res.totalShares ? `<span>${res.totalShares} shares in total</span>` : '<span class="pending-t">Give at least one share</span>';
          split.innerHTML = s.memberIds.map((id) => {
            const on = st.on[id]; const u = U.user(id);
            const inp = st.type === 'equal' || !on ? '' : `<input class="val" data-in="${id}" inputmode="${st.type === 'shares' ? 'numeric' : 'decimal'}" value="${esc(st.type === 'shares' ? (st.input[id] || '1') : st.input[id])}" placeholder="${st.type === 'percent' ? '%' : '0'}" aria-label="${{ exact: 'Exact amount', percent: 'Percent', shares: 'Shares' }[st.type]} for ${esc(u.name)}">`;
            const resTxt = on ? m(per[id] || 0, cur, false) : 'not in this';
            return `<div class="split-row ${on ? '' : 'off'}"><button type="button" class="who" role="checkbox" aria-checked="${on}" data-tog="${id}"><span class="check">${ic('check', 'sm')}</span>${plate(u)}<span class="nm">${esc(id === me.id ? 'You' : u.name.split(' ')[0])}</span></button>${inp}<span class="res ${on ? 'fig' : 'muted'}">${resTxt}</span></div>`;
          }).join('');
          const stEl = $('#ex-status', el); if (stEl.innerHTML !== status) stEl.innerHTML = status;
          if (focusId) { const f = $(`[data-in="${focusId}"]`, split) || $(`[data-tog="${focusId}"]`, split); if (f) { f.focus(); if (f.setSelectionRange && caret != null) f.setSelectionRange(caret, caret); } }
          const valid = $('#ex-desc', el).value.trim() && amtMinor() > 0 && r.length && res.ok;
          save.disabled = !valid;
          return res;
        }
        draw();
        el.addEventListener('input', (ev) => {
          dirty = true;
          if (ev.target.dataset.in) { st.input[ev.target.dataset.in] = ev.target.value; draw(ev.target.dataset.in, ev.target.selectionStart); return; }
          if (ev.target.id === 'ex-amt') { ev.target.value = ev.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').replace(/(\.\d{2}).+/, '$1'); }
          draw();
        });
        el.addEventListener('change', (ev) => { if (ev.target.id === 'ex-paid') { st.paidBy = ev.target.value; dirty = true; } });
        el.addEventListener('click', (ev) => {
          const t = ev.target.closest('[data-type]');
          if (t) { st.type = t.dataset.type; $$('[data-type]', el).forEach((b) => b.setAttribute('aria-pressed', String(b === t))); s.memberIds.forEach((id) => { st.input[id] = ''; }); draw(); return; }
          const g = ev.target.closest('[data-tog]');
          if (g) { const id = g.dataset.tog; const onCount = s.memberIds.filter((x) => st.on[x]).length; if (st.on[id] && onCount === 1) { toast('At least one person must be in the split'); return; } st.on[id] = !st.on[id]; dirty = true; draw(id); }
        });
        $('#ex-desc', el).addEventListener('blur', () => setField('ex-desc', $('#ex-desc', el).value.trim() ? '' : 'Add a short description'));
        $('#ex-amt', el).addEventListener('blur', () => { const v = amtMinor(); setField('ex-amt', !v ? 'Enter an amount above 0' : v > 999999999 ? 'That’s above the limit for one expense' : ''); });
        save.addEventListener('click', () => {
          if (guardOffline()) return;
          const res = draw(); if (save.disabled) return;
          const r = rows();
          const shares = r.map((x, i) => ({ userId: x.userId, amountMinor: res.amounts[i], response: 'pending', input: st.type === 'equal' ? null : (st.type === 'shares' ? parseInt(x.input, 10) : parseFloat(x.input)) }));
          const data = { spaceId, description: $('#ex-desc', el).value.trim(), amountMinor: amtMinor(), paidBy: st.paidBy, splitType: st.type, shares, date: new Date($('#ex-date', el).value).getTime() || Date.now() };
          const saved = A.saveExpense(data, e && e.id);
          dirty = false;
          const others = saved.shares.filter((x) => x.response === 'pending').length;
          toast(e ? 'Expense updated — everyone will be asked again' : others ? 'Expense added — sent to ' + others + (others === 1 ? ' person' : ' people') + ' to accept' : 'Expense added');
          uiBack();
        });
      }
    };
  }

  /* =====================================================================
     EXPENSE DETAIL
     ===================================================================== */
  R.exp = (p) => {
    const e = U.expense(p.id); const me = U.me();
    if (!e) return { html: appbar('Expense') + `<div class="scroll"><div class="state-box"><h3>This expense was deleted</h3></div></div>` };
    const s = U.space(e.spaceId); const cur = s.currency; const creator = e.createdBy === me.id;
    const mine = e.shares.find((x) => x.userId === me.id);
    const typeName = { equal: 'Split equally', exact: 'Exact amounts', percent: 'By percent', shares: 'By shares' }[e.splitType];
    const resp = (r) => r === 'accepted' ? '<span class="label owed">Accepted</span>' : r === 'rejected' ? '<span class="label owe">Rejected</span>' : '<span class="label pending-t">Pending</span>';
    return {
      html: appbar('Expense', creator ? `<button class="icon-btn" data-go="expEdit" data-p='${JSON.stringify({ id: e.id })}' aria-label="Edit expense">${ic('pencil')}</button><button class="icon-btn" data-act="del-exp" data-id="${e.id}" aria-label="Delete expense">${ic('trash')}</button>` : '', s.name) + `<div class="scroll">
        ${U.isDisputed(e) ? `<div class="banner" style="margin:4px 0 12px">${ic('alert', 'sm')} Someone rejected their share. This doesn’t count until ${creator ? 'you edit' : esc(U.first(e.createdBy)) + ' edits'} or deletes it.</div>` : ''}
        <div class="${mine && mine.response === 'pending' ? 'dup' : ''}" data-card="exp-${e.id}" style="margin-right:12px">
        <section class="sheet perf" style="padding:16px;position:relative">
          <div style="display:flex;justify-content:space-between"><span class="serial">${U.serial(s.serial)}</span><span class="meta">${esc(U.fullDate(e.date))}</span></div>
          <p style="margin-top:12px;font-size:var(--fs-title);line-height:var(--lh-title);font-weight:600">${esc(e.description)}</p>
          <div class="hero-amt"><span class="fig">${m(e.amountMinor, cur, false)}</span></div>
          <p class="label muted">Added by ${esc(youOr(e.createdBy).replace(/^You$/, 'you'))} · ${esc(typeName)}</p>
          ${!U.isDisputed(e) && e.shares.every((x) => x.response === 'accepted') ? '<span class="stamp" style="right:16px;top:52px">Agreed</span>' : ''}
          ${mine && mine.response === 'pending' ? `<div style="display:flex;gap:10px;margin-top:16px"><button class="btn danger" data-act="exp-answer" data-id="${e.id}" data-yes="0">${ic('x', 'sm')} Reject</button><button class="btn" data-act="exp-answer" data-id="${e.id}" data-yes="1">${ic('check', 'sm')} Accept</button></div>` : ''}
        </section></div>
        <h2 class="section-h">Paid by</h2>
        <div class="sheet"><div class="kv">${plate(U.user(e.paidBy))}<span style="flex:1;align-self:center">${esc(youOr(e.paidBy))}</span><span class="fig">${m(e.amountMinor, cur, false)}</span></div></div>
        <h2 class="section-h">Split</h2>
        <div class="sheet rows">${e.shares.map((x) => `<div class="row" style="${x.userId === me.id ? 'background:var(--carbon-wash)' : ''}">${plate(U.user(x.userId))}<span class="main"><span style="display:block">${esc(youOr(x.userId))}</span>${e.splitType === 'percent' ? `<span class="sub" style="display:block">${x.input}%</span>` : e.splitType === 'shares' ? `<span class="sub" style="display:block">${x.input} share${x.input === 1 ? '' : 's'}</span>` : ''}</span><span class="r"><span class="fig" style="display:block">${m(x.amountMinor, cur, false)}</span>${x.userId === e.paidBy ? '<span class="label muted">Paid</span>' : resp(x.response)}</span></div>`).join('')}</div>
      </div>`
    };
  };

  /* =====================================================================
     SETTLE UP + PAYMENT DETAIL
     ===================================================================== */
  R.settle = (p) => {
    const s = U.space(p.id); const me = U.me(); const b = U.spaceBalance(s.id, me.id);
    const owes = b.open.filter((x) => x.net < 0).map((x) => ({ userId: x.userId, max: -x.net - U.pendingTo(s.id, me.id, x.userId) })).filter((x) => x.max > 0);
    const sel = p.to || (owes.length === 1 ? owes[0].userId : null);
    const selMax = sel ? (owes.find((x) => x.userId === sel) || { max: 0 }).max : 0;
    return {
      html: appbar('Settle up', '', s.name) + `<div class="scroll">
        <p class="form-note" style="margin-top:4px">Record a payment you made outside UOMi — cash, UPI or bank. It counts once they confirm they received it.</p>
        <h2 class="section-h">Pay to</h2>
        ${owes.length ? `<div class="sheet rows" role="radiogroup" aria-label="Pay to">${owes.map((x) => `<button class="row" role="radio" aria-checked="${x.userId === sel}" data-act="settle-to" data-id="${x.userId}">${plate(U.user(x.userId))}<span class="main">${esc(U.user(x.userId).name)}<span class="sub" style="display:block">You owe ${m(x.max, s.currency, false)}</span></span><span class="check" style="border-radius:12px">${ic('check', 'sm')}</span></button>`).join('')}</div>`
          : `<div class="sheet state-box"><h3>Nothing to settle</h3><p>Payments you’ve recorded are waiting to be confirmed.</p></div>`}
        ${sel ? `<div class="field" id="f-st-amt" style="margin-top:24px"><label for="st-amt">Amount</label><div class="amount-input"><span class="cur">${esc(U.CURRENCIES[s.currency].symbol)}</span><input id="st-amt" inputmode="decimal" value="${(selMax / 100).toFixed(2)}" aria-describedby="st-amt-h"></div><p class="helper" id="st-amt-h">Up to ${m(selMax, s.currency, false)}. Lower it for a part payment.</p></div>` : ''}
      </div>${sel ? `<button class="fab" id="st-ok" aria-label="Record payment">${ic('check')}</button>` : ''}`,
      fab: !!sel,
      mount(el) {
        const ok = $('#st-ok', el); if (!ok) return;
        const inp = $('#st-amt', el);
        const val = () => Math.round((parseFloat(inp.value) || 0) * 100);
        inp.addEventListener('input', () => { dirty = true; const v = val(); const bad = !v || v > selMax; setField('st-amt', bad ? (v > selMax ? 'That’s more than you owe ' + U.first(sel) : 'Enter an amount above 0') : 'Up to ' + m(selMax, s.currency, false) + '. Lower it for a part payment.', !bad); ok.disabled = bad; });
        ok.addEventListener('click', () => {
          if (guardOffline()) return;
          const pay = A.recordPayment(s.id, sel, val()); dirty = false;
          go('pay', { id: pay.id, fresh: 1 }, 'replace');
          toast('Payment recorded — waiting for ' + U.first(sel) + ' to confirm');
        });
      }
    };
  };
  R.pay = (p) => {
    const x = U.settlement(p.id); const me = U.me();
    if (!x) return { html: appbar('Payment') + `<div class="scroll"><div class="state-box"><h3>This payment no longer exists</h3></div></div>` };
    const s = U.space(x.spaceId);
    const stampTxt = { pending: 'Pending', confirmed: 'Received', rejected: 'Not received', cancelled: 'Cancelled' }[x.status];
    const isRecv = x.toUserId === me.id, isPayer = x.fromUserId === me.id;
    return {
      html: appbar('Payment', '', s.name) + `<div class="scroll">
        <div class="${x.status === 'pending' ? 'dup yellow' : ''}" data-card="pay-${x.id}" style="margin:4px 12px 0 0">
        <section class="sheet perf" style="padding:16px;position:relative">
          <div style="display:flex;justify-content:space-between"><span class="serial">${U.serial(s.serial)}</span><span class="meta">${esc(U.fullDate(x.date))}</span></div>
          <p style="margin-top:12px;font-size:var(--fs-title);line-height:var(--lh-title);font-weight:600">${esc(youOr(x.fromUserId))} paid ${esc(youOr(x.toUserId).replace('You', 'you'))}</p>
          <div class="hero-amt"><span class="fig">${m(x.amountMinor, s.currency, false)}</span></div>
          <p class="label muted">${x.status === 'pending' ? 'Waiting for ' + esc(isRecv ? 'you' : U.first(x.toUserId)) + ' to confirm' : 'Answered ' + esc(U.relDate(x.answeredAt))}</p>
          <span class="stamp ${x.status === 'rejected' || x.status === 'cancelled' ? 'red' : ''} ${p.fresh ? 'land' : ''}" style="right:16px;top:52px">${stampTxt}</span>
          ${isRecv && x.status === 'pending' ? `<div style="display:flex;gap:10px;margin-top:16px"><button class="btn danger" data-act="pay-answer" data-id="${x.id}" data-yes="0">Not received</button><button class="btn" data-act="pay-answer" data-id="${x.id}" data-yes="1">${ic('check', 'sm')} Confirm</button></div>` : ''}
        </section></div>
        <div class="sheet" style="margin-top:24px"><div class="kv"><span class="k">From</span><span>${esc(U.user(x.fromUserId).name)}</span></div><div class="kv"><span class="k">To</span><span>${esc(U.user(x.toUserId).name)}</span></div><div class="kv"><span class="k">Space</span><span>${esc(s.name)}</span></div></div>
        ${isPayer && x.status === 'pending' ? `<button class="btn danger" style="margin-top:24px" data-act="pay-cancel" data-id="${x.id}">Cancel payment</button>` : ''}
      </div>`
    };
  };

  /* =====================================================================
     MEMBERS & SPACE SETTINGS
     ===================================================================== */
  R.members = (p) => {
    const s = U.space(p.id); const me = U.me();
    if (!s) return { html: appbar('Space') + '<div class="scroll"></div>' };
    const owner = s.ownerId === me.id; const hasExp = U.db.expenses.some((e) => e.spaceId === s.id);
    const bal = U.spaceBalance(s.id, me.id);
    const allSettled = s.memberIds.every((id) => U.spaceBalance(s.id, id).settled);
    const memberBal = (id) => U.spaceBalance(s.id, id).settled;
    return {
      html: appbar('Members & settings', '', s.name) + `<div class="scroll">
        <div class="sheet rows" style="margin-top:4px">
          <button class="row" data-act="space-edit"><span class="space-ico">${ic(s.icon)}</span><span class="main"><span style="display:block">${esc(s.name)}</span><span class="sub" style="display:block">Name and icon</span></span>${ic('pencil', 'sm')}</button>
          <div class="row"><span class="space-ico" style="font-weight:700">${esc(U.CURRENCIES[s.currency].symbol)}</span><span class="main"><span style="display:block">${esc(U.CURRENCIES[s.currency].name)}</span><span class="sub" style="display:block">${hasExp ? 'Can’t change after expenses are added' : owner ? 'Only you can change this' : 'Set by the owner'}</span></span>${hasExp || !owner ? ic('lock', 'sm') : `<select class="select" style="width:110px;height:44px" data-act="space-cur" aria-label="Space currency">${Object.keys(U.CURRENCIES).map((c) => `<option ${c === s.currency ? 'selected' : ''}>${c}</option>`).join('')}</select>`}</div>
        </div>
        <h2 class="section-h">Members <span class="badge" style="background:var(--sheet-2);color:var(--ink-2)">${s.memberIds.length}</span></h2>
        <div class="sheet rows">
          <button class="row" data-go="addPeople" data-p='${JSON.stringify({ spaceId: s.id, picked: [] })}'><span class="space-ico">${ic('plus', 'sm')}</span><span class="main" style="color:var(--carbon);font-weight:600">Add people</span></button>
          ${s.memberIds.map((id) => { const u = U.user(id); const pr = bal.pairs.find((x) => x.userId === id); return `<div class="row">${plate(u)}<span class="main"><span style="display:block">${esc(id === me.id ? 'You' : u.name)} ${id === s.ownerId ? '<span class="tag owner">Owner</span>' : ''}</span><span class="sub" style="display:block">@${esc(u.username)}${pr && pr.net ? ' · ' + (pr.net < 0 ? 'you owe ' : 'owes you ') + m(Math.abs(pr.net), s.currency) : ''}</span></span>${owner && id !== me.id ? `<button class="icon-btn" data-act="member-menu" data-id="${id}" data-ok="${memberBal(id)}" aria-label="Options for ${esc(u.name)}">${ic('more')}</button>` : ''}</div>`; }).join('')}
        </div>
        <div style="margin-top:32px;display:flex;flex-direction:column;gap:12px">
          ${owner ? `<button class="btn danger" data-act="space-delete" ${allSettled ? '' : 'disabled'}>${ic('trash', 'sm')} Delete space</button><p class="form-note">${allSettled ? 'Everyone is settled up, so this space can be deleted.' : 'You can delete this space once everyone is settled up. As owner you can’t leave it.'}</p>`
            : `<button class="btn danger" data-act="space-leave" ${bal.settled ? '' : 'disabled'}>${ic('logout', 'sm')} Leave space</button><p class="form-note">${bal.settled ? 'You’re settled up, so you can leave.' : 'Settle up first — you have open balances here.'}</p>`}
        </div></div>`,
      mount(el) {
        const sel = $('[data-act="space-cur"]', el);
        if (sel) sel.addEventListener('change', () => { A.updateSpace(s.id, { currency: sel.value }); toast('Currency changed to ' + sel.value); refresh(); });
      }
    };
  };

  /* =====================================================================
     NOTIFICATIONS
     ===================================================================== */
  R.notifs = () => {
    const me = U.me();
    if (U.db.debug.simulateErrors) return { tabs: true, html: `<div class="scroll"><h1 class="large-title">Notifications</h1>${errorBox()}</div>` };
    const mine = U.db.notifications.filter((n) => n.userId === me.id);
    const needs = mine.filter((n) => n.needsAnswer);
    const rest = mine.filter((n) => !n.needsAnswer);
    const groups = {}; rest.forEach((n) => { const d = U.relDate(n.createdAt); const k = d === 'Today' || d === 'Yesterday' ? d : 'Earlier'; (groups[k] = groups[k] || []).push(n); });
    const icon = { share_rejected: 'alert', payment_answered: 'swap', added_to_space: 'users', space_deleted: 'trash', reminder: 'bell', expense_share: 'receipt', payment_to_confirm: 'swap' };
    const item = (n, i) => { const t = U.notifText(n); return stagger(`<button class="row" data-act="open-notif" data-id="${n.id}" style="${n.read ? '' : 'background:var(--carbon-wash)'}"><span class="space-ico">${ic(icon[n.type])}</span><span class="main"><span style="display:block;font-weight:${n.read ? 400 : 600}">${esc(t.title)}</span><span class="sub" style="display:block">${esc(t.sub || ((t.pre || '') + (t.fig || '') + (t.post || '')))} · ${esc(U.relDate(n.createdAt))}</span></span>${n.read ? '' : '<span class="tab-dot" style="width:8px;height:8px;border-radius:4px;background:var(--carbon);flex:none" aria-hidden="true"></span><span class="sr">Unread</span>'}</button>`, i); };
    return {
      tabs: true,
      html: `${offlineBanner()}<div class="scroll">
        <div style="display:flex;align-items:flex-end;justify-content:space-between"><h1 class="large-title">Notifications</h1>${mine.some((n) => !n.read) ? '<button class="text-btn" data-act="read-all" style="margin-bottom:10px">Mark all as read</button>' : ''}</div>
        ${!mine.length ? `<div class="sheet state-box">${ic('bell', 'lg')}<h3>No notifications yet</h3><p>When someone adds an expense with you in it, it lands here.</p></div>` : ''}
        ${needs.length ? `<h2 class="section-h" style="margin-top:0">Needs your answer <span class="badge">${needs.length}</span></h2><div style="display:flex;flex-direction:column;gap:26px;margin-right:12px">${needs.map((n) => pendingCard(n, { tap: true })).join('')}</div>` : ''}
        ${Object.keys(groups).map((k) => `<h2 class="section-h">${esc(k)}</h2><div class="sheet rows enter">${groups[k].map(item).join('')}</div>`).join('')}
      </div>`
    };
  };
  function openNotif(id) {
    const n = U.db.notifications.find((x) => x.id === id); if (!n) return;
    A.markRead(id); renderBadges();
    if (n.type === 'reminder') return go('settle', { id: n.spaceId });
    if ((n.type === 'expense_share' || n.type === 'share_rejected') && U.expense(n.refId)) return go('exp', { id: n.refId });
    if ((n.type === 'payment_to_confirm' || n.type === 'payment_answered') && U.settlement(n.refId)) return go('pay', { id: n.refId });
    if (n.spaceId && U.space(n.spaceId)) return go('space', { id: n.spaceId });
    refresh();
  }

  /* =====================================================================
     TRANSACTIONS
     ===================================================================== */
  let txFilter = { kind: 'all', space: 'all' };
  R.trans = () => {
    const me = U.me();
    if (U.db.debug.simulateErrors) return { tabs: true, html: `<div class="scroll"><h1 class="large-title">Transactions</h1>${errorBox()}</div>` };
    const skel = needsSkeleton('trans');
    const sps = U.spacesFor(me.id); const ids = sps.map((s) => s.id);
    let items = U.db.expenses.filter((e) => ids.includes(e.spaceId)).map((x) => ({ kind: 'e', x, date: x.date }))
      .concat(U.db.settlements.filter((x) => ids.includes(x.spaceId) && (x.fromUserId === me.id || x.toUserId === me.id)).map((x) => ({ kind: 's', x, date: x.date })));
    if (txFilter.kind !== 'all') items = items.filter((i) => i.kind === (txFilter.kind === 'exp' ? 'e' : 's'));
    if (txFilter.space !== 'all') items = items.filter((i) => i.x.spaceId === txFilter.space);
    items.sort((a, b) => b.date - a.date);
    let lastMonth = '';
    const rowsHtml = items.map((it) => {
      const s = U.space(it.x.spaceId); const mk = U.monthKey(it.date);
      const head = mk !== lastMonth ? `<h3 class="label caps muted" style="padding:16px 2px 8px">${esc(mk)}</h3>` : ''; lastMonth = mk;
      let row;
      if (it.kind === 'e') {
        const e = it.x; const mine = e.shares.find((x) => x.userId === me.id);
        const eff = U.isDisputed(e) ? ['Disputed', 'owe'] : e.paidBy === me.id ? ['You lent ' + m(e.amountMinor - (mine ? mine.amountMinor : 0), s.currency), 'owed'] : mine ? ['You owe ' + m(mine.amountMinor, s.currency), 'owe'] : ['Not involved', 'muted'];
        row = `<button class="row" data-go="exp" data-p='${JSON.stringify({ id: e.id })}'><span class="space-ico" style="background:var(--sheet-2);color:var(--ink-2)">${ic('receipt', 'sm')}</span><span class="main"><span class="n" style="display:block">${esc(e.description)}</span><span class="sub" style="display:block">${esc(s.name)} · ${esc(U.relDate(e.date))}</span></span><span class="r"><span class="label ${eff[1]}">${esc(eff[0])}</span></span></button>`;
      } else {
        const x = it.x; const paid = x.fromUserId === me.id;
        row = `<button class="row" data-go="pay" data-p='${JSON.stringify({ id: x.id })}'><span class="space-ico">${ic('swap', 'sm')}</span><span class="main"><span class="n" style="display:block">${paid ? 'You paid ' + esc(U.first(x.toUserId)) : esc(U.first(x.fromUserId)) + ' paid you'}</span><span class="sub" style="display:block">${esc(s.name)} · ${esc(U.relDate(x.date))}</span>${x.status === 'pending' ? '<span class="tag pending" style="margin-top:6px">Pending</span>' : ''}</span><span class="r"><span class="label ${paid ? '' : 'owed'}">${paid ? 'You paid ' : 'You received '}${m(x.amountMinor, s.currency)}</span></span></button>`;
      }
      return head + `<div class="sheet rows" style="margin-bottom:-1px">${row}</div>`;
    }).join('');
    const filtered = txFilter.kind !== 'all' || txFilter.space !== 'all';
    return {
      tabs: true,
      html: `${offlineBanner()}<div class="scroll"><h1 class="large-title">Transactions</h1>
        <div class="chips" role="group" aria-label="Filter by type">${[['all', 'All'], ['exp', 'Expenses'], ['pay', 'Payments']].map(([k, l]) => `<button class="chip" data-act="tx-kind" data-k="${k}" aria-pressed="${txFilter.kind === k}">${l}</button>`).join('')}</div>
        <select class="select" data-act="tx-space" aria-label="Filter by space" style="margin-top:12px"><option value="all">All spaces</option>${sps.map((s) => `<option value="${s.id}" ${txFilter.space === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        ${skel ? skelRows(5) : items.length ? `<div class="enter">${rowsHtml}</div>` : filtered ? `<div class="sheet state-box" style="margin-top:16px"><h3>Nothing matches these filters</h3><button class="btn secondary" data-act="tx-clear" style="width:auto">Clear filters</button></div>` : `<div class="sheet state-box" style="margin-top:16px">${ic('receipt', 'lg')}<h3>No transactions yet</h3></div>`}
      </div>`,
      mount(el) { const sel = $('[data-act="tx-space"]', el); sel.addEventListener('change', () => { txFilter.space = sel.value; refresh(false); }); }
    };
  };

  /* =====================================================================
     PROFILE + EDIT PROFILE + DEBUG
     ===================================================================== */
  R.profile = () => {
    const me = U.me(); const pr = U.db.prefs;
    return {
      tabs: true,
      html: `${offlineBanner()}<div class="scroll">
        <h1 class="large-title" id="wm">Profile</h1>
        <section class="sheet" style="padding:16px;display:flex;gap:16px;align-items:center">
          ${plate(me, true)}
          <div style="flex:1;min-width:0"><p style="font-size:var(--fs-title);line-height:var(--lh-title);font-weight:600">${esc(me.name)}</p><p class="muted" style="margin-top:2px">${esc(U.prettyPhone(me.phone))}</p><p class="label muted">@${esc(me.username)}</p></div>
          <button class="icon-btn" data-go="editProfile" aria-label="Edit profile">${ic('pencil')}</button>
        </section>
        <h2 class="section-h">Settings</h2>
        <div class="sheet rows">
          <div class="row"><span class="space-ico" style="font-weight:700">${esc(U.CURRENCIES[pr.defaultCurrency].symbol)}</span><span class="main"><label for="pf-cur" style="display:block">Default currency</label><span class="sub" style="display:block">For new spaces</span></span><select class="select" id="pf-cur" style="width:120px;height:44px">${Object.keys(U.CURRENCIES).map((c) => `<option ${c === pr.defaultCurrency ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          <div class="row"><span class="space-ico">${ic('bell', 'sm')}</span><span class="main"><span style="display:block" id="pf-n-l">Notifications</span><span class="sub" style="display:block">Alerts on this phone</span></span><button class="switch" role="switch" aria-checked="${pr.notificationsOn}" aria-labelledby="pf-n-l" data-act="pf-notif"></button></div>
          <div class="row" style="flex-wrap:wrap"><span class="space-ico">${ic(document.documentElement.dataset.theme === 'dark' ? 'moon' : 'sun', 'sm')}</span><span class="main"><span style="display:block">Theme</span><span class="sub" style="display:block">${pr.theme === 'system' ? 'Following your phone' : pr.theme === 'dark' ? 'Dark' : 'Light'}</span></span>
            <div class="seg" role="group" aria-label="Theme" style="width:132px"><button data-act="pf-theme" data-v="light" aria-pressed="${pr.theme === 'light'}" aria-label="Light">${ic('sun', 'sm')}</button><button data-act="pf-theme" data-v="dark" aria-pressed="${pr.theme === 'dark'}" aria-label="Dark">${ic('moon', 'sm')}</button></div></div>
        </div>
        <button class="btn danger" style="margin-top:28px" data-act="logout">${ic('logout', 'sm')} Log out</button>
        <p class="form-note" style="text-align:center;margin-top:16px">UOMi prototype · synthetic demo data</p>
      </div>`,
      mount(el) {
        $('#pf-cur', el).addEventListener('change', (e) => { A.setPref('defaultCurrency', e.target.value); refresh(); toast('New spaces will use ' + e.target.value); });
        const wm = $('#wm', el); let t;
        wm.addEventListener('pointerdown', () => { t = setTimeout(debugSheet, 600); });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => wm.addEventListener(ev, () => clearTimeout(t)));
      }
    };
  };
  R.editProfile = () => {
    const me = U.me();
    return {
      html: appbar('Edit profile') + `<div class="scroll"><form class="form" id="ep" novalidate style="padding-top:8px">
        <div style="display:flex;align-items:center;gap:16px"><span id="ep-plate">${plate(me, true)}</span><div style="display:flex;flex-direction:column;align-items:flex-start"><label class="text-btn" style="cursor:pointer">${ic('camera', 'sm')}&nbsp;Change photo<input type="file" accept="image/*" id="ep-file" class="sr"></label>${me.avatar ? '<button type="button" class="text-btn danger" data-act="ep-rm" style="padding-top:0">Remove photo</button>' : ''}</div></div>
        ${field('ep-name', 'Name', `<input class="input" id="ep-name" value="${esc(me.name)}" autocomplete="name">`, '')}
        <div class="field"><span class="lbl">Username</span><div class="input" style="display:flex;align-items:center;justify-content:space-between;color:var(--ink-2)">@${esc(me.username)}${ic('lock', 'sm')}</div><p class="helper">Your recovery key, so it can’t be changed.</p></div>
        <div class="field"><span class="lbl">Phone number</span><div class="input" style="display:flex;align-items:center;justify-content:space-between;color:var(--ink-2)">${esc(U.prettyPhone(me.phone))}${ic('lock', 'sm')}</div><p class="helper">Changing your number isn’t available yet.</p></div>
        <button class="btn" type="submit">Save</button></form></div>`,
      mount(el) {
        let avatar = me.avatar;
        $('#ep', el).addEventListener('input', () => { dirty = true; });
        $('#ep-file', el).addEventListener('change', (e) => {
          const f = e.target.files[0]; if (!f) return;
          const r = new FileReader(); r.onload = () => { avatar = r.result; $('#ep-plate', el).innerHTML = plate(Object.assign({}, me, { avatar }), true); dirty = true; }; r.readAsDataURL(f);
        });
        el.addEventListener('click', (e) => { if (e.target.closest('[data-act="ep-rm"]')) { avatar = null; $('#ep-plate', el).innerHTML = plate(Object.assign({}, me, { avatar: null }), true); dirty = true; } });
        $('#ep', el).addEventListener('submit', (e) => {
          e.preventDefault();
          const nm = $('#ep-name', el).value.trim();
          if (!nm) return setField('ep-name', 'Enter your name');
          A.updateProfile({ name: nm, avatar }); dirty = false; toast('Profile saved'); uiBack();
        });
      }
    };
  };
  function debugSheet() {
    const me = U.me(); const d = U.db.debug;
    const s = openOverlay(`<div class="bsheet" role="dialog" aria-modal="true" aria-labelledby="dbg-h"><div class="grab"></div>
      <div class="bs-h"><h2 id="dbg-h">Debug menu</h2><button class="icon-btn" data-close aria-label="Close">${ic('x')}</button></div>
      <div class="bs-body">
        <p class="form-note" style="margin-bottom:8px">Prototype only. Act as another person to answer shares and confirm payments on one device.</p>
        <h3 class="label caps muted" style="padding:8px 2px">Act as</h3>
        <div class="sheet rows">${U.db.users.map((u) => `<button class="row" data-act="act-as" data-id="${u.id}" ${me && u.id === me.id ? 'aria-current="true" style="background:var(--carbon-wash)"' : ''}>${plate(u)}<span class="main">${esc(u.name)}<span class="sub" style="display:block">@${esc(u.username)}</span></span>${me && u.id === me.id ? '<span class="label" style="color:var(--carbon)">Current</span>' : ''}</button>`).join('')}</div>
        <h3 class="label caps muted" style="padding:16px 2px 8px">States</h3>
        <div class="sheet rows">
          <div class="row"><span class="main" id="dbg-e">Simulate load errors</span><button class="switch" role="switch" aria-checked="${d.simulateErrors}" aria-labelledby="dbg-e" data-act="dbg" data-k="simulateErrors"></button></div>
          <div class="row"><span class="main" id="dbg-o">Simulate offline</span><button class="switch" role="switch" aria-checked="${d.offline}" aria-labelledby="dbg-o" data-act="dbg" data-k="offline"></button></div>
        </div>
        <button class="btn danger" style="margin-top:16px" data-act="dbg-reset">Reset demo data</button>
      </div></div>`, 'sheet');
    s.el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'act-as') { A.actAs(a.dataset.id); s.close(); Object.keys(loaded).forEach((k) => delete loaded[k]); go('home', {}, 'root'); toast('Now acting as ' + U.me().name); }
      if (a.dataset.act === 'dbg') { const v = a.getAttribute('aria-checked') !== 'true'; a.setAttribute('aria-checked', String(v)); A.setDebug(a.dataset.k, v); refresh(); }
      if (a.dataset.act === 'dbg-reset') { s.close(); resetDemo(); }
    });
  }
  function resetDemo() { U.reset(); Object.keys(loaded).forEach((k) => delete loaded[k]); applyTheme(); stack = []; screensEl.innerHTML = ''; go('welcome', {}, 'root'); toast('Demo data reset'); }

  /* =====================================================================
     DELEGATED EVENTS
     ===================================================================== */
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab],[data-back],[data-go],[data-act],[data-pc],[data-pc-theme]');
    if (!t || t.disabled) return;
    if (t.dataset.pcTheme) { A.setPref('theme', t.dataset.pcTheme); applyTheme(); refresh(); return; }
    if (t.dataset.pc === 'debug') return debugSheet();
    if (t.dataset.pc === 'reset') return resetDemo();
    if (t.dataset.tab) return tab(t.dataset.tab);
    if (t.hasAttribute('data-back')) { if (t.closest('.overlay')) return; return uiBack(); }
    if (t.dataset.go) { e.preventDefault(); return go(t.dataset.go, t.dataset.p ? JSON.parse(t.dataset.p) : {}, t.dataset.mode || 'push'); }
    const id = t.dataset.id;
    switch (t.dataset.act) {
      case 'eye': { const inp = $('#' + t.dataset.for); const show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; t.innerHTML = ic(show ? 'eyeoff' : 'eye', 'sm'); t.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); break; }
      case 'country': { const el = screensEl.lastElementChild; countrySheet((code) => el._country(code)); break; }
      case 'create-space': if (!guardOffline()) createSpacePopup(); break;
      case 'answer': e.stopPropagation(); answer(id, t.dataset.yes === '1', t.closest('.dup')); break;
      case 'open-notif': openNotif(id); break;
      case 'ap-add': { const st = stack[stack.length - 1]; st.params.picked = (st.params.picked || []).concat(id); refresh(); const q = $('#ap-q'); if (q) q.focus(); break; }
      case 'ap-remove': { const st = stack[stack.length - 1]; st.params.picked = st.params.picked.filter((x) => x !== id); refresh(); break; }
      case 'see-all': { stack[stack.length - 1].params.all = 1; refresh(); break; }
      case 'del-exp': { const ex = U.expense(id); if (await confirmDialog({ title: 'Delete ‘' + ex.description + '’?', body: 'Balances will be recalculated for everyone in it.', ok: 'Delete', danger: true })) { if (guardOffline()) return; A.deleteExpense(id); toast('Expense deleted'); uiBack(); } break; }
      case 'exp-answer': { if (guardOffline()) return; const yes = t.dataset.yes === '1'; const card = $(`[data-card="exp-${id}"]`); const ex = U.expense(id);
        if (card) { card.classList.add(yes ? 'peel' : 'tear'); const st = document.createElement('span'); st.className = 'stamp land' + (yes ? '' : ' red'); st.textContent = yes ? 'Agreed' : 'Rejected'; st.style.right = '16px'; st.style.top = '52px'; $('.sheet', card).appendChild(st); $$('button', card).forEach((b) => { b.disabled = true; }); await wait(reduce() ? 250 : 650); }
        A.answerShare(id, U.me().id, yes); toast(yes ? 'Share accepted — balance updated' : 'Share rejected — ' + U.first(ex.createdBy) + ' will be told'); refresh(); break; }
      case 'settle-to': { stack[stack.length - 1].params.to = id; refresh(); break; }
      case 'pay-answer': { if (guardOffline()) return; const yes = t.dataset.yes === '1'; const card = $(`[data-card="pay-${id}"]`); if (card) { card.classList.add(yes ? 'peel' : 'tear'); $$('button', card).forEach((b) => { b.disabled = true; }); const old = $('.stamp', card); if (old) old.remove(); const st = document.createElement('span'); st.className = 'stamp land' + (yes ? '' : ' red'); st.textContent = yes ? 'Received' : 'Not received'; st.style.right = '16px'; st.style.top = '52px'; $('.sheet', card).appendChild(st); await wait(reduce() ? 250 : 650); }
        A.answerPayment(id, yes); toast(yes ? 'Payment confirmed — balance updated' : 'Marked as not received'); refresh(); break; }
      case 'pay-cancel': if (await confirmDialog({ title: 'Cancel this payment?', body: 'It will be removed and ' + U.first(U.settlement(id).toUserId) + ' won’t be asked to confirm it.', ok: 'Cancel payment', danger: true, cancel: 'Keep it' })) { A.cancelPayment(id); toast('Payment cancelled'); refresh(); } break;
      case 'space-edit': { const s = U.space(stack[stack.length - 1].params.id); editSpacePopup(s); break; }
      case 'member-menu': { const s = U.space(stack[stack.length - 1].params.id); const u = U.user(id);
        if (t.dataset.ok !== 'true') { toast(u.name.split(' ')[0] + ' has open balances — settle up first'); break; }
        if (await confirmDialog({ title: 'Remove ' + u.name + '?', body: 'They’ll no longer see ' + s.name + '.', ok: 'Remove', danger: true })) { A.removeMember(s.id, id); toast(u.name.split(' ')[0] + ' removed'); refresh(); } break; }
      case 'space-leave': { const s = U.space(stack[stack.length - 1].params.id); if (await confirmDialog({ title: 'Leave ' + s.name + '?', body: 'You’ll stop seeing its expenses. Someone will need to add you back.', ok: 'Leave', danger: true })) { A.leaveSpace(s.id); stack = [{ name: 'home', params: {} }]; screensEl.innerHTML = ''; go('home', {}, 'root'); toast('You left ' + s.name); } break; }
      case 'space-delete': { const s = U.space(stack[stack.length - 1].params.id); if (await confirmDialog({ title: 'Delete ' + s.name + '?', body: 'Its expenses and payments are removed for everyone. This can’t be undone.', ok: 'Delete space', danger: true })) { A.deleteSpace(s.id); screensEl.innerHTML = ''; go('home', {}, 'root'); toast(s.name + ' deleted'); } break; }
      case 'read-all': A.markAllRead(); refresh(); break;
      case 'tx-kind': txFilter.kind = t.dataset.k; refresh(false); break;
      case 'tx-clear': txFilter = { kind: 'all', space: 'all' }; refresh(false); break;
      case 'pf-notif': { const v = t.getAttribute('aria-checked') !== 'true'; t.setAttribute('aria-checked', String(v)); A.setPref('notificationsOn', v); toast(v ? 'Notifications on' : 'Notifications off'); break; }
      case 'pf-theme': A.setPref('theme', t.dataset.v); applyTheme(); refresh(); break;
      case 'logout': if (await confirmDialog({ title: 'Log out of UOMi?', ok: 'Log out', danger: true })) { A.signOut(); Object.keys(loaded).forEach((k) => delete loaded[k]); screensEl.innerHTML = ''; go('welcome', {}, 'root'); } break;
      case 'retry': { A.setDebug('simulateErrors', false); Object.keys(loaded).forEach((k) => delete loaded[k]); refresh(); break; }
      default: break;
    }
  });

  function editSpacePopup(s) {
    let icon = s.icon;
    const o = openOverlay(`<div class="popup sheet perf" role="dialog" aria-modal="true" aria-labelledby="es-t">
      <div style="display:flex;justify-content:space-between;align-items:center;margin:-6px -8px 6px 0"><h2 id="es-t" style="font-size:var(--fs-title);line-height:var(--lh-title);font-weight:600">Edit space</h2><button class="icon-btn" data-close aria-label="Close">${ic('x')}</button></div>
      <div class="form" style="gap:14px">${field('es-name', 'Space name', `<input class="input" id="es-name" maxlength="30" value="${esc(s.name)}">`, '', { req: 1 })}
      <div class="field"><span class="lbl" id="es-ico">Icon</span><div class="icon-pick" role="group" aria-labelledby="es-ico">${U.ICONS.map((k) => `<button type="button" data-ico="${k}" aria-pressed="${k === icon}" aria-label="${ICON_NAME[k]}">${ic(k)}</button>`).join('')}</div></div>
      <button class="btn" id="es-save">Save</button></div></div>`, 'popup');
    o.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ico]'); if (b) { icon = b.dataset.ico; $$('[data-ico]', o.el).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }
      if (e.target.closest('#es-save')) { const nm = $('#es-name', o.el).value.trim(); if (!nm) return setField('es-name', 'Give the space a name'); A.updateSpace(s.id, { name: nm, icon }); o.close(); toast('Space updated'); refresh(); }
    });
  }

  /* ---------- boot ---------- */
  applyTheme();
  if (U.me()) { stack = [{ name: 'home', params: {} }]; history.replaceState({ d: 1 }, ''); const el = build(stack[0]); screensEl.appendChild(el); mount(el); setTabs(stack[0]); }
  else { stack = [{ name: 'welcome', params: {} }]; history.replaceState({ d: 1 }, ''); const el = build(stack[0]); screensEl.appendChild(el); mount(el); setTabs(stack[0]); }
})();
