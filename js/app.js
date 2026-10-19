/* Venue Planner: user interface. Connects the venue model, the SVG plan renderer and storage. */
(function () {
  'use strict';
  const VP = window.VP;
  const M = VP.model, P = VP.plan, G = VP.geometry;
  const store = VP.storage.local, share = VP.storage.share, cloud = VP.storage.cloud;
  const FT = P.FT;
  const $ = (id) => document.getElementById(id);
  const esc = P.esc;
  const cssId = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&'));

  const S = {
    venue: null,
    ephemeral: false, // the first-run sample is only a preview until the visitor uses it
    tab: 'plan',
    sel: null, // { kind: 'item' | 'feature', id }
    zoom: 1,
    fit: true,
    prefs: null,
    analysis: null,
    cache: {},
    undo: [],
    redo: [],
    group: null,
    groupAt: 0,
    measuring: false,
    mline: null,
    drag: null,
    inspKey: '',
    conflictIdx: 0,
    editingType: null,
    timers: {},
    cloudState: 'off',
    cloudError: '',
    lastSync: 0,
    syncing: false,
    saveFailed: false,
    storageOk: true,
    firstRun: false,
    hintAt: 0,
  };

  // ---------- icons ----------
  const ICONS = {
    plus: 'M12 5v14M5 12h14',
    x: 'M6 6l12 12M18 6L6 18',
    rotate: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4',
    rotateSmall: 'M6 19A13 13 0 0 1 19 6M16 3l3 3-3 3',
    copy: 'M8 8h12v12H8zM4 16V4h12',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
    redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
    ruler: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
    zoomIn: 'M4 11a7 7 0 1 0 14 0a7 7 0 1 0-14 0M21 21l-5-5M8 11h6M11 8v6',
    zoomOut: 'M4 11a7 7 0 1 0 14 0a7 7 0 1 0-14 0M21 21l-5-5M8 11h6',
    fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
    table: 'M3 9h18v4H3zM6 13v6M18 13v6',
    download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
    upload: 'M12 16V5M7 10l5-5 5 5M5 20h14',
    image: 'M4 5h16v14H4zM4 17l5-5 4 4 3-3 4 4M16 8.5a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0',
    print: 'M7 9V3h10v6M7 17H4v-7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v7h-3M7 14h10v7H7z',
    link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
    edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
    cloud: 'M7 18a4 4 0 0 1-.5-7.97 6 6 0 0 1 11.6 1.03A3.5 3.5 0 0 1 17.5 18z',
    check: 'M5 12l5 5 9-10',
  };
  const icon = (name) => '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + ICONS[name] + '"/></svg>';
  function injectIcons() {
    document.querySelectorAll('[data-icon]').forEach((el) => el.insertAdjacentHTML('afterbegin', icon(el.getAttribute('data-icon'))));
  }

  // ---------- small helpers ----------
  const units = () => S.venue.units;
  const len = (ft) => M.fmtLen(ft, S.venue.units);
  const plural = (n, one, many) => n.toLocaleString('en-US') + ' ' + (n === 1 ? one : many || one + 's');
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const mode = () => (S.tab === 'room' ? 'room' : 'plan');
  const findItem = (id) => S.venue.items.find((i) => i.id === id) || null;
  const findFeature = (id) => S.venue.features.find((f) => f.id === id) || null;
  const typeById = (id) => S.venue.types.find((t) => t.id === id) || null;

  function selected() {
    if (!S.sel) return null;
    return S.sel.kind === 'item' ? findItem(S.sel.id) : findFeature(S.sel.id);
  }

  function placedCount(typeId) {
    let n = 0;
    for (const it of S.venue.items) if (it.type === typeId) n++;
    return n;
  }
  const atLimit = (t) => t.qty !== null && placedCount(t.id) >= t.qty;

  function dateStr(ms) {
    const d = new Date(ms);
    if (!ms || isNaN(d.getTime())) return '';
    if (new Date().toDateString() === d.toDateString()) {
      return 'Today, ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function isTyping(el) {
    if (!el || !el.tagName) return false;
    if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
    if (el.tagName !== 'INPUT') return false;
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'range'].includes(el.type);
  }

  function setInvalid(el, bad) {
    if (bad) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
  }

  // Replaces a container's HTML only when it changed, keeping keyboard focus on the same control.
  function rebuild(el, html) {
    if (!el || el._vpHtml === html) return;
    const active = document.activeElement;
    const had = active && active !== el && el.contains(active);
    const key = had ? active.getAttribute('data-key') : null;
    el.innerHTML = html;
    el._vpHtml = html;
    if (!had) return;
    const next = key ? el.querySelector('[data-key="' + cssId(key) + '"]') : null;
    if (next && !next.disabled) {
      next.focus({ preventScroll: true });
    } else {
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    }
  }

  // Updates a form field from state unless the user is editing it.
  function syncValue(el, value, force) {
    if (!el) return;
    if (!force && (el === document.activeElement || el.getAttribute('aria-invalid') === 'true')) return;
    if (el.type === 'checkbox') el.checked = !!value;
    else if (el.value !== String(value)) el.value = String(value);
  }

  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(S.timers.toast);
    S.timers.toast = setTimeout(() => t.classList.remove('show'), ms || Math.max(3000, Math.min(9000, msg.length * 55)));
  }

  function announce(msg) {
    const el = $('srStatus');
    el.textContent = '';
    clearTimeout(S.timers.announce);
    S.timers.announce = setTimeout(() => { el.textContent = msg; }, 40);
  }

  // ---------- dialogs ----------
  let pendingAsk = null;

  // Shows a modal question. Resolves with the chosen button's value, or null when dismissed.
  function ask(title, msg, buttons) {
    const d = $('askDialog');
    if (pendingAsk) { const r = pendingAsk; pendingAsk = null; r(null); }
    $('askTitle').textContent = title;
    $('askMsg').textContent = msg;
    const box = $('askButtons');
    box.innerHTML = '';
    return new Promise((resolve) => {
      pendingAsk = resolve;
      let focusBtn = null;
      for (const b of buttons) {
        const el = document.createElement('button');
        el.type = 'button';
        el.textContent = b.label;
        if (b.primary) el.className = 'primary';
        if (b.danger) el.className = 'danger';
        el.addEventListener('click', () => finishAsk(b.value));
        box.appendChild(el);
        if (b.focus) focusBtn = el;
      }
      if (!d.open) d.showModal();
      (focusBtn || box.lastElementChild).focus();
    });
  }
  function finishAsk(value) {
    const d = $('askDialog');
    const r = pendingAsk;
    pendingAsk = null;
    if (d.open) d.close();
    if (r) r(value);
  }
  const info = (title, msg) => ask(title, msg, [{ label: 'OK', value: true, primary: true, focus: true }]);

  // ---------- undo ----------
  // Snapshots cover the venue except saved layouts, which are managed separately.
  function snapshot() {
    const v = Object.assign({}, S.venue);
    delete v.layouts;
    return JSON.stringify(v);
  }
  function restore(snap) {
    const v = JSON.parse(snap);
    v.layouts = S.venue.layouts;
    S.venue = v;
  }
  // Call before a change. Changes in the same group within a short time share one undo step.
  function checkpoint(group) {
    const now = Date.now();
    if (group && S.group === group && now - S.groupAt < 1200) { S.groupAt = now; return; }
    S.group = group || null;
    S.groupAt = now;
    S.undo.push(snapshot());
    if (S.undo.length > 60) S.undo.shift();
    S.redo.length = 0;
  }
  function stepHistory(from, to, word) {
    if (!from.length) return;
    const roomBefore = JSON.stringify(S.venue.room);
    to.push(snapshot());
    restore(from.pop());
    S.group = null;
    if (S.sel && !selected()) S.sel = null;
    if (S.editingType && !typeById(S.editingType)) resetTypeForm();
    changed({ refit: JSON.stringify(S.venue.room) !== roomBefore });
    announce(word);
  }
  const undo = () => stepHistory(S.undo, S.redo, 'Undone');
  const redo = () => stepHistory(S.redo, S.undo, 'Redone');

  // ---------- saving ----------
  function touched() {
    S.venue.updatedAt = Date.now();
    if (S.ephemeral) {
      S.ephemeral = false;
      S.venue.name = uniqueName(S.venue.name, S.venue.id);
    }
    clearTimeout(S.timers.persist);
    S.timers.persist = setTimeout(persist, 300);
    if (cloud.user) {
      clearTimeout(S.timers.push);
      S.timers.push = setTimeout(pushCloud, 1500);
    }
  }

  function persist() {
    clearTimeout(S.timers.persist);
    S.timers.persist = null;
    if (!S.venue || S.ephemeral) return;
    try {
      store.save(S.venue);
      store.setCurrent(S.venue.id);
      if (S.saveFailed) { S.saveFailed = false; renderBanner(); }
    } catch (e) {
      if (!S.saveFailed) { S.saveFailed = true; renderBanner(); }
    }
    renderVenueSelect();
    renderVenueList();
  }

  // Writes pending changes now, for example before switching venues or leaving the page.
  function flush() {
    if (S.timers.persist) persist();
    if (S.timers.push) {
      clearTimeout(S.timers.push);
      S.timers.push = null;
      pushCloud();
    }
  }

  function analyzeNow() {
    S.analysis = M.analyze(S.venue, S.cache);
  }

  // Throttled analysis while dragging.
  function analyzeSoon() {
    if (S.timers.analyze) return;
    S.timers.analyze = setTimeout(() => {
      S.timers.analyze = null;
      if (!S.venue) return;
      analyzeNow();
      renderStats();
      renderOverlay();
      renderActionBar();
    }, 80);
  }

  // Everything that edits the venue ends here: save, re-analyze and redraw.
  function changed(opts) {
    touched();
    analyzeNow();
    if (opts && opts.refit) S.fit = true;
    renderAll();
  }

  // ---------- tabs ----------
  const TABS = ['plan', 'room', 'inventory', 'share'];
  const HINTS = {
    plan: 'Drag furniture to move it. R rotates, Shift+R turns 15\u00b0, arrow keys nudge, Delete removes, M measures.',
    room: 'Drag features to move them and the corner handle to resize. R rotates, arrow keys nudge, Delete removes.',
  };

  function setTab(tab, focusTab) {
    if (!TABS.includes(tab)) tab = 'plan';
    const before = mode();
    S.tab = tab;
    for (const t of TABS) {
      const on = t === tab;
      const btn = $('tab-' + t);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
      $('panel-' + t).hidden = !on;
    }
    if (focusTab) $('tab-' + tab).focus();
    $('kbdHint').textContent = HINTS[mode()];
    if (mode() !== before) {
      if (S.sel && S.sel.kind !== (mode() === 'room' ? 'feature' : 'item')) S.sel = null;
      renderScene();
      renderSelection();
    }
  }

  function onTabKey(e) {
    const i = TABS.indexOf(S.tab);
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') j = (i + TABS.length - 1) % TABS.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = TABS.length - 1;
    if (j === null) return;
    e.preventDefault();
    setTab(TABS[j], true);
  }

  // ---------- panel rendering ----------
  function renderAll() {
    renderHeader();
    renderBanner();
    renderStats();
    renderNextSteps();
    renderPalette();
    renderLayouts();
    renderRoomTab();
    renderInventoryTab();
    renderVenueList();
    renderSync();
    renderScene();
    renderSelection();
  }

  function renderVenueSelect() {
    const sel = $('venueSelect');
    const cur = S.venue;
    const list = store.list();
    let html = '';
    if (S.ephemeral) html += '<option value="">' + esc(cur.name + ' (preview)') + '</option>';
    else if (!list.some((e) => e.id === cur.id)) html += '<option value="' + esc(cur.id) + '">' + esc(cur.name) + '</option>';
    for (const e of list) {
      html += '<option value="' + esc(e.id) + '">' + esc(!S.ephemeral && e.id === cur.id ? cur.name : e.name) + '</option>';
    }
    if (sel._vpHtml !== html) { sel.innerHTML = html; sel._vpHtml = html; }
    sel.value = S.ephemeral ? '' : cur.id;
  }

  function renderHeader() {
    const v = S.venue;
    renderVenueSelect();
    $('venueSub').textContent = M.fmtDim(v.room.w, v.units) + ' \u00d7 ' + M.fmtDim(v.room.h, v.units) +
      (v.target ? ' \u00b7 ' + plural(v.target, 'guest') : '');
    document.title = v.name + ' \u00b7 Venue Planner';
  }

  function renderBanner() {
    let msg = '';
    if (!S.storageOk) msg = 'This browser is blocking local storage, so your work will be lost when you close the page. Use Export in the Save & share tab to keep a copy.';
    else if (S.saveFailed) msg = 'Browser storage is full, so recent changes are not saved. Export this venue to a file, then delete venues you no longer need.';
    const b = $('banner');
    b.textContent = msg;
    b.hidden = !msg;
  }

  function renderStats() {
    const v = S.venue, a = S.analysis, u = v.units;
    const t = M.totals(v);
    syncValue($('targetInput'), v.target || '');
    $('seatCount').textContent = t.seats.toLocaleString('en-US');
    const chairs = $('chairCount');
    const short = v.chairs > 0 && t.chairs > v.chairs;
    chairs.textContent = v.chairs ? t.chairs + ' / ' + v.chairs : String(t.chairs);
    chairs.classList.toggle('over', short);

    const diff = t.seats - v.target;
    let msg, cls = '';
    if (!v.target) msg = 'Set a guest target to compare.';
    else if (diff > 0) { msg = plural(diff, 'more seat') + ' than guests.'; cls = 'ok'; }
    else if (diff === 0) { msg = 'One seat for every guest.'; cls = 'ok'; }
    else { msg = plural(-diff, 'seat') + ' short of the target.'; cls = 'bad'; }
    if (short) { msg += ' You need ' + plural(t.chairs - v.chairs, 'more chair') + ' than you have.'; cls = 'bad'; }
    const note = $('seatNote');
    note.textContent = msg;
    note.className = 'note ' + cls;

    $('scUsable').textContent = M.fmtArea(a.usable, u);
    $('scUsed').textContent = M.fmtArea(a.used, u) + ' (' + (a.usable > 0 ? Math.round((a.used / a.usable) * 100) : 0) + '%)';
    $('scFree').textContent = M.fmtArea(a.free, u);
    $('scPerGuest').textContent = a.freePerGuest === null ? 'n/a' : M.fmtAreaPrecise(a.freePerGuest, u);
    $('scCapacity').textContent = 'Room comfortably fits ~' + a.seated.toLocaleString('en-US') + ' seated or ~' + a.standing.toLocaleString('en-US') + ' standing.';
    const verdict = $('scVerdict');
    verdict.textContent = a.verdict;
    verdict.className = 'badge ' + a.vclass;
    const c = a.conflicts, cb = $('scConflicts');
    if (c.count) {
      cb.textContent = plural(c.count, 'conflict') + ': ' + c.reasons.join(', ');
      cb.className = 'badge bad';
      cb.disabled = false;
      cb.title = 'Select the next item with a conflict';
    } else {
      cb.textContent = 'No overlaps';
      cb.className = 'badge ok';
      cb.disabled = true;
      cb.removeAttribute('title');
    }

    $('printTitle').textContent = v.name;
    $('printMeta').textContent = M.fmtDim(v.room.w, u) + ' \u00d7 ' + M.fmtDim(v.room.h, u) + ' \u00b7 ' + plural(t.seats, 'seat') +
      (v.target ? ' for ' + plural(v.target, 'guest') : '') + ' \u00b7 ' + a.verdict;
    $('walkTip').textContent = 'Drag on the plan to measure; Esc clears. Aim for ' + len(3) + ' to ' + len(4) + ' walkways and ' +
      len(4) + ' to ' + len(5) + ' of clearance where guests queue, such as at a buffet or bar.';
  }

  function renderNextSteps() {
    const el = $('nextSteps'), v = S.venue;
    let html = '';
    if (!(S.prefs.dismissed && S.prefs.dismissed[v.id])) {
      if (v.name.indexOf(M.SAMPLE_NAME) === 0) {
        html = '<div class="card"><p><b>This is a sample venue.</b> Drag the tables around, then create a plan for your own space.</p>' +
          '<div class="card-actions"><button type="button" class="mini primary" data-act="new-venue" data-key="ns-new">Create your venue</button>' +
          '<button type="button" class="mini" data-act="dismiss-steps" data-key="ns-hide">Hide</button></div></div>';
      } else if (!v.items.length) {
        const step = (done, body) => '<li' + (done ? ' class="done"' : '') + '>' + (done ? icon('check') + '<span class="sr-only">Done: </span>' : '') + '<span>' + body + '</span></li>';
        const link = (tab, label) => '<button type="button" class="linkbtn inline" data-act="goto-tab" data-tab="' + tab + '" data-key="ns-' + tab + '">' + label + '</button>';
        html = '<div class="card"><p><b>Set up your venue in three steps</b></p><ol class="steps">' +
          step(v.features.length > 0, 'Add columns, doors, a stage and other fixed features in the ' + link('room', 'Room tab') + '.') +
          step(v.types.length > 0, 'List the tables and furniture you have in the ' + link('inventory', 'Inventory tab') + '.') +
          step(false, 'Add furniture from the list below, then drag it into place.') +
          '</ol><div class="card-actions"><button type="button" class="mini" data-act="dismiss-steps" data-key="ns-hide">Hide</button></div></div>';
      }
    }
    rebuild(el, html);
    el.hidden = !html;
  }

  function renderPalette() {
    const v = S.venue, u = v.units;
    if (!v.types.length) {
      rebuild($('palette'), '<p class="empty">No furniture yet. Add what you have in the ' +
        '<button type="button" class="linkbtn inline" data-act="goto-tab" data-tab="inventory" data-key="pal-inv">Inventory tab</button>.</p>');
      return;
    }
    const placed = M.totals(v).placed;
    let html = '<ul class="inv-list">';
    for (const t of v.types) {
      const n = placed[t.id] || 0;
      const dis = t.qty !== null && n >= t.qty ? ' disabled' : '';
      const name = esc(t.name), id = esc(t.id);
      const meta = M.fmtLen(t.w, u) + ' \u00d7 ' + M.fmtLen(t.h, u) + (t.seats && t.style !== 'zone' ? ' \u00b7 ' + plural(t.seats, 'seat') : '');
      html += '<li class="inv-row"><span class="swatch" style="background:' + t.color + '"></span>' +
        '<span class="inv-name">' + name + '<small>' + esc(meta) + '</small></span>' +
        '<span class="inv-count" title="Placed / available">' + (t.qty === null ? n : n + ' / ' + t.qty) + '</span>';
      if (M.canHaveChairs(t) && t.seats > 0) {
        html += '<button type="button" class="addbtn" data-act="add" data-type="' + id + '" data-bare="1" data-key="bare:' + id + '"' + dis +
          ' title="Add without chairs" aria-label="Add ' + name + ' without chairs">' + icon('table') + '</button>';
      }
      html += '<button type="button" class="addbtn" data-act="add" data-type="' + id + '" data-key="add:' + id + '"' + dis +
        ' title="Add to the floor" aria-label="Add ' + name + '">' + icon('plus') + '</button></li>';
    }
    rebuild($('palette'), html + '</ul>');
  }

  function renderLayouts() {
    const list = S.venue.layouts.slice().sort((a, b) => b.at - a.at);
    let html;
    if (!list.length) {
      html = '<p class="empty">No saved layouts yet. Save the floor to compare options.</p>';
    } else {
      html = '<ul class="save-list">' + list.map((L) => {
        const n = esc(L.name);
        return '<li class="save-row"><span class="save-name">' + n + '<small class="save-date">' + esc(dateStr(L.at) + ' \u00b7 ' + plural(L.items.length, 'item')) + '</small></span>' +
          '<button type="button" class="mini" data-act="layout-load" data-name="' + n + '" data-key="ll:' + n + '" aria-label="Load layout ' + n + '">Load</button>' +
          '<button type="button" class="mini x" data-act="layout-del" data-name="' + n + '" data-key="ld:' + n + '" aria-label="Delete layout ' + n + '">Delete</button></li>';
      }).join('') + '</ul>';
    }
    rebuild($('layoutList'), html);
  }

  function renderRoomTab() {
    const v = S.venue, u = v.units;
    syncValue($('roomName'), v.name);
    syncValue($('roomW'), M.fmtInput(v.room.w, u));
    syncValue($('roomH'), M.fmtInput(v.room.h, u));
    syncValue($('roomUnits'), u);
    syncValue($('roomCaption'), v.caption || '');
    $('roomCaption').placeholder = v.name.toUpperCase() + ' \u00b7 ' + M.fmtDim(v.room.w, u) + ' \u00d7 ' + M.fmtDim(v.room.h, u);
    $('outlineNote').hidden = !v.outline;
    $('featCount').textContent = v.features.length ? String(v.features.length) : '';
    $('roomHelp').textContent = u === 'm' ? 'Meters, for example 18.5 or 1850 cm.' : 'Feet and inches, for example 62\' 6" or 62.5.';
    renderFeatureList();
  }

  function renderFeatureList() {
    const v = S.venue;
    let html;
    if (!v.features.length) {
      html = '<p class="empty">No fixed features yet. Add anything that cannot move, such as columns, doors or a stage.</p>';
    } else {
      html = '<ul class="save-list">' + v.features.map((f) => {
        const k = M.FEATURE_KINDS[f.kind];
        const name = f.label ? f.label.replace(/\s*\n\s*/g, ' ') : k.name;
        const on = !!(S.sel && S.sel.kind === 'feature' && S.sel.id === f.id);
        const id = esc(f.id);
        return '<li class="save-row' + (on ? ' is-sel' : '') + '"><span class="kind-dot k-' + f.kind + '" aria-hidden="true"></span>' +
          '<button type="button" class="save-name linklike" data-act="feature-sel" data-id="' + id + '" data-key="fs:' + id + '" aria-pressed="' + on + '">' + esc(name) +
          '<small>' + esc((f.label ? k.name + ' \u00b7 ' : '') + len(f.w) + ' \u00d7 ' + len(f.h)) + '</small></button>' +
          '<button type="button" class="xbtn" data-act="feature-del" data-id="' + id + '" data-key="fd:' + id + '" aria-label="Delete ' + esc(name) + '" title="Delete">' + icon('x') + '</button></li>';
      }).join('') + '</ul>';
    }
    rebuild($('featureList'), html);
  }

  function renderInventoryTab() {
    const v = S.venue, u = v.units;
    let html;
    if (!v.types.length) {
      html = '<p class="empty">No item types yet. Add the tables and furniture you have below.</p>';
    } else {
      html = '<ul class="inv-list">' + v.types.map((t) => {
        const name = esc(t.name), id = esc(t.id);
        const meta = M.ITEM_STYLES[t.style].name.split(',')[0] + ' \u00b7 ' + M.fmtLen(t.w, u) + ' \u00d7 ' + M.fmtLen(t.h, u) +
          (t.seats && t.style !== 'zone' ? ' \u00b7 ' + plural(t.seats, 'seat') : '') + ' \u00b7 ' + (t.qty === null ? 'no limit' : 'you have ' + t.qty);
        return '<li class="inv-row' + (S.editingType === t.id ? ' is-sel' : '') + '"><span class="swatch" style="background:' + t.color + '"></span>' +
          '<span class="inv-name">' + name + '<small>' + esc(meta) + '</small></span>' +
          '<button type="button" class="mini" data-act="type-edit" data-id="' + id + '" data-key="te:' + id + '" aria-label="Edit ' + name + '">Edit</button>' +
          '<button type="button" class="xbtn" data-act="type-del" data-id="' + id + '" data-key="td:' + id + '" aria-label="Remove ' + name + '" title="Remove">' + icon('x') + '</button></li>';
      }).join('') + '</ul>';
    }
    rebuild($('typeList'), html);
    syncValue($('chairsInput'), v.chairs || '');
  }

  function renderVenueList() {
    const list = store.list();
    let html;
    if (!list.length) {
      html = '<p class="empty">Nothing is saved in this browser yet.</p>';
    } else {
      html = '<ul class="save-list">' + list.map((e) => {
        const cur = !S.ephemeral && e.id === S.venue.id;
        const name = esc(cur ? S.venue.name : e.name), id = esc(e.id);
        return '<li class="save-row' + (cur ? ' is-sel' : '') + '"><span class="save-name">' + name + (cur ? ' <span class="tag">Open</span>' : '') +
          '<small class="save-date">' + esc(dateStr(cur ? S.venue.updatedAt : e.updatedAt)) + '</small></span>' +
          (cur ? '' : '<button type="button" class="mini" data-act="venue-open" data-id="' + id + '" data-key="vo:' + id + '" aria-label="Open ' + name + '">Open</button>') +
          '<button type="button" class="mini x" data-act="venue-del" data-id="' + id + '" data-key="vd:' + id + '" aria-label="Delete ' + name + '">Delete</button></li>';
      }).join('') + '</ul>';
    }
    rebuild($('venueList'), html);
  }

  function renderSync() {
    let html = '', bar = '';
    const st = S.cloudState;
    if (st === 'off') {
      html = '<p class="help">Sync is not set up on this site, so everything stays in this browser. If you host your own copy, you can turn on sync with a free Supabase project; see the README.</p>';
    } else if (st === 'loading') {
      html = '<p class="help">Connecting to the sync service\u2026</p>';
    } else if (st === 'error') {
      html = '<p class="field-error">' + esc(S.cloudError) + '</p><p class="help">Your venues are still saved in this browser.</p>' +
        '<button type="button" class="btn" data-act="sync-now" data-key="sy-retry">Try again</button>';
    } else if (st === 'out') {
      html = '<p class="help">Sign in to back up your venues and open them on other devices.</p>' +
        '<button type="button" class="btn primary" data-act="sync-signin" data-key="sy-in">Sign in or create an account</button>';
    } else if (st === 'in') {
      const who = esc((cloud.user && cloud.user.email) || 'your account');
      const when = S.lastSync ? ' Last synced at ' + esc(new Date(S.lastSync).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })) + '.' : '';
      html = '<p class="help">Signed in as <b>' + who + '</b>.' + when + '</p>' +
        '<div class="row-inline"><button type="button" class="btn" data-act="sync-now" data-key="sy-now"' + (S.syncing ? ' disabled' : '') + '>' +
        (S.syncing ? 'Syncing\u2026' : 'Sync now') + '</button><button type="button" class="btn" data-act="sync-signout" data-key="sy-out">Sign out</button></div>';
      bar = '<span>' + icon('cloud') + ' Syncing as ' + who + '</span><button type="button" class="mini" data-act="sync-signout" data-key="ub-out">Sign out</button>';
    }
    rebuild($('syncBox'), html);
    rebuild($('userBar'), bar);
    $('userBar').hidden = !bar;
  }

  // ---------- plan rendering ----------
  function renderScene() {
    const v = S.venue, svg = $('planSvg');
    const vb = P.viewBox(v);
    svg.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
    const active = document.activeElement;
    let focusSel = null;
    if (active && active !== svg && svg.contains(active)) {
      if (active.hasAttribute('data-item')) focusSel = '[data-item="' + cssId(active.getAttribute('data-item')) + '"]';
      else if (active.hasAttribute('data-feat')) focusSel = '[data-feat="' + cssId(active.getAttribute('data-feat')) + '"]';
    }
    $('scene').innerHTML = P.sceneSVG(v, { grid: S.prefs.grid, dims: S.prefs.dims, mode: mode(), interactive: true });
    svg.classList.toggle('mode-room', mode() === 'room');
    if (S.fit) fitZoom(); else applyZoom();
    renderOverlay();
    renderMeasure();
    $('planEmpty').hidden = mode() === 'room' || v.items.length > 0;
    if (focusSel) {
      const el = svg.querySelector(focusSel);
      if (el && el.hasAttribute('tabindex')) el.focus({ preventScroll: true });
      else $('planScroller').focus({ preventScroll: true });
    }
    $('gridLabel').textContent = 'Show ' + len(P.gridStep(v)) + ' grid';
    $('snapLabel').textContent = 'Snap to ' + (v.units === 'm' ? '0.5 m' : '1\u2032') + ' steps';
  }

  function renderOverlay() {
    $('overlay').innerHTML = P.overlaySVG(S.venue, { sel: S.sel, conflicts: S.analysis ? S.analysis.conflicts.ids : null, zoom: S.zoom });
  }

  function renderMeasure() {
    const m = S.mline;
    $('measureLayer').innerHTML = m ? P.measureSVG(m, units(), S.zoom) : '';
    let msg = '';
    if (m) msg = 'Distance: ' + len(Math.hypot(m.x2 - m.x1, m.y2 - m.y1));
    else if (S.measuring) msg = 'Drag on the plan between two points.';
    $('measureOut').textContent = msg;
  }

  // ---------- zoom ----------
  function applyZoom() {
    const vb = P.viewBox(S.venue), svg = $('planSvg');
    svg.style.width = Math.round(vb.w * S.zoom) + 'px';
    svg.style.height = Math.round(vb.h * S.zoom) + 'px';
    const pct = Math.round(S.zoom * 100) + '%';
    $('zoomLabel').textContent = pct;
    $('zoomFitBtn').setAttribute('aria-label', 'Fit the plan to the window. Zoom is ' + pct + '.');
  }

  function fitZoom() {
    const sc = $('planScroller'), vb = P.viewBox(S.venue);
    const w = sc.clientWidth - 16, h = sc.clientHeight - 16;
    S.fit = true;
    if (w > 40 && h > 40) S.zoom = M.clamp(Math.min(w / vb.w, h / vb.h), 0.1, 4);
    applyZoom();
  }

  function clientToUser(x, y) {
    const m = $('planSvg').getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(x, y).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }
  function userToClient(x, y) {
    const m = $('planSvg').getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(x, y).matrixTransform(m);
    return { x: p.x, y: p.y };
  }
  function toFeet(e) {
    const p = clientToUser(e.clientX, e.clientY);
    return { x: p.x / FT, y: p.y / FT };
  }

  // Zooms while keeping the plan point under (cx, cy) in place; defaults to the view centre.
  function setZoom(z, cx, cy) {
    const sc = $('planScroller');
    if (cx === undefined) {
      const r = sc.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
    }
    const anchor = clientToUser(cx, cy);
    S.zoom = M.clamp(z, 0.1, 4);
    S.fit = false;
    applyZoom();
    const after = userToClient(anchor.x, anchor.y);
    sc.scrollLeft += after.x - cx;
    sc.scrollTop += after.y - cy;
    renderOverlay();
    renderMeasure();
  }

  function zoomToFit() {
    fitZoom();
    renderOverlay();
    renderMeasure();
  }

  // Centre of the visible part of the plan, in feet, kept inside the room.
  function viewCenter() {
    const r = $('planScroller').getBoundingClientRect();
    const p = clientToUser(r.left + r.width / 2, r.top + r.height / 2);
    return { x: M.clamp(p.x / FT, 0, S.venue.room.w), y: M.clamp(p.y / FT, 0, S.venue.room.h) };
  }

  function selectedEl() {
    if (!S.sel) return null;
    const attr = S.sel.kind === 'item' ? 'data-item' : 'data-feat';
    return $('scene').querySelector('[' + attr + '="' + cssId(S.sel.id) + '"]');
  }

  // Scrolls the plan so the selection is visible.
  function revealSelection() {
    const el = selectedEl();
    if (!el) return;
    const sc = $('planScroller');
    const r = el.getBoundingClientRect(), sr = sc.getBoundingClientRect();
    const m = 24;
    if (r.left < sr.left + m) sc.scrollLeft -= sr.left + m - r.left;
    else if (r.right > sr.right - m) sc.scrollLeft += Math.min(r.right - sr.right + m, r.left - sr.left - m);
    if (r.top < sr.top + m) sc.scrollTop -= sr.top + m - r.top;
    else if (r.bottom > sr.bottom - m) sc.scrollTop += Math.min(r.bottom - sr.bottom + m, r.top - sr.top - m);
  }

  // ---------- selection, action bar and details ----------
  function setDisabled(el, dis) {
    if (dis && document.activeElement === el) $('planScroller').focus({ preventScroll: true });
    el.disabled = dis;
  }

  function renderSelection() {
    renderOverlay();
    renderActionBar();
    renderInspector();
    renderFeatureList();
  }

  function select(kind, id) {
    const same = S.sel && kind && S.sel.kind === kind && S.sel.id === id;
    if (same || (!S.sel && !kind)) return;
    S.sel = kind ? { kind, id } : null;
    S.group = null;
    renderSelection();
  }

  function renderActionBar() {
    const s = selected();
    let name = 'Nothing', warn = '';
    if (s && S.sel.kind === 'item') {
      name = M.describeItem(s, typeById(s.type), units());
      const reason = S.analysis && S.analysis.conflicts.byItem.get(s.id);
      if (reason) warn = cap(reason);
    } else if (s) {
      name = M.describeFeature(s, units());
    }
    $('selName').textContent = name;
    const w = $('selWarn');
    w.textContent = warn;
    w.hidden = !warn;
    const none = !s;
    setDisabled($('rotBtn'), none);
    setDisabled($('rot15Btn'), none);
    setDisabled($('delBtn'), none);
    setDisabled($('detailsBtn'), none);
    setDisabled($('dupBtn'), none || (S.sel.kind === 'item' && atLimit(typeById(s.type))));
    setDisabled($('undoBtn'), !S.undo.length);
    setDisabled($('redoBtn'), !S.redo.length);
    if (none) showDetails(false);
  }

  function showDetails(on) {
    $('main').classList.toggle('show-details', on);
    $('detailsBtn').setAttribute('aria-expanded', on ? 'true' : 'false');
  }

  const SHAPES = [
    ['rect', 'Rectangle'], ['round', 'Round or oval'],
    ['tri-tl', 'Triangle, square corner top left'], ['tri-tr', 'Triangle, square corner top right'],
    ['tri-br', 'Triangle, square corner bottom right'], ['tri-bl', 'Triangle, square corner bottom left'],
  ];
  const lenField = (id, label) => '<label class="field"><span>' + label + '</span><input id="' + id + '" inputmode="decimal" autocomplete="off" spellcheck="false"></label>';
  const rotField = '<label class="field"><span>Rotation<span class="sr-only"> in degrees</span> <span aria-hidden="true">(\u00b0)</span></span><input id="inRot" type="number" step="any" inputmode="decimal"></label>';

  function inspectorHTML(isItem, hasChairs) {
    if (isItem) {
      return '<label class="field wide"><span>Label</span><input id="inLabel" maxlength="80" autocomplete="off"></label>' +
        lenField('inX', 'From left') + lenField('inY', 'From top') + rotField +
        (hasChairs ? '<label class="toggle"><input type="checkbox" id="inChairs"> With chairs</label>' : '');
    }
    return '<label class="field"><span>Feature</span><select id="inKind">' +
      M.FEATURE_ORDER.map((k) => '<option value="' + k + '">' + esc(M.FEATURE_KINDS[k].name) + '</option>').join('') + '</select></label>' +
      '<label class="field wide"><span>Label (| starts a new line)</span><input id="inLabel" maxlength="200" autocomplete="off"></label>' +
      lenField('inX', 'From left') + lenField('inY', 'From top') + lenField('inW', 'Width') + lenField('inH', 'Depth') + rotField +
      '<label class="field"><span>Shape</span><select id="inShape">' +
      SHAPES.map(([val, label]) => '<option value="' + val + '">' + label + '</option>').join('') + '</select></label>';
  }

  const fmtPos = (ft) => (ft < 0 ? '-' : '') + M.fmtInput(Math.abs(ft), units());
  function parsePos(str) {
    const t = String(str).trim();
    const neg = t[0] === '-';
    const n = M.parseLength(neg ? t.slice(1) : t, units());
    return neg ? -n : n;
  }

  function renderInspector(force) {
    const s = selected(), box = $('inspector');
    if (!s) {
      if (!box.classList.contains('is-empty') || S.inspKey) {
        if (box.contains(document.activeElement)) $('planScroller').focus({ preventScroll: true });
        box.classList.add('is-empty');
        $('inspFields').innerHTML = '';
        $('inError').textContent = '';
        S.inspKey = '';
      }
      return;
    }
    const isItem = S.sel.kind === 'item';
    const t = isItem ? typeById(s.type) : null;
    const hasChairs = !!(t && M.canHaveChairs(t) && t.seats > 0);
    const key = (isItem ? 'i:' : 'f:') + s.id + ':' + units() + ':' + hasChairs;
    const fresh = key !== S.inspKey;
    if (fresh) {
      S.inspKey = key;
      $('inspFields').innerHTML = inspectorHTML(isItem, hasChairs);
      $('inError').textContent = '';
    }
    box.classList.remove('is-empty');
    const set = (id, val) => syncValue($(id), val, fresh || force === id);
    if (isItem) {
      set('inLabel', s.label || '');
      $('inLabel').placeholder = t.label || t.name;
      if (hasChairs) set('inChairs', !s.bare);
    } else {
      set('inKind', s.kind);
      set('inLabel', (s.label || '').replace(/\n/g, ' | '));
      $('inLabel').placeholder = 'No label';
      set('inW', M.fmtInput(s.w, units()));
      set('inH', M.fmtInput(s.h, units()));
      set('inShape', s.shape === 'tri' ? 'tri-' + (s.corner || 'tl') : s.shape === 'round' ? 'round' : 'rect');
    }
    set('inX', fmtPos(s.x));
    set('inY', fmtPos(s.y));
    set('inRot', String(s.rot || 0));
  }

  function onInspectorChange(e) {
    const el = e.target, s = selected();
    if (!s || !el.id) return;
    const isItem = S.sel.kind === 'item', v = S.venue, u = units();
    const fail = (msg) => { setInvalid(el, true); $('inError').textContent = msg; };
    setInvalid(el, false);
    $('inError').textContent = '';
    const keep = () => renderInspector(el.id);
    switch (el.id) {
      case 'inLabel': {
        const val = isItem ? M.oneLine(el.value, 80) : M.text(el.value.replace(/\s*\|\s*/g, '\n'), 200);
        if (val === (s.label || '')) return keep();
        checkpoint('label:' + s.id);
        if (val) s.label = val;
        else delete s.label;
        break;
      }
      case 'inX':
      case 'inY': {
        const n = parsePos(el.value);
        const max = el.id === 'inX' ? v.room.w : v.room.h;
        if (!Number.isFinite(n) || Math.abs(n) > max * 2) return fail('Enter a distance such as ' + (u === 'm' ? '2.5' : '12\' 6"') + '.');
        const prop = el.id === 'inX' ? 'x' : 'y';
        if (M.r3(n) === s[prop]) return keep();
        checkpoint();
        s[prop] = M.r3(n);
        if (isItem) clampItem(s);
        else clampFeature(s);
        break;
      }
      case 'inW':
      case 'inH': {
        const n = M.parseLength(el.value, u);
        if (!Number.isFinite(n) || n < 0.1 || n > M.ROOM_MAX) return fail('Enter a size between ' + len(0.1) + ' and ' + len(M.ROOM_MAX) + '.');
        const prop = el.id === 'inW' ? 'w' : 'h';
        if (M.r3(n) === s[prop]) return keep();
        checkpoint();
        s[prop] = M.r3(n);
        clampFeature(s);
        break;
      }
      case 'inRot': {
        const n = Number(el.value);
        if (el.value.trim() === '' || !Number.isFinite(n)) return fail('Enter an angle in degrees, such as 90.');
        if (M.normRot(n) === (s.rot || 0)) return keep();
        checkpoint('rot:' + s.id);
        s.rot = M.normRot(n);
        if (isItem) clampItem(s);
        else clampFeature(s);
        break;
      }
      case 'inChairs':
        setBare(s, !el.checked);
        return;
      case 'inKind': {
        const from = M.FEATURE_KINDS[s.kind], to = M.FEATURE_KINDS[el.value];
        if (!to || el.value === s.kind) return;
        checkpoint();
        if ((s.label || '') === from.label) {
          if (to.label) s.label = to.label;
          else delete s.label;
        }
        s.kind = el.value;
        break;
      }
      case 'inShape': {
        checkpoint();
        if (el.value === 'round') { s.shape = 'round'; delete s.corner; }
        else if (el.value.indexOf('tri-') === 0) { s.shape = 'tri'; s.corner = el.value.slice(4); }
        else { delete s.shape; delete s.corner; }
        break;
      }
      default:
        return;
    }
    changed();
    renderInspector(el.id);
  }

  // ---------- editing on the plan ----------
  function snapStep() {
    const metric = units() === 'm';
    if (S.prefs.snap) return metric ? 0.5 / M.M_PER_FT : 1;
    return metric ? 0.01 / M.M_PER_FT : 1 / 12;
  }
  const snapVal = (v) => { const st = snapStep(); return M.r3(Math.round(v / st) * st); };
  const snapPoint = (p) => ({ x: snapVal(p.x), y: snapVal(p.y) });

  // Keeps the centre of a box inside the room; anything hanging over a wall is flagged by the space check.
  function clampBox(o, w, h) {
    const W = S.venue.room.w, H = S.venue.room.h;
    o.x = M.r3(M.clamp(o.x + w / 2, 0, W) - w / 2);
    o.y = M.r3(M.clamp(o.y + h / 2, 0, H) - h / 2);
  }
  function clampItem(it) {
    const t = typeById(it.type);
    if (!t) return;
    const fp = M.footprint(it, t);
    clampBox(it, fp.w, fp.h);
  }
  const clampFeature = (f) => clampBox(f, f.w, f.h);

  // Commits a half-typed value (its change event fires on blur) before the plan is edited directly.
  function commitTyping() {
    const ae = document.activeElement;
    if (ae && ae !== document.body && isTyping(ae)) ae.blur();
  }

  let restoring = false;
  function focusQuietly(el) {
    restoring = true;
    try { el.focus({ preventScroll: true }); } finally { restoring = false; }
  }

  function onPointerDown(e) {
    if (e.button > 0 || S.drag) return;
    const svg = $('planSvg'), sc = $('planScroller');
    const room = mode() === 'room';
    const attr = room ? 'data-feat' : 'data-item';
    const hit = e.target.closest('[' + attr + ']');
    const hitId = hit ? hit.getAttribute(attr) : null;
    const onHandle = room && !!e.target.closest('[data-handle]');
    const onFeature = !room && !!e.target.closest('[data-feat]');
    hideTip();
    commitTyping();
    const start = toFeet(e);
    const base = { pid: e.pointerId, sx: e.clientX, sy: e.clientY, start, moved: false };

    if (S.measuring) {
      const p = S.prefs.snap ? snapPoint(start) : start;
      S.mline = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
      S.drag = Object.assign(base, { kind: 'measure' });
      svg.setPointerCapture(e.pointerId);
      renderMeasure();
      e.preventDefault();
      return;
    }
    if (onHandle && S.sel && S.sel.kind === 'feature') {
      const f = findFeature(S.sel.id);
      if (f) {
        S.drag = Object.assign(base, { kind: 'resize', obj: f, orig: { x: f.x, y: f.y, w: f.w, h: f.h, rot: f.rot || 0 }, p0: G.toWorld(f, 0, 0) });
        svg.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }
    const obj = hitId ? (room ? findFeature(hitId) : findItem(hitId)) : null;
    if (obj) {
      select(room ? 'feature' : 'item', obj.id);
      const el = $('scene').querySelector('[' + attr + '="' + cssId(obj.id) + '"]');
      if (el) focusQuietly(el);
      S.drag = Object.assign(base, { kind: 'move', obj, isItem: !room, el, ox: obj.x, oy: obj.y });
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    S.drag = Object.assign(base, { kind: 'bg', sl: sc.scrollLeft, st: sc.scrollTop, mouse: e.pointerType === 'mouse', onFeature });
    if (S.drag.mouse) svg.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    const d = S.drag;
    if (!d) {
      if (e.pointerType === 'mouse') hoverTip(e);
      return;
    }
    if (e.pointerId !== d.pid) return;
    if (d.kind === 'measure') {
      const p = S.prefs.snap ? snapPoint(toFeet(e)) : toFeet(e);
      S.mline.x2 = p.x;
      S.mline.y2 = p.y;
      renderMeasure();
      return;
    }
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < (d.kind === 'bg' ? 6 : 3)) return;
      d.moved = true;
      if (d.kind !== 'bg') {
        checkpoint();
        $('planSvg').classList.add('dragging');
      }
    }
    if (d.kind === 'bg') {
      if (d.mouse) {
        const sc = $('planScroller');
        sc.scrollLeft = d.sl - dx;
        sc.scrollTop = d.st - dy;
      }
      return;
    }
    const p = toFeet(e);
    if (d.kind === 'move') {
      const o = d.obj;
      o.x = snapVal(d.ox + p.x - d.start.x);
      o.y = snapVal(d.oy + p.y - d.start.y);
      if (d.isItem) clampItem(o);
      else clampFeature(o);
      if (d.el) d.el.setAttribute('transform', P.groupTransform(d.isItem ? M.itemBox(o, typeById(o.type)) : o));
    } else {
      resizeDrag(d, p);
    }
    renderOverlay();
    renderInspector();
    analyzeSoon();
  }

  // Resizes from the bottom-right handle while the top-left corner stays put, in the feature's own rotated frame.
  function resizeDrag(d, p) {
    const f = d.obj, o = d.orig;
    const a = (o.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const dx = p.x - d.start.x, dy = p.y - d.start.y;
    const w = Math.max(0.25, snapVal(o.w + dx * c + dy * s));
    const h = Math.max(0.25, snapVal(o.h - dx * s + dy * c));
    const px = d.p0[0], py = d.p0[1];
    f.w = M.r3(w);
    f.h = M.r3(h);
    f.x = M.r3(px - w / 2 + (w / 2) * c - (h / 2) * s);
    f.y = M.r3(py - h / 2 + (w / 2) * s + (h / 2) * c);
    if (!d.raf) {
      d.raf = requestAnimationFrame(() => {
        d.raf = 0;
        const el = $('scene').querySelector('[data-feat="' + cssId(f.id) + '"]');
        if (el) el.outerHTML = P.featureSVG(f, { units: units(), interactive: true });
      });
    }
  }

  function onPointerUp(e) {
    const d = S.drag;
    if (!d || e.pointerId !== d.pid) return;
    S.drag = null;
    const svg = $('planSvg');
    svg.classList.remove('dragging');
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    if (d.raf) cancelAnimationFrame(d.raf);
    if (d.kind === 'measure') {
      const m = S.mline;
      const dist = m ? Math.hypot(m.x2 - m.x1, m.y2 - m.y1) : 0;
      if (dist < 0.1) S.mline = null;
      renderMeasure();
      if (S.mline) announce('Distance ' + len(dist));
      return;
    }
    if (d.kind === 'bg') {
      if (!d.moved && e.type === 'pointerup') {
        if (d.onFeature && Date.now() - S.hintAt > 5000) {
          S.hintAt = Date.now();
          toast('Fixed features are edited in the Room tab.');
        }
        select(null);
      }
      return;
    }
    if (d.moved) {
      changed();
      const el = selectedEl();
      if (el && document.activeElement !== el) focusQuietly(el);
    }
  }

  function hoverTip(e) {
    const room = mode() === 'room';
    const el = !S.measuring && e.target.closest ? e.target.closest(room ? '[data-feat]' : '[data-item]') : null;
    let text = '';
    if (el && room) {
      const f = findFeature(el.getAttribute('data-feat'));
      if (f) text = M.describeFeature(f, units());
    } else if (el) {
      const it = findItem(el.getAttribute('data-item'));
      const t = it && typeById(it.type);
      if (t) {
        text = M.describeItem(it, t, units());
        const reason = S.analysis && S.analysis.conflicts.byItem.get(it.id);
        if (reason) text += ' \u00b7 ' + reason;
      }
    }
    if (!text) return hideTip();
    const tip = $('tip');
    tip.textContent = text;
    tip.classList.add('show');
    const x = Math.max(8, Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8));
    const y = e.clientY + 18 + tip.offsetHeight > window.innerHeight - 8 ? e.clientY - tip.offsetHeight - 10 : e.clientY + 18;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
  function hideTip() { $('tip').classList.remove('show'); }

  function onFocusIn(e) {
    if (restoring || !e.target.getAttribute) return;
    const it = e.target.getAttribute('data-item'), f = e.target.getAttribute('data-feat');
    if (it && mode() === 'plan') select('item', it);
    else if (f && mode() === 'room') select('feature', f);
  }

  function editDetails() {
    if (!S.sel) return;
    showDetails(true);
    const input = $('inLabel');
    if (input) { input.focus(); input.select(); }
  }

  function onDblClick(e) {
    const room = mode() === 'room';
    const el = e.target.closest(room ? '[data-feat]' : '[data-item]');
    if (!el) return;
    select(room ? 'feature' : 'item', el.getAttribute(room ? 'data-feat' : 'data-item'));
    editDetails();
  }

  function onKeyDown(e) {
    if (document.querySelector('dialog[open]')) return;
    const typing = isTyping(e.target);
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (typing) return;
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (k === 'y') { e.preventDefault(); redo(); }
      else if (k === 'd' && S.sel) { e.preventDefault(); duplicate(); }
      return;
    }
    if (typing || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest && e.target.closest('[role="tablist"]')) return;
    const k = e.key;
    if (k === 'Escape') {
      if (S.mline) { S.mline = null; renderMeasure(); }
      else if (S.measuring) setMeasuring(false);
      else if (S.sel) select(null);
      else return;
      e.preventDefault();
      return;
    }
    if (k === 'm' || k === 'M') { e.preventDefault(); setMeasuring(!S.measuring); return; }
    // Selection shortcuts only apply while the plan area has focus, so sidebar controls keep their usual keys.
    const inPlan = e.target === document.body || $('main').contains(e.target);
    if (!S.sel || !inPlan) return;
    if (k === 'r' || k === 'R') { e.preventDefault(); rotate(e.shiftKey ? 15 : 90); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); removeSelection(); }
    else if (k === 'Enter' && e.target.closest && e.target.closest('#planSvg')) { e.preventDefault(); editDetails(); }
    else {
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
      if (!dir) return;
      e.preventDefault();
      nudge(dir[0], dir[1], e.shiftKey);
    }
  }

  function setMeasuring(on) {
    S.measuring = !!on;
    if (!S.measuring) S.mline = null;
    $('planSvg').classList.toggle('measuring', S.measuring);
    for (const id of ['measureBtn', 'measureTool']) {
      $(id).setAttribute('aria-pressed', S.measuring ? 'true' : 'false');
      $(id).classList.toggle('active', S.measuring);
    }
    hideTip();
    renderMeasure();
    announce(S.measuring ? 'Tape measure on. Drag on the plan between two points.' : 'Tape measure off.');
  }

  // ---------- operations ----------
  // Places an item at the nearest clear spot to (cx, cy), allowing for its rotation. Returns false if none was clear.
  function itemSpot(it, t, cx, cy) {
    const fp = M.footprint(it, t);
    const a = ((it.rot || 0) * Math.PI) / 180;
    const bw = Math.abs(fp.w * Math.cos(a)) + Math.abs(fp.h * Math.sin(a));
    const bh = Math.abs(fp.w * Math.sin(a)) + Math.abs(fp.h * Math.cos(a));
    const spot = M.findFreeSpot(S.venue, bw, bh, cx, cy);
    it.x = M.r3(spot.x + bw / 2 - fp.w / 2);
    it.y = M.r3(spot.y + bh / 2 - fp.h / 2);
    return spot.free;
  }

  function addItem(typeId, bare) {
    const t = typeById(typeId);
    if (!t) return;
    if (atLimit(t)) { toast('All ' + t.qty + ' of ' + t.name + ' are already placed.'); return; }
    if (mode() !== 'plan') setTab('plan');
    const it = { id: M.uid('i'), type: t.id, x: 0, y: 0, rot: 0 };
    if (bare && M.canHaveChairs(t)) it.bare = true;
    const c = viewCenter();
    const free = itemSpot(it, t, c.x, c.y);
    checkpoint();
    S.venue.items.push(it);
    S.sel = { kind: 'item', id: it.id };
    changed();
    revealSelection();
    if (!free) toast('There is no clear space left, so it was placed on top of other furniture. Drag it somewhere free.');
    else announce('Added ' + M.itemLabel(it, t) + '. ' + plural(M.totals(S.venue).seats, 'seat') + ' in total.');
  }

  function addFeature(kind) {
    const k = M.FEATURE_KINDS[kind];
    if (!k) return;
    const v = S.venue;
    if (mode() !== 'room') setTab('room');
    const w = Math.min(k.w, v.room.w), h = Math.min(k.h, v.room.h);
    const c = viewCenter();
    let x = M.clamp(c.x - w / 2, 0, v.room.w - w), y = M.clamp(c.y - h / 2, 0, v.room.h - h);
    if (k.block !== 'none') {
      const spot = M.findFreeSpot(v, w, h, c.x, c.y);
      x = spot.x;
      y = spot.y;
    }
    const f = { id: M.uid('f'), kind, x: M.r3(x), y: M.r3(y), w, h, rot: 0 };
    if (k.label) f.label = k.label;
    checkpoint();
    v.features.push(f);
    S.sel = { kind: 'feature', id: f.id };
    changed();
    revealSelection();
    if (!S.prefs.featureHint) {
      S.prefs.featureHint = true;
      store.setPrefs(S.prefs);
      toast('Drag the ' + k.name.toLowerCase() + ' into place and drag its corner handle to resize, or type exact sizes in the selection details.');
    } else {
      announce('Added ' + k.name.toLowerCase() + '.');
    }
  }

  function duplicate() {
    const s = selected();
    if (!s) return;
    if (S.sel.kind === 'item') {
      const t = typeById(s.type);
      if (atLimit(t)) { toast('All ' + t.qty + ' of ' + t.name + ' are already placed.'); return; }
      const copy = Object.assign({}, s, { id: M.uid('i') });
      const fp = M.footprint(s, t);
      itemSpot(copy, t, s.x + fp.w / 2 + 2, s.y + fp.h / 2 + 2);
      checkpoint();
      S.venue.items.push(copy);
      S.sel = { kind: 'item', id: copy.id };
    } else {
      const copy = Object.assign({}, s, { id: M.uid('f'), x: s.x + 2, y: s.y + 2 });
      clampFeature(copy);
      checkpoint();
      S.venue.features.push(copy);
      S.sel = { kind: 'feature', id: copy.id };
    }
    changed();
    revealSelection();
    announce('Duplicated.');
  }

  function rotate(deg) {
    const s = selected();
    if (!s) return;
    checkpoint('rot:' + s.id);
    s.rot = M.normRot((s.rot || 0) + deg);
    if (S.sel.kind === 'item') clampItem(s);
    else clampFeature(s);
    changed();
  }

  function removeSelection() {
    const s = selected();
    if (!s) return;
    const isItem = S.sel.kind === 'item';
    const name = isItem ? M.itemLabel(s, typeById(s.type)) : M.describeFeature(s, units()).split(' \u00b7 ')[0];
    checkpoint();
    if (isItem) S.venue.items = S.venue.items.filter((i) => i !== s);
    else S.venue.features = S.venue.features.filter((f) => f !== s);
    S.sel = null;
    changed();
    announce('Removed ' + name + '. Use Undo to bring it back.');
  }

  function deleteFeature(id) {
    const f = findFeature(id);
    if (!f) return;
    checkpoint();
    S.venue.features = S.venue.features.filter((x) => x !== f);
    if (S.sel && S.sel.id === id) S.sel = null;
    changed();
    announce('Removed ' + M.describeFeature(f, units()).split(' \u00b7 ')[0] + '.');
  }

  function nudge(dx, dy, big) {
    const s = selected();
    if (!s) return;
    const step = units() === 'm' ? (big ? 1 : 0.25) / M.M_PER_FT : big ? 5 : 1;
    checkpoint('nudge:' + s.id);
    s.x = M.r3(s.x + dx * step);
    s.y = M.r3(s.y + dy * step);
    if (S.sel.kind === 'item') clampItem(s);
    else clampFeature(s);
    changed();
  }

  // Adds or removes a table's chairs, keeping the table where it is.
  function setBare(it, bare) {
    const t = typeById(it.type);
    if (!t || !!it.bare === bare) return;
    const before = M.footprint(it, t);
    checkpoint();
    if (bare) it.bare = true;
    else delete it.bare;
    const after = M.footprint(it, t);
    it.x = M.r3(it.x + (before.w - after.w) / 2);
    it.y = M.r3(it.y + (before.h - after.h) / 2);
    changed();
  }

  function cycleConflict() {
    const ids = S.venue.items.filter((i) => S.analysis.conflicts.ids.has(i.id)).map((i) => i.id);
    if (!ids.length) return;
    if (mode() !== 'plan') setTab('plan');
    const id = ids[S.conflictIdx % ids.length];
    S.conflictIdx = (S.conflictIdx + 1) % ids.length;
    select('item', id);
    revealSelection();
    const it = findItem(id);
    announce(M.itemLabel(it, typeById(it.type)) + ' ' + S.analysis.conflicts.byItem.get(id) + '.');
  }

  // ---------- saved layouts ----------
  const stripId = (it) => { const c = Object.assign({}, it); delete c.id; return c; };

  async function saveLayout(e) {
    e.preventDefault();
    const input = $('layoutName'), v = S.venue;
    const name = M.oneLine(input.value, 80);
    if (!name) {
      input.focus();
      toast('Type a name for this layout first.');
      return;
    }
    if (v.layouts.some((L) => L.name === name)) {
      const ok = await ask('Replace layout?', 'A layout called "' + name + '" already exists. Replace it with what is on the floor now?',
        [{ label: 'Cancel', value: false, focus: true }, { label: 'Replace', value: true, primary: true }]);
      if (!ok) return;
    } else if (v.layouts.length >= 100) {
      info('Too many layouts', 'This venue already has 100 saved layouts. Delete some before saving more.');
      return;
    }
    v.layouts = v.layouts.filter((L) => L.name !== name);
    v.layouts.push({ name, at: Date.now(), items: v.items.map(stripId) });
    input.value = '';
    touched();
    renderLayouts();
    toast('Saved the floor as "' + name + '".');
  }

  function loadLayout(name) {
    const L = S.venue.layouts.find((x) => x.name === name);
    if (!L) return;
    let skipped = 0;
    const items = [];
    for (const it of L.items) {
      if (typeById(it.type)) items.push(Object.assign({}, it, { id: M.uid('i') }));
      else skipped++;
    }
    checkpoint();
    S.venue.items = items;
    S.sel = null;
    if (mode() !== 'plan') setTab('plan');
    changed();
    toast('Loaded "' + name + '".' + (skipped ? ' ' + plural(skipped, 'item') + ' of a removed type ' + (skipped === 1 ? 'was' : 'were') + ' skipped.' : '') + ' Use Undo to go back.');
  }

  async function deleteLayout(name) {
    const ok = await ask('Delete layout?', 'Delete the saved layout "' + name + '"? This cannot be undone.',
      [{ label: 'Cancel', value: false, focus: true }, { label: 'Delete', value: true, danger: true }]);
    if (!ok) return;
    S.venue.layouts = S.venue.layouts.filter((L) => L.name !== name);
    touched();
    renderLayouts();
    announce('Deleted layout ' + name + '.');
  }

  async function clearFloor() {
    const n = S.venue.items.length;
    if (!n) { toast('The floor is already empty.'); return; }
    const ok = await ask('Clear the floor?', 'Remove all ' + plural(n, 'item') + ' from the floor? Fixed features and saved layouts stay, and Undo brings the furniture back.',
      [{ label: 'Cancel', value: false, focus: true }, { label: 'Clear floor', value: true, danger: true }]);
    if (!ok) return;
    checkpoint();
    S.venue.items = [];
    S.sel = null;
    changed();
  }

  // ---------- room settings ----------
  function convertField(el, from, to) {
    const n = M.parseLength(el.value, from);
    if (Number.isFinite(n) && n > 0) el.value = M.fmtInput(n, to);
  }

  function applyRoomSize(e) {
    const el = e.target, v = S.venue, u = units();
    const n = M.parseLength(el.value, u);
    if (!Number.isFinite(n) || n < M.ROOM_MIN || n > M.ROOM_MAX) {
      setInvalid(el, true);
      $('roomError').textContent = 'Enter a ' + (el.id === 'roomW' ? 'width' : 'depth') + ' between ' + len(M.ROOM_MIN) + ' and ' + len(M.ROOM_MAX) +
        (u === 'm' ? ', for example 18.5.' : ', for example 62\' 6".');
      return;
    }
    setInvalid(el, false);
    if (!$('roomW').hasAttribute('aria-invalid') && !$('roomH').hasAttribute('aria-invalid')) $('roomError').textContent = '';
    const w = el.id === 'roomW' ? M.r3(n) : v.room.w;
    const h = el.id === 'roomH' ? M.r3(n) : v.room.h;
    if (w !== v.room.w || h !== v.room.h) {
      checkpoint();
      resizeRoom(w, h);
      changed({ refit: true });
    }
    syncValue(el, M.fmtInput(el.id === 'roomW' ? w : h, u), true);
  }

  // Features keep their real size. A custom wall outline is stretched to the new size, and anything
  // left outside the room is pulled back in.
  function resizeRoom(w, h) {
    const v = S.venue, sx = w / v.room.w, sy = h / v.room.h;
    if (v.outline) v.outline = v.outline.map(([x, y]) => [M.r3(x * sx), M.r3(y * sy)]);
    if (v.dims) {
      const dx = v.dims.x.filter((x) => x < w), dy = v.dims.y.filter((y) => y < h);
      if (dx.length || dy.length) v.dims = { x: dx, y: dy };
      else delete v.dims;
    }
    v.room = { w, h };
    v.features.forEach(clampFeature);
    v.items.forEach(clampItem);
  }

  function useRectOutline() {
    if (!S.venue.outline) return;
    checkpoint();
    delete S.venue.outline;
    changed();
    announce('The room is now a plain rectangle.');
  }

  function onUnitsChange(e) {
    const to = e.target.value === 'm' ? 'm' : 'ft', from = units();
    if (to === from) return;
    checkpoint();
    convertField($('tfW'), from, to);
    convertField($('tfH'), from, to);
    S.venue.units = to;
    for (const id of ['roomW', 'roomH']) setInvalid($(id), false);
    $('roomError').textContent = '';
    changed();
    announce(to === 'm' ? 'Showing meters.' : 'Showing feet and inches.');
  }

  function onNameInput(e) {
    const name = M.oneLine(e.target.value, 80);
    if (!name || name === S.venue.name) return;
    checkpoint('name');
    S.venue.name = name;
    changed();
  }

  function onCaptionChange(e) {
    const c = M.oneLine(e.target.value, 120);
    if (c === (S.venue.caption || '')) return;
    checkpoint();
    if (c) S.venue.caption = c;
    else delete S.venue.caption;
    changed();
  }

  // Guest target and chair count update live while typing.
  function onCountInput(e, prop) {
    const el = e.target, raw = el.value.trim();
    const n = raw === '' ? 0 : Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 100000) { setInvalid(el, true); return; }
    setInvalid(el, false);
    if (n === S.venue[prop]) return;
    checkpoint(prop);
    S.venue[prop] = n;
    changed();
  }
  function onCountChange(e, prop) {
    setInvalid(e.target, false);
    syncValue(e.target, S.venue[prop] || '', true);
  }

  // ---------- inventory ----------
  const STYLE_HELP = {
    table: 'A rectangular table with chairs along both long sides. Its seats count toward your target and use your chairs.',
    round: 'A round table with chairs all around. Enter the table size; the chairs add space around it.',
    chairs: 'A row of chairs, such as theater seating. Each seat uses one of your chairs.',
    sofa: 'Lounge seating. Its seats count toward your target but do not use your chairs.',
    box: 'Any rectangular item, such as a buffet table, a bar or a cooler. Seats are optional.',
    circle: 'Any round or oval item, such as a cocktail table. Seats are optional.',
    zone: 'An open area such as a dance floor or a mingle space. It has no seats and never conflicts with furniture.',
  };
  const TYPE_DEFAULTS = { name: '', label: '', style: 'table', w: 6, h: 2.5, seats: 6, qty: null, color: '#7a9b76' };
  const TYPE_FIELDS = ['tfName', 'tfLabel', 'tfW', 'tfH', 'tfSeats', 'tfQty'];

  function onStyleChange() {
    const style = $('tfStyle').value;
    $('tfHelp').textContent = STYLE_HELP[style] || '';
    const zone = style === 'zone';
    $('tfSeats').disabled = zone;
    if (zone) $('tfSeats').value = '0';
  }

  function fillTypeForm(t) {
    const u = units();
    $('tfName').value = t.name;
    $('tfLabel').value = t.label || '';
    $('tfStyle').value = t.style;
    $('tfW').value = M.fmtInput(t.w, u);
    $('tfH').value = M.fmtInput(t.h, u);
    $('tfSeats').value = String(t.seats || 0);
    $('tfQty').value = t.qty === null ? '' : String(t.qty);
    $('tfColor').value = t.color;
    for (const id of TYPE_FIELDS) setInvalid($(id), false);
    $('tfError').textContent = '';
    onStyleChange();
  }

  function resetTypeForm() {
    S.editingType = null;
    fillTypeForm(TYPE_DEFAULTS);
    $('typeFormTitle').textContent = 'Add an item type';
    $('tfSubmit').textContent = 'Add item type';
    $('tfCancel').hidden = true;
  }

  function editType(id) {
    const t = typeById(id);
    if (!t) return;
    S.editingType = id;
    fillTypeForm(t);
    $('typeFormTitle').textContent = 'Edit ' + t.name;
    $('tfSubmit').textContent = 'Save changes';
    $('tfCancel').hidden = false;
    renderInventoryTab();
    $('typeForm').scrollIntoView({ block: 'nearest' });
    $('tfName').focus();
  }

  function submitType(e) {
    e.preventDefault();
    const u = units(), errs = [];
    let first = null;
    const bad = (id, msg) => { setInvalid($(id), true); errs.push(msg); if (!first) first = $(id); };
    for (const id of TYPE_FIELDS) setInvalid($(id), false);
    const name = M.oneLine($('tfName').value, 80);
    if (!name) bad('tfName', 'Give the item a name.');
    const w = M.parseLength($('tfW').value, u), h = M.parseLength($('tfH').value, u);
    const range = len(0.1) + ' and ' + len(200);
    if (!(w >= 0.1 && w <= 200)) bad('tfW', 'Enter a width between ' + range + '.');
    if (!(h >= 0.1 && h <= 200)) bad('tfH', 'Enter a depth between ' + range + '.');
    const style = M.ITEM_STYLES[$('tfStyle').value] ? $('tfStyle').value : 'box';
    const seatsRaw = $('tfSeats').value.trim();
    const seats = style === 'zone' || seatsRaw === '' ? 0 : Number(seatsRaw);
    if (!Number.isInteger(seats) || seats < 0 || seats > 200) bad('tfSeats', 'Seats must be a whole number from 0 to 200.');
    const qtyRaw = $('tfQty').value.trim();
    const qty = qtyRaw === '' ? null : Number(qtyRaw);
    if (qty !== null && (!Number.isInteger(qty) || qty < 0 || qty > 100000)) bad('tfQty', 'How many you have must be a whole number, or blank for no limit.');
    $('tfError').textContent = errs.join(' ');
    if (errs.length) { first.focus(); return; }

    const t = { name, label: M.oneLine($('tfLabel').value, 40), style, w: M.r3(w), h: M.r3(h), seats, qty, color: M.color($('tfColor').value, '#8a8f98') };
    checkpoint();
    const cur = S.editingType && typeById(S.editingType);
    if (cur) {
      // Keep placed items centred where they are when the size or style changes.
      const before = new Map();
      for (const it of S.venue.items) if (it.type === cur.id) before.set(it.id, M.footprint(it, cur));
      Object.assign(cur, t);
      for (const it of S.venue.items) {
        const b = before.get(it.id);
        if (!b) continue;
        if (!M.canHaveChairs(cur)) delete it.bare;
        const a = M.footprint(it, cur);
        it.x = M.r3(it.x + (b.w - a.w) / 2);
        it.y = M.r3(it.y + (b.h - a.h) / 2);
        clampItem(it);
      }
      toast('Saved changes to ' + name + '.');
    } else {
      S.venue.types.push(Object.assign({ id: M.uid('t') }, t));
      toast('Added ' + name + '. Place it from the Add furniture list on the Plan tab.');
    }
    resetTypeForm();
    changed();
  }

  async function deleteType(id) {
    const t = typeById(id);
    if (!t) return;
    const placed = placedCount(id);
    const inLayouts = S.venue.layouts.filter((L) => L.items.some((i) => i.type === id)).length;
    if (placed || inLayouts) {
      const parts = [];
      if (placed) parts.push(plural(placed, 'item') + ' on the floor');
      if (inLayouts) parts.push('its items in ' + plural(inLayouts, 'saved layout'));
      const ok = await ask('Remove ' + t.name + '?', 'This also removes ' + parts.join(' and ') + '.' +
        (inLayouts ? ' Undo brings back the floor but not the saved layouts.' : ''),
        [{ label: 'Cancel', value: false, focus: true }, { label: 'Remove', value: true, danger: true }]);
      if (!ok) return;
    }
    checkpoint();
    S.venue.types = S.venue.types.filter((x) => x !== t);
    S.venue.items = S.venue.items.filter((i) => i.type !== id);
    for (const L of S.venue.layouts) L.items = L.items.filter((i) => i.type !== id);
    if (S.editingType === id) resetTypeForm();
    if (S.sel && S.sel.kind === 'item' && !findItem(S.sel.id)) S.sel = null;
    changed();
    announce('Removed ' + t.name + '.');
  }

  // ---------- venues ----------
  function uniqueName(name, exceptId) {
    const taken = new Set(store.list().filter((e) => e.id !== exceptId).map((e) => e.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) {
      const next = name.slice(0, 74) + ' (' + i + ')';
      if (!taken.has(next.toLowerCase())) return next;
    }
  }

  function openVenue(v, opts) {
    flush();
    S.venue = v;
    S.ephemeral = !!(opts && opts.ephemeral);
    S.sel = null;
    S.undo = [];
    S.redo = [];
    S.group = null;
    S.mline = null;
    S.drag = null;
    S.cache = {};
    S.fit = true;
    S.inspKey = '';
    S.conflictIdx = 0;
    if (S.measuring) setMeasuring(false);
    for (const id of ['roomName', 'roomW', 'roomH', 'targetInput', 'chairsInput']) setInvalid($(id), false);
    $('roomError').textContent = '';
    $('shareOut').hidden = true;
    $('shareMsg').textContent = '';
    if (!S.ephemeral) store.setCurrent(v.id);
    analyzeNow();
    resetTypeForm();
    renderAll();
    $('planScroller').scrollTo(0, 0);
  }

  // Saves a new or imported venue and opens it.
  function saveAndOpen(v) {
    flush();
    v.name = uniqueName(v.name, v.id);
    v.updatedAt = Date.now();
    S.firstRun = false;
    try {
      store.save(v);
      S.saveFailed = false;
    } catch (e) {
      S.saveFailed = true;
    }
    openVenue(v);
    if (cloud.user) pushCloud();
  }

  function duplicateVenue() {
    flush();
    const copy = JSON.parse(JSON.stringify(S.venue));
    copy.id = M.uid('v');
    copy.name = M.oneLine(S.venue.name + ' copy', 80);
    saveAndOpen(M.normalizeVenue(copy));
    toast('Opened a copy named "' + S.venue.name + '".');
  }

  async function deleteVenue(id) {
    const isCur = !S.ephemeral && id === S.venue.id;
    const entry = store.list().find((e) => e.id === id);
    const name = isCur ? S.venue.name : entry ? entry.name : 'this venue';
    const ok = await ask('Delete venue?', 'Delete "' + name + '" and its saved layouts from this browser' + (cloud.user ? ' and from your account' : '') +
      '? This cannot be undone, so export it first if you might need it again.',
      [{ label: 'Cancel', value: false, focus: true }, { label: 'Delete venue', value: true, danger: true }]);
    if (!ok) return;
    if (isCur) {
      clearTimeout(S.timers.persist);
      clearTimeout(S.timers.push);
      S.timers.persist = S.timers.push = null;
    }
    store.remove(id);
    if (cloud.user) cloud.remove(id).catch((e) => cloudFailed(e, 'Could not delete it from your account.'));
    if (isCur) openMostRecent();
    else {
      renderVenueSelect();
      renderVenueList();
    }
    toast('Deleted "' + name + '".');
  }

  function openMostRecent() {
    for (const e of store.list()) {
      const v = store.load(e.id);
      if (v) { openVenue(v); return; }
    }
    openVenue(M.sampleVenue(), { ephemeral: true });
    showStart(true);
  }

  // ---------- start dialog ----------
  function showStart(first) {
    S.firstRun = !!first;
    const d = $('startDialog');
    const u = first || !S.venue ? 'ft' : units();
    $('startTitle').textContent = first ? 'Plan any event space' : 'New venue';
    $('startIntro').hidden = !first;
    $('nvUnits').value = u;
    $('nvUnits').dataset.prev = u;
    $('nvName').value = '';
    $('nvW').value = M.fmtInput(u === 'm' ? 18 / M.M_PER_FT : 60, u);
    $('nvH').value = M.fmtInput(u === 'm' ? 12 / M.M_PER_FT : 40, u);
    $('nvGuests').value = '80';
    $('nvStarter').checked = true;
    $('nvError').textContent = '';
    for (const id of ['nvW', 'nvH', 'nvGuests']) setInvalid($(id), false);
    if (!d.open) d.showModal();
    // Avoid popping up the on-screen keyboard before the visitor has read the dialog.
    if (window.matchMedia && matchMedia('(pointer: coarse)').matches) $('startTitle').focus();
    else $('nvName').focus();
  }

  function closeStart() {
    const d = $('startDialog');
    if (d.open) d.close();
  }

  function dismissStart() {
    const first = S.firstRun;
    closeStart();
    S.firstRun = false;
    if (first && S.ephemeral) toast('You are looking at the sample venue. Choose New at the top when you are ready to plan your own space.');
  }

  function onStartUnits() {
    const el = $('nvUnits'), to = el.value === 'm' ? 'm' : 'ft', from = el.dataset.prev || 'ft';
    if (to === from) return;
    convertField($('nvW'), from, to);
    convertField($('nvH'), from, to);
    el.dataset.prev = to;
  }

  function createFromStart(e) {
    e.preventDefault();
    const u = $('nvUnits').value === 'm' ? 'm' : 'ft';
    const w = M.parseLength($('nvW').value, u), h = M.parseLength($('nvH').value, u);
    const okW = w >= M.ROOM_MIN && w <= M.ROOM_MAX, okH = h >= M.ROOM_MIN && h <= M.ROOM_MAX;
    const gRaw = $('nvGuests').value.trim();
    const g = gRaw === '' ? 0 : Number(gRaw);
    const okG = Number.isInteger(g) && g >= 0 && g <= 100000;
    setInvalid($('nvW'), !okW);
    setInvalid($('nvH'), !okH);
    setInvalid($('nvGuests'), !okG);
    const errs = [];
    if (!okW || !okH) {
      errs.push('Enter a width and depth between ' + M.fmtLen(M.ROOM_MIN, u) + ' and ' + M.fmtLen(M.ROOM_MAX, u) +
        (u === 'm' ? ', for example 18.5.' : ', for example 60\' or 42\' 6".'));
    }
    if (!okG) errs.push('Enter the number of guests as a whole number, or leave it blank.');
    $('nvError').textContent = errs.join(' ');
    if (errs.length) {
      (!okW ? $('nvW') : !okH ? $('nvH') : $('nvGuests')).focus();
      return;
    }
    const v = M.blankVenue({ name: $('nvName').value, w: M.r3(w), h: M.r3(h), target: g, units: u, starter: $('nvStarter').checked });
    closeStart();
    saveAndOpen(v);
    setTab('plan');
    toast('Created "' + S.venue.name + '". Follow the setup steps in the Plan tab.');
  }

  function startSample() {
    closeStart();
    S.firstRun = false;
    if (!(S.ephemeral && S.venue.name === M.SAMPLE_NAME)) openVenue(M.sampleVenue(), { ephemeral: true });
    setTab('plan');
  }

  // ---------- import and export ----------
  function pickImport() {
    const input = $('importInput');
    input.value = '';
    input.click();
  }

  async function importFile(file) {
    if (!file) return;
    if (file.size > 5e6) {
      info('Cannot import this file', 'This file is too large to be a Venue Planner export.');
      return;
    }
    let res;
    try {
      res = M.parseImport(await file.text());
    } catch (e) {
      info('Cannot import this file', e && e.friendly ? e.message : 'The file could not be read.');
      return;
    }
    const v = res.venue;
    const existing = store.list().find((x) => x.id === v.id);
    if (existing) {
      const choice = await ask('This venue is already here', '"' + existing.name + '" is already saved in this browser. Replace it with the imported copy, or keep both?',
        [{ label: 'Cancel', value: null }, { label: 'Keep both', value: 'both', focus: true }, { label: 'Replace', value: 'replace', danger: true }]);
      if (!choice) return;
      if (choice === 'both') v.id = M.uid('v');
    }
    closeStart();
    saveAndOpen(v);
    setTab('plan');
    const msg = 'Imported "' + S.venue.name + '"' + (v.layouts.length ? ' with ' + plural(v.layouts.length, 'saved layout') : '') + '.';
    if (res.warnings.length) info('Imported with warnings', msg + ' ' + res.warnings.join(' '));
    else toast(msg);
  }

  function onDragOver(e) {
    if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }
  function onDrop(e) {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    e.preventDefault();
    if (document.querySelector('dialog[open]:not(#startDialog)')) return;
    importFile(files[0]);
  }

  function saveFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function exportJSON() {
    flush();
    const v = S.venue;
    saveFile(new Blob([JSON.stringify(M.exportDoc(v), null, 2)], { type: 'application/json' }), M.slug(v.name) + '-' + today() + '.json');
    toast('Exported "' + v.name + '"' + (v.layouts.length ? ' with ' + plural(v.layouts.length, 'saved layout') : '') + '.');
  }

  async function exportPNG() {
    const btn = $('pngBtn');
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const v = S.venue, vb = P.viewBox(v);
      const maxDim = Math.max(vb.w, vb.h);
      // About 2000 px on the long side, within the canvas limits of mobile browsers.
      const scale = Math.min(Math.min(4, Math.max(2, 2000 / maxDim)), 8000 / maxDim, Math.sqrt(16e6 / (vb.w * vb.h)));
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(P.standaloneSVG(v, { scale, grid: S.prefs.grid, dims: S.prefs.dims }));
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vb.w * scale);
      canvas.height = Math.round(vb.h * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('empty image');
      saveFile(blob, M.slug(v.name) + '-plan.png');
      toast('Saved the plan as a PNG image.');
    } catch (e) {
      info('Image export failed', 'This browser could not turn the plan into an image. Use Print and choose Save as PDF instead.');
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- share links ----------
  async function shareLink() {
    flush();
    const msg = $('shareMsg'), out = $('shareOut');
    let code;
    try {
      code = await share.encode(S.venue);
    } catch (e) {
      msg.textContent = 'This browser could not create a link. Export a file instead.';
      return;
    }
    const link = location.href.split('#')[0] + '#plan=' + code;
    out.value = link;
    out.hidden = false;
    let copied = false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(link);
        copied = true;
      } catch (e) { /* show the link to copy by hand */ }
    }
    let text = (copied ? 'Link copied. ' : 'Copy the link below. ') + 'Whoever opens it gets their own copy of this plan; later changes are not shared. Saved layouts are not included.';
    if (link.length > 32000) text += ' The link is very long, so some apps may cut it off. If it does not open, export a file instead.';
    msg.textContent = text;
    if (!copied) {
      out.focus();
      out.select();
    }
  }

  function hashKey(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + s.length.toString(36);
  }

  // Opens a plan from a #plan= link and saves it as a new venue. Returns true if one was opened.
  async function openFromHash() {
    const code = share.fromHash(location.hash);
    if (!code) return false;
    history.replaceState(null, '', location.pathname + location.search);
    const key = hashKey(code);
    const seen = S.prefs.shared && S.prefs.shared[key];
    const prev = seen && store.load(seen);
    if (prev) {
      closeStart();
      openVenue(prev);
      toast('This shared plan is already saved in this browser, so it was opened.');
      return true;
    }
    let res;
    try {
      res = await share.decode(code);
    } catch (e) {
      info('Cannot open this link', e && e.friendly ? e.message : 'This share link could not be opened.');
      return false;
    }
    const v = res.venue;
    v.id = M.uid('v');
    v.name = M.oneLine(v.name + ' (shared)', 80);
    closeStart();
    saveAndOpen(v);
    setTab('plan');
    const shared = Object.assign({}, S.prefs.shared, { [key]: v.id });
    const keys = Object.keys(shared);
    for (const k of keys.slice(0, Math.max(0, keys.length - 50))) delete shared[k];
    S.prefs.shared = shared;
    store.setPrefs(S.prefs);
    toast('Opened a shared plan. It is saved in this browser as "' + S.venue.name + '".');
    return true;
  }

  // ---------- optional cloud sync ----------
  function cloudFailed(e, prefix) {
    S.syncing = false;
    S.cloudState = 'error';
    S.cloudError = prefix + (e && e.message ? ' ' + String(e.message).slice(0, 200) : '');
    renderSync();
  }

  function initCloud() {
    if (!cloud.configured()) {
      S.cloudState = 'off';
      renderSync();
      return;
    }
    S.cloudState = 'loading';
    renderSync();
    cloud.init(onUser).then(() => {
      if (S.cloudState === 'loading') {
        S.cloudState = cloud.user ? 'in' : 'out';
        renderSync();
      }
    }).catch((e) => cloudFailed(e, 'Could not connect to the sync service.'));
  }

  function onUser(u) {
    S.cloudState = u ? 'in' : 'out';
    S.lastSync = 0;
    renderSync();
    if (u) syncNow(true);
  }

  async function syncNow(quiet) {
    if (!cloud.client) { initCloud(); return; }
    if (!cloud.user) {
      S.cloudState = 'out';
      renderSync();
      return;
    }
    if (S.syncing) return;
    S.syncing = true;
    S.cloudState = 'in';
    renderSync();
    try {
      flush();
      const changedIds = await cloud.syncAll();
      S.syncing = false;
      S.lastSync = Date.now();
      const curId = S.ephemeral ? null : S.venue.id;
      if (curId && changedIds.includes(curId)) {
        const v = store.load(curId);
        if (v) openVenue(v);
        else openMostRecent();
      } else if (S.ephemeral && changedIds.length) {
        closeStart();
        S.firstRun = false;
        openMostRecent();
      }
      renderVenueSelect();
      renderVenueList();
      renderSync();
      if (!quiet) toast(changedIds.length ? 'Synced. ' + plural(changedIds.length, 'venue') + ' updated from your account.' : 'Everything is in sync.');
    } catch (e) {
      cloudFailed(e, 'Sync failed.');
    }
  }

  function pushCloud() {
    clearTimeout(S.timers.push);
    S.timers.push = null;
    if (!cloud.user || S.ephemeral || !S.venue) return;
    cloud.push(JSON.parse(JSON.stringify(S.venue))).then(() => {
      S.lastSync = Date.now();
      if (S.cloudState === 'in') renderSync();
    }).catch((e) => cloudFailed(e, 'Could not save to your account.'));
  }

  function openAuth() {
    const d = $('authDialog');
    const msg = $('authMsg');
    msg.textContent = '';
    msg.className = 'help';
    $('authPass').value = '';
    if (!d.open) d.showModal();
    $('authEmail').focus();
  }

  async function authSubmit(signup) {
    const email = $('authEmail').value.trim(), pass = $('authPass').value;
    const msg = $('authMsg');
    const say = (text, cls) => { msg.textContent = text; msg.className = cls || 'help'; };
    if (!email || !pass) return say('Enter your email address and a password.', 'field-error');
    if (signup && pass.length < 8) return say('Use a password of at least 8 characters.', 'field-error');
    const buttons = $('authDialog').querySelectorAll('button');
    buttons.forEach((b) => { b.disabled = true; });
    say(signup ? 'Creating your account\u2026' : 'Signing in\u2026');
    try {
      if (signup) {
        const hasSession = await cloud.signUp(email, pass);
        if (!hasSession) return say('Check your email to confirm your account, then sign in here.', 'note ok');
      } else {
        await cloud.signIn(email, pass);
      }
      $('authDialog').close();
      toast('Signed in. Your venues now sync with your account.');
    } catch (e) {
      say((e && e.message) || 'Could not sign in. Check your details and try again.', 'field-error');
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  async function signOut() {
    flush();
    try { await cloud.signOut(); } catch (e) { /* the local session is cleared below either way */ }
    cloud.user = null;
    S.cloudState = 'out';
    S.lastSync = 0;
    renderSync();
    toast('Signed out. Your venues stay in this browser.');
  }

  // ---------- events ----------
  const ACTIONS = {
    add: (el) => addItem(el.getAttribute('data-type'), el.getAttribute('data-bare') === '1'),
    'layout-load': (el) => loadLayout(el.getAttribute('data-name')),
    'layout-del': (el) => deleteLayout(el.getAttribute('data-name')),
    'clear-floor': clearFloor,
    measure: () => setMeasuring(!S.measuring),
    'feature-add': (el) => addFeature(el.getAttribute('data-kind')),
    'feature-sel': (el) => {
      select('feature', el.getAttribute('data-id'));
      revealSelection();
    },
    'feature-del': (el) => deleteFeature(el.getAttribute('data-id')),
    'type-edit': (el) => editType(el.getAttribute('data-id')),
    'type-del': (el) => deleteType(el.getAttribute('data-id')),
    'type-cancel': () => {
      resetTypeForm();
      renderInventoryTab();
    },
    'venue-open': (el) => {
      const v = store.load(el.getAttribute('data-id'));
      if (v) openVenue(v);
      else toast('That venue could not be opened.');
    },
    'venue-del': (el) => deleteVenue(el.getAttribute('data-id')),
    'venue-dup': duplicateVenue,
    'venue-delete-current': () => {
      if (S.ephemeral) toast('This preview is not saved, so there is nothing to delete.');
      else deleteVenue(S.venue.id);
    },
    'new-venue': () => showStart(false),
    'export-json': exportJSON,
    'import-json': pickImport,
    'export-png': exportPNG,
    print: () => window.print(),
    'share-link': shareLink,
    'sync-signin': openAuth,
    'sync-now': () => syncNow(false),
    'sync-signout': signOut,
    'auth-signup': () => authSubmit(true),
    'auth-cancel': () => $('authDialog').close(),
    'rect-outline': useRectOutline,
    'dismiss-steps': () => {
      S.prefs.dismissed = Object.assign({}, S.prefs.dismissed, { [S.venue.id]: 1 });
      store.setPrefs(S.prefs);
      renderNextSteps();
      $('tab-plan').focus();
    },
    'goto-tab': (el) => setTab(el.getAttribute('data-tab'), true),
    'conflict-cycle': cycleConflict,
    rot90: () => rotate(90),
    rot15: () => rotate(15),
    dup: duplicate,
    del: removeSelection,
    details: () => {
      const on = !$('main').classList.contains('show-details');
      showDetails(on);
      if (on && $('inLabel')) $('inspector').scrollIntoView({ block: 'nearest' });
    },
    undo: () => undo(),
    redo: () => redo(),
    'zoom-in': () => setZoom(S.zoom * 1.25),
    'zoom-out': () => setZoom(S.zoom / 1.25),
    'zoom-fit': zoomToFit,
    'start-sample': startSample,
    'start-import': () => {
      closeStart();
      pickImport();
    },
    'start-close': dismissStart,
  };

  function onActionClick(e) {
    const el = e.target.closest && e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = ACTIONS[el.getAttribute('data-act')];
    if (!fn) return;
    e.preventDefault();
    fn(el);
  }

  // Stops the page from scrolling while furniture, features or the tape measure are dragged by touch.
  function onTouchStart(e) {
    const sel = mode() === 'room' ? '[data-feat], [data-handle]' : '[data-item]';
    if (S.measuring || (e.target.closest && e.target.closest(sel))) e.preventDefault();
  }

  function bindToggle(id, key) {
    const el = $(id);
    el.checked = !!S.prefs[key];
    el.addEventListener('change', () => {
      S.prefs[key] = el.checked;
      store.setPrefs(S.prefs);
      renderScene();
    });
  }

  function bindEvents() {
    const svg = $('planSvg'), sc = $('planScroller');
    document.addEventListener('click', onActionClick);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);

    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', onPointerUp);
    svg.addEventListener('pointerleave', hideTip);
    svg.addEventListener('dblclick', onDblClick);
    svg.addEventListener('focusin', onFocusIn);
    svg.addEventListener('touchstart', onTouchStart, { passive: false });
    sc.addEventListener('scroll', hideTip, { passive: true });
    sc.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom(S.zoom * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY);
    }, { passive: false });
    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        if (!S.fit || !S.venue) return;
        fitZoom();
        renderOverlay();
        renderMeasure();
      }).observe(sc);
    }

    for (const t of TABS) $('tab-' + t).addEventListener('click', () => setTab(t));
    $('tabs').addEventListener('keydown', onTabKey);

    $('venueSelect').addEventListener('change', (e) => {
      const id = e.target.value;
      if (!id) return;
      const v = store.load(id);
      if (v) openVenue(v);
      else {
        toast('That venue could not be opened.');
        renderVenueSelect();
      }
    });

    $('layoutForm').addEventListener('submit', saveLayout);
    $('targetInput').addEventListener('input', (e) => onCountInput(e, 'target'));
    $('targetInput').addEventListener('change', (e) => onCountChange(e, 'target'));
    $('chairsInput').addEventListener('input', (e) => onCountInput(e, 'chairs'));
    $('chairsInput').addEventListener('change', (e) => onCountChange(e, 'chairs'));
    bindToggle('dimToggle', 'dims');
    bindToggle('gridToggle', 'grid');
    bindToggle('snapToggle', 'snap');

    $('roomName').addEventListener('input', onNameInput);
    $('roomName').addEventListener('change', () => syncValue($('roomName'), S.venue.name, true));
    $('roomW').addEventListener('change', applyRoomSize);
    $('roomH').addEventListener('change', applyRoomSize);
    $('roomUnits').addEventListener('change', onUnitsChange);
    $('roomCaption').addEventListener('change', onCaptionChange);

    $('typeForm').addEventListener('submit', submitType);
    $('tfStyle').addEventListener('change', onStyleChange);

    $('inspector').addEventListener('submit', (e) => e.preventDefault());
    $('inspector').addEventListener('change', onInspectorChange);

    $('startForm').addEventListener('submit', createFromStart);
    $('nvUnits').addEventListener('change', onStartUnits);
    $('startDialog').addEventListener('cancel', (e) => {
      e.preventDefault();
      dismissStart();
    });
    $('askDialog').addEventListener('cancel', (e) => {
      e.preventDefault();
      finishAsk(null);
    });
    $('authForm').addEventListener('submit', (e) => {
      e.preventDefault();
      authSubmit(false);
    });
    $('importInput').addEventListener('change', (e) => importFile(e.target.files && e.target.files[0]));

    window.addEventListener('hashchange', () => {
      if (share.fromHash(location.hash)) openFromHash();
    });
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }

  // ---------- start-up ----------
  async function boot() {
    injectIcons();
    S.prefs = store.getPrefs();
    $('planSvg').insertAdjacentHTML('afterbegin', P.defs());
    $('kindGrid').innerHTML = M.FEATURE_ORDER.map((k) => '<button type="button" class="kind-btn" data-act="feature-add" data-kind="' + k + '">' +
      '<span class="kind-dot k-' + k + '" aria-hidden="true"></span>' + esc(M.FEATURE_KINDS[k].name) + '</button>').join('');
    $('tfStyle').innerHTML = Object.keys(M.ITEM_STYLES).map((k) => '<option value="' + k + '">' + esc(M.ITEM_STYLES[k].name) + '</option>').join('');
    bindEvents();

    S.storageOk = store.available();
    let venue = null, migrated = null;
    if (S.storageOk) {
      migrated = store.migrateLegacy();
      venue = migrated;
      if (!venue) {
        const cur = store.getCurrent();
        venue = cur ? store.load(cur) : null;
      }
      if (!venue) {
        for (const e of store.list()) {
          venue = store.load(e.id);
          if (venue) break;
        }
      }
    }
    if (venue) openVenue(venue);
    else openVenue(M.sampleVenue(), { ephemeral: true });
    setTab('plan');
    if (migrated) toast('Your plan from the earlier version of this planner was moved into "' + migrated.name + '".');

    const linked = await openFromHash();
    if (!venue && !linked) showStart(true);
    initCloud();
  }

  boot();
})();
