// Unit tests for the venue model, import/export, legacy migration and share links.
// Run with: node --test tests/*.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// The browser scripts attach themselves to a global VP namespace. Give them an in-memory localStorage.
class MemoryStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(i) { return Array.from(this.map.keys())[i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });

require('../js/geometry.js');
require('../js/model.js');
require('../js/storage.js');
const M = globalThis.VP.model;
const { local, share } = globalThis.VP.storage;

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not close to ${b}`);
const errorMessage = (fn) => {
  try { fn(); } catch (e) { assert.equal(e.name, 'VenueError'); return e.message; }
  assert.fail('expected a VenueError');
};

test('parseLength reads feet and inches, plain numbers and metric input', () => {
  for (const s of [`62' 6"`, `62'-6"`, '62ft 6in', '62 6', '62.5', '750"', '62\u2032 6\u2033']) near(M.parseLength(s, 'ft'), 62.5);
  near(M.parseLength('19.05m', 'ft'), 62.5, 1e-3);
  near(M.parseLength('1905cm', 'ft'), 62.5, 1e-3);
  near(M.parseLength('19.05', 'm'), 62.5, 1e-3);
  assert.ok(Number.isNaN(M.parseLength('', 'ft')));
  assert.ok(Number.isNaN(M.parseLength('wide', 'ft')));
  assert.ok(Number.isNaN(M.parseLength('19 5', 'm')));
});

test('length formatting round-trips through the input parser', () => {
  assert.equal(M.fmtInput(62.5, 'ft'), `62' 6"`);
  assert.equal(M.fmtDim(19.5, 'ft'), `19'-6"`);
  for (const ft of [4, 12.25, 62.5, 75, 999.5]) {
    near(M.parseLength(M.fmtInput(ft, 'ft'), 'ft'), ft, 0.01);
    near(M.parseLength(M.fmtInput(ft, 'm'), 'm'), ft, 0.02);
  }
});

test('the sample template reproduces the original 10th-floor venue', () => {
  const v = M.sampleVenue();
  assert.deepEqual(v.room, { w: 75, h: 62.5 });
  assert.equal(v.target, 85);
  const t = M.totals(v);
  assert.equal(t.seats, 102);
  assert.equal(t.chairs, 90);
  assert.equal(v.chairs, 100);
  const a = M.analyze(v);
  assert.equal(Math.round(a.usable), 3076);
  assert.equal(a.conflicts.count, 0);
  assert.equal(a.verdict, 'Comfortable circulation');
  assert.deepEqual(v.layouts.map((L) => L.name), ['Recommended layout']);
});

test('blank venues start empty or with editable starter furniture', () => {
  const empty = M.blankVenue({ name: 'Hall', w: 40, h: 30, target: 50 });
  assert.equal(empty.types.length, 0);
  assert.equal(empty.items.length, 0);
  assert.equal(empty.chairs, 0);
  const starter = M.blankVenue({ name: 'Hall', w: 40, h: 30, target: 80, starter: true });
  assert.ok(starter.types.length > 0);
  assert.equal(starter.chairs, 90);
  assert.throws(() => M.blankVenue({ w: 2, h: 30 }), /room size/);
});

test('the space check flags overlaps, walls and blocked doors', () => {
  const v = M.blankVenue({ w: 30, h: 20, target: 10, starter: true });
  v.features.push({ id: 'd1', kind: 'door', x: 0, y: 8, w: 1, h: 3, rot: 0 });
  v.items.push(
    { id: 'a', type: 'banquet8', x: 5, y: 5, rot: 0 },
    { id: 'b', type: 'banquet8', x: 6, y: 5.5, rot: 0 },
    { id: 'c', type: 'banquet6', x: 27, y: 15, rot: 0 },
    { id: 'd', type: 'cocktail', x: 0.5, y: 9, rot: 0 },
  );
  const { conflicts } = M.analyze(v);
  assert.equal(conflicts.byItem.get('a'), 'overlapping furniture');
  assert.equal(conflicts.byItem.get('b'), 'overlapping furniture');
  assert.equal(conflicts.byItem.get('c'), 'extends past the wall');
  assert.equal(conflicts.byItem.get('d'), 'blocks a door or exit');
});

