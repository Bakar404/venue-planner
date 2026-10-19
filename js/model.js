/* Venue Planner: data model, templates, validation, analysis, import/export and migration.
   Pure functions with no DOM access. Every length is stored in feet. */
(function (root) {
  'use strict';
  const VP = (root.VP = root.VP || {});
  const G = VP.geometry;

  const APP_ID = 'venue-planner';
  const FORMAT = 2;
  const M_PER_FT = 0.3048;
  const CHAIR_BAND = 2.25; // depth added on each seated side of a table for pulled-out chairs
  const ROOM_MIN = 4;
  const ROOM_MAX = 1000;
  const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  const HEX_RE = /^#[0-9a-f]{6}$/i;

  // block: 'solid' removes floor area and conflicts with furniture,
  // 'clear' keeps floor area but furniture on it is a conflict, 'none' is drawing only.
  const FEATURE_KINDS = {
    column: { name: 'Column', block: 'solid', w: 1.5, h: 1.5, label: '' },
    wall: { name: 'Wall or partition', block: 'solid', w: 10, h: 0.5, label: '' },
    door: { name: 'Door', block: 'clear', w: 3, h: 3, label: '' },
    exit: { name: 'Emergency exit', block: 'clear', w: 4, h: 3, label: 'EXIT' },
    window: { name: 'Window', block: 'none', w: 6, h: 0.5, label: '' },
    stage: { name: 'Stage', block: 'solid', w: 16, h: 8, label: 'STAGE' },
    bar: { name: 'Bar', block: 'solid', w: 10, h: 2.5, label: 'BAR' },
    counter: { name: 'Buffet counter', block: 'solid', w: 8, h: 2.5, label: 'BUFFET' },
    dance: { name: 'Dance floor', block: 'clear', w: 16, h: 16, label: 'DANCE FLOOR' },
    nogo: { name: 'No-go zone', block: 'solid', w: 6, h: 6, label: 'NO-GO' },
    room: { name: 'Room or core', block: 'solid', w: 10, h: 10, label: 'ROOM' },
    stairs: { name: 'Stairs', block: 'solid', w: 6, h: 10, label: 'STAIRS' },
    elevator: { name: 'Elevator', block: 'solid', w: 6, h: 6, label: '' },
    area: { name: 'Shaded area', block: 'none', w: 8, h: 8, label: '' },
    label: { name: 'Text label', block: 'none', w: 10, h: 1.2, label: 'LABEL' },
    note: { name: 'Note', block: 'none', w: 16, h: 1, label: 'Note' },
  };
  const FEATURE_ORDER = Object.keys(FEATURE_KINDS);

  const ITEM_STYLES = {
    table: { name: 'Table, chairs on long sides' },
    round: { name: 'Round table, chairs around' },
    chairs: { name: 'Row of chairs' },
    sofa: { name: 'Sofa or lounge seating' },
    box: { name: 'Rectangle' },
    circle: { name: 'Circle or oval' },
    zone: { name: 'Zone (never conflicts)' },
  };

  class VenueError extends Error {
    constructor(message) {
      super(message);
      this.name = 'VenueError';
      this.friendly = true;
    }
  }
  function fail(message) { throw new VenueError(message); }

  // ---------- small helpers ----------
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const toNum = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  const finite = (v, def) => { const n = toNum(v); return Number.isFinite(n) ? n : def; };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const intIn = (v, lo, hi, def) => { const n = toNum(v); return Number.isFinite(n) ? clamp(Math.round(n), lo, hi) : def; };
  const normRot = (v) => { const n = finite(v, 0); return Math.round((((n % 360) + 360) % 360) * 100) / 100; };

  function text(v, max) {
    if (typeof v !== 'string') return '';
    // eslint-disable-next-line no-control-regex
    return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, max);
  }
  function oneLine(v, max) { return text(v, max * 2).replace(/\s*\n\s*/g, ' ').slice(0, max); }

  function color(v, def) {
    if (typeof v !== 'string') return def;
    let s = v.trim();
    if (/^#[0-9a-f]{3}$/i.test(s)) s = '#' + s.slice(1).split('').map((c) => c + c).join('');
    return HEX_RE.test(s) ? s.toLowerCase() : def;
  }

  function uid(prefix) {
    let s = '';
    const c = root.crypto;
    if (c && typeof c.getRandomValues === 'function') {
      const a = new Uint32Array(2);
      c.getRandomValues(a);
      s = a[0].toString(36) + a[1].toString(36);
    } else {
      s = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
    return (prefix || 'x') + s.slice(0, 10);
  }

  function freshId(id, prefix, used) {
    let out = typeof id === 'string' && ID_RE.test(id) && !used.has(id) ? id : uid(prefix);
    while (used.has(out)) out = uid(prefix);
    used.add(out);
    return out;
  }

  // ---------- units ----------
  function fmtFtIn(ft) {
    const neg = ft < 0;
    const a = Math.abs(ft);
    let f = Math.floor(a + 1e-9);
    let inch = Math.round((a - f) * 12);
    if (inch === 12) { f++; inch = 0; }
    const s = f === 0 && inch > 0 ? inch + '\u2033' : f + '\u2032' + (inch > 0 ? inch + '\u2033' : '');
    return (neg ? '-' : '') + s;
  }
  function fmtMeters(ft) {
    const m = ft * M_PER_FT;
    return (Math.round(m * 100) / 100).toString() + ' m';
  }
  function fmtLen(ft, units) { return units === 'm' ? fmtMeters(ft) : fmtFtIn(ft); }

  // Architectural dimension string, for example 19'-6".
  function fmtDim(ft, units) {
    if (units === 'm') return fmtMeters(ft);
    let f = Math.floor(ft + 1e-9);
    let inch = Math.round((ft - f) * 12);
    if (inch === 12) { f++; inch = 0; }
    return f + "'-" + inch + '"';
  }

  function fmtArea(sqft, units) {
    if (units === 'm') return Math.round(sqft * M_PER_FT * M_PER_FT).toLocaleString('en-US') + ' m\u00b2';
    return Math.round(sqft).toLocaleString('en-US') + ' sq ft';
  }
  function fmtAreaPrecise(sqft, units) {
    if (units === 'm') return (sqft * M_PER_FT * M_PER_FT).toFixed(1) + ' m\u00b2';
    return sqft.toFixed(1) + ' sq ft';
  }

  // Value shown in an editable length field.
  function fmtInput(ft, units) {
    if (units === 'm') return String(Math.round(ft * M_PER_FT * 100) / 100);
    let f = Math.floor(ft + 1e-9);
    let inch = Math.round((ft - f) * 12 * 10) / 10;
    if (inch >= 12) { f++; inch = 0; }
    return inch > 0 ? f + "' " + inch + '"' : f + "'";
  }

  // Accepts 62' 6", 62'-6", 62ft 6in, 62.5, 62 6, 750", 19.05m, 1905cm. Returns feet or NaN.
  function parseLength(input, units) {
    let s = String(input == null ? '' : input).trim().toLowerCase()
      .replace(/[\u2032\u2019\u00b4`]/g, "'").replace(/[\u2033\u201d]/g, '"').replace(/''/g, '"').replace(/,/g, '.');
    if (!s) return NaN;
    const NUM = '(\\d+(?:\\.\\d+)?|\\.\\d+)';
    let m = s.match(new RegExp('^' + NUM + '\\s*(m|meters?|metres?|cm|mm)$'));
    if (m) {
      const k = m[2] === 'cm' ? 0.01 : m[2] === 'mm' ? 0.001 : 1;
      return (parseFloat(m[1]) * k) / M_PER_FT;
    }
    m = s.match(new RegExp('^' + NUM + "\\s*(?:'|ft|feet|foot)\\s*-?\\s*(?:" + NUM + '\\s*(?:"|in|inch|inches)?)?$'));
    if (m) return parseFloat(m[1]) + (m[2] ? parseFloat(m[2]) / 12 : 0);
    m = s.match(new RegExp('^' + NUM + '\\s*(?:"|in|inch|inches)$'));
    if (m) return parseFloat(m[1]) / 12;
    m = s.match(new RegExp('^' + NUM + '(?:\\s+' + NUM + ')?$'));
    if (m) {
      if (units === 'm') return m[2] ? NaN : parseFloat(m[1]) / M_PER_FT;
      return parseFloat(m[1]) + (m[2] ? parseFloat(m[2]) / 12 : 0);
    }
    return NaN;
  }

  // ---------- items ----------
  function typeMap(venue) {
    const m = new Map();
    for (const t of venue.types) m.set(t.id, t);
    return m;
  }
  const canHaveChairs = (type) => type.style === 'table' || type.style === 'round';
  const isSeated = (item, type) => canHaveChairs(type) && type.seats > 0 && !item.bare;

  function footprint(item, type) {
    if (isSeated(item, type)) {
      return type.style === 'round'
        ? { w: type.w + 2 * CHAIR_BAND, h: type.h + 2 * CHAIR_BAND }
        : { w: type.w, h: type.h + 2 * CHAIR_BAND };
    }
    return { w: type.w, h: type.h };
  }
  function seatsOf(item, type) {
    if (type.style === 'zone') return 0;
    if (canHaveChairs(type)) return item.bare ? 0 : type.seats;
    return type.seats;
  }
  function chairsOf(item, type) {
    if (type.style === 'chairs') return type.seats;
    return isSeated(item, type) ? type.seats : 0;
  }
  const itemShape = (type) => (type.style === 'round' || type.style === 'circle' ? 'round' : 'rect');
  function itemBox(item, type) {
    const fp = footprint(item, type);
    return { x: item.x, y: item.y, w: fp.w, h: fp.h, rot: item.rot || 0 };
  }
  function itemLabel(item, type) {
    if (item.label) return item.label;
    if (canHaveChairs(type) && item.bare) return type.name;
    return type.label || type.name;
  }
  function describeItem(item, type, units) {
    const parts = [itemLabel(item, type), fmtLen(type.w, units) + ' \u00d7 ' + fmtLen(type.h, units)];
    const s = seatsOf(item, type);
    if (s) parts.push(s + (s === 1 ? ' seat' : ' seats'));
    if (canHaveChairs(type) && item.bare) parts.push('no chairs');
    return parts.join(' \u00b7 ');
  }
  function describeFeature(f, units) {
    const k = FEATURE_KINDS[f.kind];
    const name = f.label ? f.label.replace(/\s*\n\s*/g, ' ') : k.name;
    return (f.label ? name + ' (' + k.name.toLowerCase() + ')' : name) + ' \u00b7 ' + fmtLen(f.w, units) + ' \u00d7 ' + fmtLen(f.h, units);
  }

  function totals(venue) {
    const types = typeMap(venue);
    const placed = {};
    let seats = 0, chairs = 0;
    for (const it of venue.items) {
      const t = types.get(it.type);
      if (!t) continue;
      placed[t.id] = (placed[t.id] || 0) + 1;
      seats += seatsOf(it, t);
      chairs += chairsOf(it, t);
    }
    return { seats, chairs, placed };
  }

  // ---------- validation ----------
  function normFeature(f, room, used, warn) {
    if (!isObj(f) || !FEATURE_KINDS[f.kind]) { warn('feature'); return null; }
    const x = finite(f.x, NaN), y = finite(f.y, NaN), w = finite(f.w, NaN), h = finite(f.h, NaN);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) { warn('feature'); return null; }
    const out = {
      id: freshId(f.id, 'f', used), kind: f.kind,
      x: r3(clamp(x, -room.w, room.w * 2)), y: r3(clamp(y, -room.h, room.h * 2)),
      w: r3(clamp(w, 0.1, 2000)), h: r3(clamp(h, 0.1, 2000)), rot: normRot(f.rot),
    };
    const label = text(f.label, 200);
    if (label) out.label = label;
    if (f.shape === 'round' || f.shape === 'tri') out.shape = f.shape;
    if (out.shape === 'tri') out.corner = ['tl', 'tr', 'bl', 'br'].includes(f.corner) ? f.corner : 'tl';
    const fs = finite(f.fs, NaN);
    if (fs >= 4 && fs <= 72) out.fs = fs;
    return out;
  }

  function normType(t, used, warn) {
    if (!isObj(t)) { warn('type'); return null; }
    const name = oneLine(t.name, 80) || oneLine(t.label, 80);
    const w = finite(t.w, NaN), h = finite(t.h, NaN);
    if (!name || !(w > 0) || !(h > 0)) { warn('type'); return null; }
    if (typeof t.id === 'string' && used.has(t.id)) { warn('type'); return null; }
    const qty = t.qty === null || t.qty === undefined || t.qty === '' ? null : intIn(t.qty, 0, 100000, null);
    return {
      id: freshId(t.id, 't', used), name, label: oneLine(t.label, 40),
      style: ITEM_STYLES[t.style] ? t.style : 'box',
      w: r3(clamp(w, 0.1, 200)), h: r3(clamp(h, 0.1, 200)),
      seats: intIn(t.seats, 0, 200, 0), qty, color: color(t.color, '#8a8f98'),
    };
  }

  function normItem(it, typeIds, used, room, warn, keepId) {
    if (!isObj(it)) { warn('item'); return null; }
    if (!typeIds.has(it.type)) { warn('itemType'); return null; }
    const x = finite(it.x, NaN), y = finite(it.y, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) { warn('item'); return null; }
    const out = {};
    if (keepId) out.id = freshId(it.id, 'i', used);
    out.type = it.type;
    out.x = r3(clamp(x, -room.w, room.w * 2));
    out.y = r3(clamp(y, -room.h, room.h * 2));
    out.rot = normRot(it.rot);
    const label = oneLine(it.label, 80);
    if (label) out.label = label;
    if (it.bare === true) out.bare = true;
    return out;
  }

  const WARNINGS = {
    feature: (n) => n + ' fixed feature' + (n === 1 ? ' was' : 's were') + ' invalid and skipped.',
    type: (n) => n + ' item type' + (n === 1 ? ' was' : 's were') + ' invalid and skipped.',
    item: (n) => n + ' placed item' + (n === 1 ? ' was' : 's were') + ' invalid and skipped.',
    itemType: (n) => n + ' placed item' + (n === 1 ? ' uses' : 's use') + ' an unknown item type and ' + (n === 1 ? 'was' : 'were') + ' skipped.',
    outline: () => 'The wall outline was invalid and was replaced by a rectangle.',
    layout: (n) => n + ' saved layout' + (n === 1 ? ' was' : 's were') + ' invalid and skipped.',
  };

  // Validate and clean any venue-like object. Throws VenueError with a friendly message.
  function normalizeVenue(raw, warnings) {
    if (!isObj(raw)) fail('This file does not contain a venue.');
    const counts = {};
    const warn = (k) => { counts[k] = (counts[k] || 0) + 1; };
    const room = isObj(raw.room) ? raw.room : {};
    const w = finite(room.w, NaN), h = finite(room.h, NaN);
    if (!(w >= ROOM_MIN && w <= ROOM_MAX && h >= ROOM_MIN && h <= ROOM_MAX)) {
      fail('The room size is missing or outside the supported range (' + ROOM_MIN + ' to ' + ROOM_MAX + ' ft per side).');
    }
    const v = {
      format: FORMAT,
      id: typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : uid('v'),
      name: oneLine(raw.name, 80) || 'Untitled venue',
      units: raw.units === 'm' ? 'm' : 'ft',
      room: { w: r3(w), h: r3(h) },
      target: intIn(raw.target, 0, 100000, 0),
      chairs: intIn(raw.chairs, 0, 100000, 0),
    };
    if (raw.outline !== undefined && raw.outline !== null) {
      const pts = Array.isArray(raw.outline) && raw.outline.length >= 3 && raw.outline.length <= 200
        ? raw.outline.map((p) => (Array.isArray(p) ? [finite(p[0], NaN), finite(p[1], NaN)] : [NaN, NaN]))
        : null;
      const ok = pts && pts.every(([px, py]) => px >= -1 && px <= v.room.w + 1 && py >= -1 && py <= v.room.h + 1);
      if (ok && Math.abs(G.signedArea(pts)) > 1) v.outline = pts.map(([px, py]) => [r3(px), r3(py)]);
      else warn('outline');
    }
    if (isObj(raw.dims)) {
      const axis = (arr, max) => (Array.isArray(arr) ? arr : [])
        .map((n) => finite(n, NaN)).filter((n) => n > 0 && n < max).sort((a, b) => a - b).slice(0, 50);
      const dx = axis(raw.dims.x, v.room.w), dy = axis(raw.dims.y, v.room.h);
      if (dx.length || dy.length) v.dims = { x: dx, y: dy };
    }
    const caption = oneLine(raw.caption, 120);
    if (caption) v.caption = caption;

    const featIds = new Set();
    v.features = (Array.isArray(raw.features) ? raw.features.slice(0, 2000) : [])
      .map((f) => normFeature(f, v.room, featIds, warn)).filter(Boolean);

    const typeIds = new Set();
    v.types = (Array.isArray(raw.types) ? raw.types.slice(0, 500) : [])
      .map((t) => normType(t, typeIds, warn)).filter(Boolean);

    const itemIds = new Set();
    v.items = (Array.isArray(raw.items) ? raw.items.slice(0, 5000) : [])
      .map((it) => normItem(it, typeIds, itemIds, v.room, warn, true)).filter(Boolean);

    const names = new Set();
    v.layouts = [];
    for (const L of Array.isArray(raw.layouts) ? raw.layouts.slice(0, 100) : []) {
      const name = isObj(L) ? oneLine(L.name, 80) : '';
      if (!name || names.has(name) || !Array.isArray(L.items)) { warn('layout'); continue; }
      names.add(name);
      v.layouts.push({
        name,
        at: finite(L.at, 0) > 0 ? finite(L.at, 0) : Date.now(),
        items: L.items.slice(0, 5000).map((it) => normItem(it, typeIds, null, v.room, warn, false)).filter(Boolean),
      });
    }
    v.updatedAt = finite(raw.updatedAt, 0) > 0 ? finite(raw.updatedAt, 0) : Date.now();
    if (warnings) for (const k of Object.keys(counts)) warnings.push(WARNINGS[k](counts[k]));
    return v;
  }

  // ---------- templates ----------
  const SAMPLE_FEATURES = [
    { kind: 'area', x: 4, y: 3, w: 8, h: 8, shape: 'tri', corner: 'tl', label: 'ROOF\nBELOW', fs: 7 },
    { kind: 'area', x: 4, y: 51, w: 8, h: 8.5, shape: 'tri', corner: 'bl', label: 'ROOF\nBELOW', fs: 7 },
    { kind: 'area', x: 71, y: 22, w: 3.4, h: 18, label: 'ROOF\nBELOW', fs: 6.5 },
    { kind: 'elevator', x: 20, y: 4, w: 5, h: 6 },
    { kind: 'elevator', x: 25.5, y: 4, w: 5, h: 6 },
    { kind: 'label', x: 20.3, y: 11.5, w: 10, h: 1, label: 'ELEVATORS' },
    { kind: 'stairs', x: 31.5, y: 4, w: 6, h: 9, label: 'STAIRS\nUP / DN', fs: 6.5 },
    { kind: 'room', x: 52, y: 4, w: 8, h: 11, label: 'BATHRM', fs: 7 },
    { kind: 'room', x: 60, y: 4, w: 6, h: 11, label: 'BATHRM', fs: 7 },
    { kind: 'room', x: 66, y: 4, w: 5, h: 11, label: 'PANTRY', fs: 7 },
    { kind: 'note', x: 45, y: 1.5, w: 30, h: 1, label: 'fridge \u00b7 freezer \u00b7 microwave in pantry' },
    { kind: 'elevator', x: 20, y: 52.5, w: 5, h: 6 },
    { kind: 'elevator', x: 25.5, y: 52.5, w: 5, h: 6 },
    { kind: 'label', x: 20.3, y: 50.5, w: 10, h: 1, label: 'ELEVATORS' },
    { kind: 'stairs', x: 31.5, y: 50, w: 6, h: 9.5, label: 'STAIRS\nDN / UP', fs: 6.5 },
    { kind: 'room', x: 52, y: 49, w: 9, h: 10.5, label: 'Employee\nOnly Zone', fs: 7 },
    { kind: 'room', x: 61, y: 49, w: 10, h: 10.5, label: 'Dressing\nSuite', fs: 7 },
    { kind: 'column', x: 19, y: 20, w: 1, h: 1 },
    { kind: 'column', x: 35, y: 20, w: 1, h: 1 },
    { kind: 'column', x: 51.5, y: 20, w: 1, h: 1 },
    { kind: 'column', x: 19, y: 41.5, w: 1, h: 1 },
    { kind: 'column', x: 35, y: 41.5, w: 1, h: 1 },
    { kind: 'column', x: 51.5, y: 41.5, w: 1, h: 1 },
  ];

  const SAMPLE_TYPES = [
    { id: 'tbl8', name: '8-foot table', label: 'Dining', style: 'table', w: 8, h: 2.5, seats: 10, qty: 12, color: '#7a9b76' },
    { id: 'sofa', name: 'Plush sofa', label: 'Sofa', style: 'sofa', w: 7, h: 3, seats: 3, qty: 4, color: '#9a7bb0' },
    { id: 'coffee', name: 'Coffee table', label: 'Coffee', style: 'box', w: 3.5, h: 2, seats: 0, qty: 4, color: '#caa46a' },
    { id: 'hitop', name: 'Cocktail hi-top', label: 'Hi-top', style: 'circle', w: 3, h: 3, seats: 0, qty: 6, color: '#5f93a8' },
    { id: 'tbl6', name: '6-foot table', label: 'Buffet 6\u2032', style: 'box', w: 6, h: 2.5, seats: 0, qty: 1, color: '#c97b54' },
    { id: 'tbl4', name: '4-foot table', label: 'Buffet 4\u2032', style: 'box', w: 4, h: 2.5, seats: 0, qty: 2, color: '#c97b54' },
    { id: 'cooler', name: '120 qt cooler', label: 'Cooler', style: 'box', w: 3, h: 1.8, seats: 0, qty: 1, color: '#6d8f9a' },
    { id: 'tub', name: 'Ice tub (25 qt)', label: 'Ice tub', style: 'circle', w: 1.9, h: 1.5, seats: 0, qty: 2, color: '#8aa0a8' },
    { id: 'zone', name: 'Dance / mingle area', label: 'Dance / Mingle', style: 'zone', w: 13, h: 6.5, seats: 0, qty: null, color: '#b5562e' },
  ];

  // The recommended layout of the original 10th-floor planner: 102 seats for 85 guests.
  const SAMPLE_LAYOUT = [
    ['sofa', 6, 4.5], ['sofa', 6, 8], ['coffee', 13.5, 6.5], ['coffee', 13.5, 9],
    ['sofa', 6, 51], ['sofa', 6, 55], ['coffee', 13.5, 52.5], ['coffee', 13.5, 55],
    ['tbl8', 8, 13], ['tbl8', 21, 13], ['tbl8', 8, 23], ['tbl8', 21, 23],
    ['tbl8', 8, 33], ['tbl8', 21, 33], ['tbl8', 43, 15], ['tbl8', 43, 24], ['tbl8', 43, 33],
    ['tbl8', 43, 42, { bare: true, label: 'Bar' }], ['tbl8', 39, 7, { bare: true, label: 'Gift / Welcome' }],
    ['hitop', 15, 42], ['hitop', 15, 46], ['hitop', 49, 5], ['hitop', 49, 9],
    ['tbl6', 42, 50, { label: 'Buffet' }], ['tbl4', 42, 53], ['tbl4', 42, 56],
    ['cooler', 47.5, 53], ['tub', 47.5, 55.4], ['tub', 49.4, 55.4],
    ['zone', 28, 41.5],
  ];
  const sampleItems = () => SAMPLE_LAYOUT.map(([type, x, y, extra]) => Object.assign({ type, x, y, rot: 0 }, extra || {}));

  const STARTER_TYPES = [
    { id: 'banquet8', name: '8-foot banquet table', label: '8\u2032 table', style: 'table', w: 8, h: 2.5, seats: 8, qty: 10, color: '#7a9b76' },
    { id: 'banquet6', name: '6-foot banquet table', label: '6\u2032 table', style: 'table', w: 6, h: 2.5, seats: 6, qty: 6, color: '#7a9b76' },
    { id: 'round60', name: '60-inch round table', label: 'Round', style: 'round', w: 5, h: 5, seats: 8, qty: 8, color: '#6f9a8c' },
    { id: 'cocktail', name: 'Cocktail table', label: 'Hi-top', style: 'circle', w: 2.5, h: 2.5, seats: 0, qty: 6, color: '#5f93a8' },
    { id: 'buffet', name: 'Buffet table', label: 'Buffet', style: 'box', w: 6, h: 2.5, seats: 0, qty: 2, color: '#c97b54' },
    { id: 'lounge', name: 'Lounge sofa', label: 'Sofa', style: 'sofa', w: 7, h: 3, seats: 3, qty: 2, color: '#9a7bb0' },
    { id: 'zone', name: 'Dance / mingle area', label: 'Dance / Mingle', style: 'zone', w: 16, h: 12, seats: 0, qty: null, color: '#b5562e' },
  ];

  const SAMPLE_NAME = 'Sample: 10th-floor venue';

  function sampleVenue() {
    const now = Date.now();
    return normalizeVenue({
      id: uid('v'), name: SAMPLE_NAME, units: 'ft',
      room: { w: 75, h: 62.5 },
      outline: [[12, 3], [71, 3], [71, 59.5], [12, 59.5], [4, 51], [4, 11]],
      dims: { x: [19.5, 35.67, 52.17], y: [20.5, 42.17] },
      caption: '10TH FLOOR \u00b7 SCALE 1/8" = 1\'-0"',
      target: 85, chairs: 100,
      features: SAMPLE_FEATURES.map((f, i) => Object.assign({ id: 'f' + (i + 1), rot: 0 }, f)),
      types: SAMPLE_TYPES,
      items: sampleItems(),
      layouts: [{ name: 'Recommended layout', at: now, items: sampleItems() }],
      updatedAt: now,
    });
  }

  function blankVenue(opts) {
    const o = opts || {};
    const target = intIn(o.target, 0, 100000, 0);
    const starter = !!o.starter;
    return normalizeVenue({
      id: uid('v'), name: oneLine(o.name, 80) || 'My venue', units: o.units === 'm' ? 'm' : 'ft',
      room: { w: o.w, h: o.h }, target,
      chairs: starter ? (target > 0 ? Math.ceil((target * 1.1) / 10) * 10 : 100) : 0,
      features: [], types: starter ? STARTER_TYPES : [], items: [], layouts: [],
      updatedAt: Date.now(),
    });
  }

  // ---------- space check ----------
  // Point tester for a box with a shape, with a bounding-box prefilter.
  function shapeTester(box, shape, corner) {
    const bb = G.bounds(G.boxPolygon(box, shape === 'tri' ? 'tri' : 'rect', corner));
    const tri = shape === 'tri' ? G.localOutline('tri', box.w, box.h, corner) : null;
    return {
      bb,
      contains(x, y) {
        if (x < bb.minX || x > bb.maxX || y < bb.minY || y > bb.maxY) return false;
        const [lx, ly] = G.toLocal(box, x, y);
        if (shape === 'round') {
          const dx = (lx - box.w / 2) / (box.w / 2), dy = (ly - box.h / 2) / (box.h / 2);
          return dx * dx + dy * dy <= 1;
        }
        if (tri) return G.pointInPolygon(lx, ly, tri);
        return lx >= -1e-9 && lx <= box.w + 1e-9 && ly >= -1e-9 && ly <= box.h + 1e-9;
      },
    };
  }

  const featureBlock = (f) => (FEATURE_KINDS[f.kind] ? FEATURE_KINDS[f.kind].block : 'none');
  const roomOutline = (venue) => venue.outline || [[0, 0], [venue.room.w, 0], [venue.room.w, venue.room.h], [0, venue.room.h]];

  function usableGrid(venue) {
    const W = venue.room.w, H = venue.room.h;
    let cell = 0.5;
    if ((W / cell) * (H / cell) > 60000) cell = Math.ceil(Math.sqrt((W * H) / 60000) * 4) / 4;
    const nx = Math.round(W / cell), ny = Math.round(H / cell);
    const outline = roomOutline(venue);
    const solids = venue.features.filter((f) => featureBlock(f) === 'solid').map((f) => shapeTester(f, f.shape, f.corner));
    const mask = new Uint8Array(nx * ny);
    let count = 0;
    for (let gy = 0; gy < ny; gy++) {
      const cy = gy * cell + cell / 2;
      for (let gx = 0; gx < nx; gx++) {
        const cx = gx * cell + cell / 2;
        if (!G.pointInPolygon(cx, cy, outline)) continue;
        let ok = true;
        for (const s of solids) if (s.contains(cx, cy)) { ok = false; break; }
        if (ok) { mask[gy * nx + gx] = 1; count++; }
      }
    }
    return { cell, nx, ny, mask, area: count * cell * cell };
  }

  function furnitureOf(venue, types) {
    const out = [];
    for (const it of venue.items) {
      const t = types.get(it.type);
      if (!t || t.style === 'zone') continue;
      const box = itemBox(it, t);
      const shape = itemShape(t);
      const poly = G.boxPolygon(box, shape);
      out.push({ it, t, box, shape, poly, bb: G.bounds(poly) });
    }
    return out;
  }

  // Rasterizes each piece over its own bounding box only, so the cost grows with furniture area.
  function coveredArea(grid, furn) {
    const { cell, nx, ny, mask } = grid;
    const seen = new Uint8Array(nx * ny);
    let covered = 0;
    for (const f of furn) {
      const t = shapeTester(f.box, f.shape);
      const gx0 = Math.max(0, Math.floor(t.bb.minX / cell)), gx1 = Math.min(nx - 1, Math.floor(t.bb.maxX / cell));
      const gy0 = Math.max(0, Math.floor(t.bb.minY / cell)), gy1 = Math.min(ny - 1, Math.floor(t.bb.maxY / cell));
      for (let gy = gy0; gy <= gy1; gy++) {
        const cy = gy * cell + cell / 2;
        for (let gx = gx0; gx <= gx1; gx++) {
          const k = gy * nx + gx;
          if (!mask[k] || seen[k]) continue;
          if (t.contains(gx * cell + cell / 2, cy)) { seen[k] = 1; covered++; }
        }
      }
    }
    return covered * cell * cell;
  }

  const bbOverlap = (a, b) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

  function conflictReason(f) {
    if (f.kind === 'door' || f.kind === 'exit') return 'blocks a door or exit';
    if (f.kind === 'dance') return 'sits on the dance floor';
    if (f.kind === 'column') return 'overlaps a column';
    if (f.kind === 'wall') return 'overlaps a wall';
    return 'overlaps a fixed feature';
  }

  function findConflicts(venue, furn) {
    const W = venue.room.w, H = venue.room.h;
    const feats = venue.features.filter((f) => featureBlock(f) !== 'none').map((f) => {
      const poly = G.boxPolygon(f, f.shape, f.corner);
      return { f, poly, bb: G.bounds(poly) };
    });
    const byItem = new Map();
    const order = [];
    const flag = (id, reason) => {
      if (!byItem.has(id)) byItem.set(id, reason);
      if (!order.includes(reason)) order.push(reason);
    };
    for (let i = 0; i < furn.length; i++) {
      const a = furn[i];
      if (a.bb.minX < -0.05 || a.bb.maxX > W + 0.05 || a.bb.minY < -0.05 || a.bb.maxY > H + 0.05) flag(a.it.id, 'extends past the wall');
      for (const ft of feats) {
        if (bbOverlap(a.bb, ft.bb) && G.polygonsOverlap(a.poly, ft.poly)) { flag(a.it.id, conflictReason(ft.f)); break; }
      }
      for (let j = i + 1; j < furn.length; j++) {
        const b = furn[j];
        if (bbOverlap(a.bb, b.bb) && G.polygonsOverlap(a.poly, b.poly)) {
          flag(a.it.id, 'overlapping furniture');
          flag(b.it.id, 'overlapping furniture');
        }
      }
    }
    return { ids: new Set(byItem.keys()), byItem, count: byItem.size, reasons: order };
  }

  // Usable floor, coverage, circulation verdict and conflicts. `cache` keeps the floor mask between calls.
  function analyze(venue, cache) {
    const types = typeMap(venue);
    const key = JSON.stringify([venue.room, venue.outline || null, venue.features.filter((f) => featureBlock(f) === 'solid')]);
    let grid = cache && cache.key === key ? cache.grid : null;
    if (!grid) {
      grid = usableGrid(venue);
      if (cache) { cache.key = key; cache.grid = grid; }
    }
    const furn = furnitureOf(venue, types);
    const usable = grid.area;
    const used = coveredArea(grid, furn);
    const free = Math.max(0, usable - used);
    const guests = venue.target;
    const freePerGuest = guests > 0 ? free / guests : null;
    let verdict = 'Set a guest target to rate circulation', vclass = '';
    if (freePerGuest !== null) {
      if (freePerGuest >= 7) { verdict = 'Comfortable circulation'; vclass = 'ok'; }
      else if (freePerGuest >= 4) { verdict = 'Tight circulation'; vclass = 'warn'; }
      else { verdict = 'Cramped circulation'; vclass = 'bad'; }
    }
    return {
      usable, used, free, freePerGuest,
      seated: Math.floor(usable / 12), standing: Math.floor(usable / 8),
      verdict, vclass, conflicts: findConflicts(venue, furn),
    };
  }

  // Find a spot for a w x h box near (cx, cy) that is inside the room and clear of furniture and features.
  function findFreeSpot(venue, w, h, cx, cy) {
    const types = typeMap(venue);
    const furn = furnitureOf(venue, types);
    const obstacles = furn.map((f) => ({ poly: f.poly, bb: f.bb }))
      .concat(venue.features.filter((f) => featureBlock(f) !== 'none').map((f) => {
        const poly = G.boxPolygon(f, f.shape, f.corner);
        return { poly, bb: G.bounds(poly) };
      }));
    const outline = roomOutline(venue);
    const W = venue.room.w, H = venue.room.h;
    const fits = (x, y) => {
      if (x < 0 || y < 0 || x + w > W || y + h > H) return false;
      const poly = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      if (!poly.every(([px, py]) => G.pointInPolygon(Math.min(Math.max(px, 0.01), W - 0.01), Math.min(Math.max(py, 0.01), H - 0.01), outline))) return false;
      const bb = { minX: x, minY: y, maxX: x + w, maxY: y + h };
      for (const o of obstacles) if (bbOverlap(bb, o.bb) && G.polygonsOverlap(poly, o.poly)) return false;
      return true;
    };
    const snap = (v) => Math.round(v * 2) / 2;
    const maxR = Math.max(W, H);
    for (let r = 0; r <= maxR; r += 1) {
      const steps = r === 0 ? 1 : Math.ceil(2 * Math.PI * r);
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const x = snap(cx + r * Math.cos(a) - w / 2), y = snap(cy + r * Math.sin(a) - h / 2);
        if (fits(x, y)) return { x, y, free: true };
      }
    }
    return { x: snap(clamp(cx - w / 2, 0, Math.max(0, W - w))), y: snap(clamp(cy - h / 2, 0, Math.max(0, H - h))), free: false };
  }

  // ---------- legacy data (the original single-venue planner) ----------
  const LEGACY_TYPE_MAP = {
    dining: ['tbl8', false], table8: ['tbl8', true], sofa: ['sofa'], coffee: ['coffee'], cocktail: ['hitop'],
    six: ['tbl6'], four: ['tbl4'], cooler: ['cooler'], tub: ['tub'], zone: ['zone'],
  };

  function legacyItems(list, customMap) {
    const out = [];
    for (const o of Array.isArray(list) ? list : []) {
      if (!isObj(o)) continue;
      const known = LEGACY_TYPE_MAP[o.type];
      const type = known ? known[0] : customMap[o.type];
      if (!type) continue;
      const it = { type, x: o.x, y: o.y, rot: o.rot || 0 };
      if (known && known[1]) it.bare = true;
      if (typeof o.name === 'string' && o.name.trim()) it.label = o.name;
      out.push(it);
    }
    return out;
  }

  // Converts the original app's saved data ({items, customTypes} plus named layouts) into a venue
  // built on the sample template, so nothing is lost.
  function migrateLegacy(data, name) {
    const base = sampleVenue();
    const types = base.types.map((t) => Object.assign({}, t));
    const bySig = new Map();
    const addCustom = (custom) => {
      const map = {};
      if (!isObj(custom)) return map;
      for (const key of Object.keys(custom)) {
        const c = custom[key];
        if (!isObj(c)) continue;
        const t = {
          name: oneLine(c.label, 80) || 'Custom item', label: oneLine(c.label, 40),
          style: c.shape === 'circle' ? 'circle' : 'box',
          w: finite(c.w, 0), h: finite(c.h, 0), seats: intIn(c.seats, 0, 200, 0),
          qty: intIn(c.total, 0, 100000, 1), color: color(c.color, '#3d8168'),
        };
        if (!(t.w > 0 && t.h > 0)) continue;
        const sig = JSON.stringify([t.name, t.style, t.w, t.h, t.seats, t.color]);
        let id = bySig.get(sig);
        if (!id) {
          id = 'custom' + (bySig.size + 1);
          bySig.set(sig, id);
          types.push(Object.assign({ id }, t));
        } else {
          const existing = types.find((x) => x.id === id);
          existing.qty = Math.max(existing.qty, t.qty);
        }
        map[key] = id;
      }
      return map;
    };
    const cur = data && isObj(data.current) && Array.isArray(data.current.items) ? data.current : null;
    const items = cur ? legacyItems(cur.items, addCustom(cur.customTypes)) : sampleItems();
    const layouts = [];
    for (const L of data && Array.isArray(data.layouts) ? data.layouts : []) {
      if (!isObj(L) || !isObj(L.data) || !Array.isArray(L.data.items)) continue;
      layouts.push({ name: L.name, at: L.at, items: legacyItems(L.data.items, addCustom(L.data.customTypes)) });
    }
    if (!layouts.some((L) => L.name === 'Recommended layout')) layouts.push(base.layouts[0]);
    return normalizeVenue(Object.assign({}, base, {
      id: uid('v'), name: name || 'My 10th-floor plan', types, items, layouts, updatedAt: Date.now(),
    }));
  }

  // True when saved legacy data is just the untouched recommended layout.
  function isPristineLegacy(current) {
    if (!isObj(current) || !Array.isArray(current.items)) return false;
    if (isObj(current.customTypes) && Object.keys(current.customTypes).length) return false;
    const sig = (list) => JSON.stringify(list.map((i) => [i.type, i.x, i.y, i.rot || 0, i.label || '', !!i.bare]));
    return sig(legacyItems(current.items, {})) === sig(sampleItems());
  }

  // ---------- import / export ----------
  function exportDoc(venue) {
    return { app: APP_ID, format: FORMAT, exportedAt: new Date().toISOString(), venue: JSON.parse(JSON.stringify(venue)) };
  }

  // Compact copy for share links: no ids, no saved layouts.
  function shareDoc(venue) {
    const v = JSON.parse(JSON.stringify(venue));
    delete v.id;
    delete v.updatedAt;
    v.layouts = [];
    v.features.forEach((f) => delete f.id);
    v.items.forEach((i) => delete i.id);
    return { app: APP_ID, format: FORMAT, venue: v };
  }

  function parseImport(textIn) {
    if (typeof textIn !== 'string' || !textIn.trim()) fail('The file is empty.');
    if (textIn.length > 5e6) fail('This file is too large to be a Venue Planner export.');
    let data;
    try { data = JSON.parse(textIn); } catch (e) {
      fail('This file is not valid JSON. Choose a .json file exported from Venue Planner.');
    }
    return parseImportData(data);
  }

  function parseImportData(data) {
    const warnings = [];
    if (isObj(data) && data.app === APP_ID) {
      if (finite(data.format, 0) > FORMAT) fail('This file was made by a newer version of Venue Planner. Reload the page and try again.');
      return { venue: normalizeVenue(data.venue, warnings), warnings, legacy: false };
    }
    if (isObj(data) && (data.app === 'party-floor-planner' || (Array.isArray(data.items) && !isObj(data.room)))) {
      return { venue: migrateLegacy({ current: data, layouts: [] }, 'Imported 10th-floor plan'), warnings, legacy: true };
    }
    if (isObj(data) && isObj(data.room)) return { venue: normalizeVenue(data, warnings), warnings, legacy: false };
    fail('This file does not look like a Venue Planner export.');
  }

  function slug(s) {
    return String(s || 'venue').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'venue';
  }

  VP.model = {
    APP_ID, FORMAT, M_PER_FT, CHAIR_BAND, ROOM_MIN, ROOM_MAX, FEATURE_KINDS, FEATURE_ORDER, ITEM_STYLES, SAMPLE_NAME,
    VenueError, uid, clamp, r3, normRot, color, text, oneLine,
    fmtFtIn, fmtLen, fmtDim, fmtArea, fmtAreaPrecise, fmtInput, parseLength,
    typeMap, canHaveChairs, isSeated, footprint, seatsOf, chairsOf, itemShape, itemBox, itemLabel,
    describeItem, describeFeature, totals, featureBlock, roomOutline,
    normalizeVenue, sampleVenue, blankVenue, sampleItems,
    analyze, findFreeSpot, shapeTester,
    migrateLegacy, isPristineLegacy, exportDoc, shareDoc, parseImport, parseImportData, slug,
  };
})(typeof window !== 'undefined' ? window : globalThis);