test('normalizeVenue rejects impossible rooms and skips invalid entries with warnings', () => {
  assert.match(errorMessage(() => M.normalizeVenue({ room: { w: 2000, h: 30 } })), /outside the supported range/);
  assert.match(errorMessage(() => M.normalizeVenue('nope')), /does not contain a venue/);
  const warnings = [];
  const v = M.normalizeVenue({
    name: 'Hall', room: { w: 40, h: 30 },
    features: [{ kind: 'column', x: 1, y: 1, w: 1, h: 1 }, { kind: 'volcano', x: 1, y: 1, w: 1, h: 1 }],
    types: [{ id: 't1', name: 'Round', style: 'round', w: 5, h: 5, seats: 8, qty: 3 }, { name: 'No size' }],
    items: [{ type: 't1', x: 5, y: 5 }, { type: 'missing', x: 1, y: 1 }, { type: 't1', x: 'left', y: 2 }],
  }, warnings);
  assert.equal(v.features.length, 1);
  assert.equal(v.types.length, 1);
  assert.equal(v.items.length, 1);
  assert.deepEqual(warnings.sort(), [
    '1 fixed feature was invalid and skipped.',
    '1 item type was invalid and skipped.',
    '1 placed item uses an unknown item type and was skipped.',
    '1 placed item was invalid and skipped.',
  ]);
});

test('exported files import back unchanged, and bad files get friendly errors', () => {
  const v = M.sampleVenue();
  const back = M.parseImport(JSON.stringify(M.exportDoc(v)));
  assert.deepEqual(back.venue, v);
  assert.deepEqual(back.warnings, []);
  assert.match(errorMessage(() => M.parseImport('')), /empty/);
  assert.match(errorMessage(() => M.parseImport('{oops')), /not valid JSON/);
  assert.match(errorMessage(() => M.parseImport('{"hello":1}')), /does not look like a Venue Planner export/);
  const newer = Object.assign(M.exportDoc(v), { format: M.FORMAT + 1 });
  assert.match(errorMessage(() => M.parseImport(JSON.stringify(newer))), /newer version/);
});

test('data from the original single-venue planner migrates into a venue', () => {
  const current = {
    items: [
      { type: 'dining', x: 8, y: 13, rot: 0 },
      { type: 'table8', x: 30, y: 30, rot: 90, name: 'Gifts' },
      { type: 'c1', x: 50, y: 40, rot: 0 },
    ],
    customTypes: { c1: { label: 'Photo booth', w: 6, h: 6, seats: 0, total: 1, color: '#123456' } },
  };
  const v = M.migrateLegacy({ current, layouts: [{ name: 'Plan B', at: 1, data: { items: [{ type: 'sofa', x: 6, y: 4.5 }] } }] });
  assert.equal(v.items.length, 3);
  assert.equal(v.items[1].bare, true);
  assert.equal(v.items[1].label, 'Gifts');
  const booth = v.types.find((t) => t.name === 'Photo booth');
  assert.ok(booth);
  assert.equal(v.items[2].type, booth.id);
  assert.deepEqual(v.layouts.map((L) => L.name).sort(), ['Plan B', 'Recommended layout']);
});

test('legacy browser data is migrated once, and an untouched default layout is ignored', () => {
  storage.clear();
  const pristine = { items: M.sampleItems().map((i) => ({ type: i.bare ? 'table8' : { tbl8: 'dining', hitop: 'cocktail', tbl6: 'six', tbl4: 'four' }[i.type] || i.type, x: i.x, y: i.y, rot: 0, name: i.label })) };
  storage.setItem('epp_current', JSON.stringify(pristine));
  assert.equal(local.migrateLegacy(), null);

  storage.clear();
  storage.setItem('epp_current', JSON.stringify({ items: [{ type: 'dining', x: 10, y: 10, rot: 0 }] }));
  storage.setItem('epp_layouts', JSON.stringify({ Saturday: { at: 5, data: { items: [] } } }));
  const v = local.migrateLegacy();
  assert.ok(v);
  assert.equal(local.load(v.id).items.length, 1);
  assert.deepEqual(local.list().map((e) => e.id), [v.id]);
  assert.equal(local.migrateLegacy(), null);
});

test('share links round-trip a venue without its saved layouts', async () => {
  const v = M.sampleVenue();
  const code = await share.encode(v);
  assert.match(code, /^[zj][A-Za-z0-9_-]+$/);
  assert.equal(share.fromHash('#plan=' + code), code);
  const { venue } = await share.decode(code);
  assert.deepEqual(venue.room, v.room);
  assert.equal(venue.items.length, v.items.length);
  assert.equal(venue.features.length, v.features.length);
  assert.equal(M.totals(venue).seats, 102);
  assert.deepEqual(venue.layouts, []);
  await assert.rejects(share.decode(code.slice(0, 20)), /incomplete or damaged/);
  await assert.rejects(share.decode('x!'), /incomplete or damaged/);
});
