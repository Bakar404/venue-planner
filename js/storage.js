/* Venue Planner: persistence. Local storage is the source of truth; share links and the
   optional Supabase sync are layered on top. */
(function (root) {
  'use strict';
  const VP = (root.VP = root.VP || {});
  const M = VP.model;

  const KEY_INDEX = 'vp.venues';
  const KEY_PREFIX = 'vp.venue.';
  const KEY_CURRENT = 'vp.current';
  const KEY_PREFS = 'vp.prefs';
  const KEY_MIGRATED = 'vp.migratedLegacy';
  const LEGACY_CURRENT = 'epp_current';
  const LEGACY_LAYOUTS = 'epp_layouts';

  function store() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }
  function readJSON(key) {
    const s = store();
    if (!s) return null;
    try {
      const raw = s.getItem(key);
      return raw == null ? null : JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  function writeJSON(key, value) {
    const s = store();
    if (!s) throw new Error('Browser storage is not available.');
    s.setItem(key, JSON.stringify(value));
  }

  // ---------- local venues ----------
  const local = {
    available() {
      const s = store();
      if (!s) return false;
      try { s.setItem('vp.test', '1'); s.removeItem('vp.test'); return true; } catch (e) { return false; }
    },

    // Index of saved venues, newest first. Rebuilt from the stored documents if it is missing or stale.
    list() {
      const s = store();
      if (!s) return [];
      let index = readJSON(KEY_INDEX);
      if (!Array.isArray(index)) index = [];
      const byId = new Map();
      for (const e of index) if (e && typeof e.id === 'string' && s.getItem(KEY_PREFIX + e.id) !== null) byId.set(e.id, e);
      for (let i = 0; i < s.length; i++) {
        const key = s.key(i);
        if (!key || key.indexOf(KEY_PREFIX) !== 0) continue;
        const id = key.slice(KEY_PREFIX.length);
        if (byId.has(id)) continue;
        const doc = readJSON(key);
        if (doc && doc.room) byId.set(id, { id, name: String(doc.name || 'Untitled venue'), updatedAt: Number(doc.updatedAt) || 0 });
      }
      return Array.from(byId.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },

    load(id) {
      const raw = readJSON(KEY_PREFIX + id);
      if (!raw) return null;
      try {
        const v = M.normalizeVenue(raw);
        v.id = id;
        return v;
      } catch (e) {
        return null;
      }
    },

    save(venue) {
      writeJSON(KEY_PREFIX + venue.id, venue);
      const list = local.list().filter((e) => e.id !== venue.id);
      list.unshift({ id: venue.id, name: venue.name, updatedAt: venue.updatedAt });
      list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      writeJSON(KEY_INDEX, list);
    },

    remove(id) {
      const s = store();
      if (!s) return;
      s.removeItem(KEY_PREFIX + id);
      writeJSON(KEY_INDEX, local.list().filter((e) => e.id !== id));
      if (s.getItem(KEY_CURRENT) === id) s.removeItem(KEY_CURRENT);
    },

    getCurrent() {
      const s = store();
      return s ? s.getItem(KEY_CURRENT) : null;
    },
    setCurrent(id) {
      const s = store();
      if (!s) return;
      try { s.setItem(KEY_CURRENT, id); } catch (e) { /* storage full: the current venue is still saved */ }
    },

    getPrefs() {
      const p = readJSON(KEY_PREFS);
      return Object.assign({ dims: true, grid: true, snap: false, dismissed: {} }, p && typeof p === 'object' ? p : {});
    },
    setPrefs(prefs) {
      try { writeJSON(KEY_PREFS, prefs); } catch (e) { /* preferences are optional */ }
    },

    // One-time import of the original single-venue planner's data. The old keys are left untouched.
    migrateLegacy() {
      const s = store();
      if (!s || s.getItem(KEY_MIGRATED)) return null;
      const current = readJSON(LEGACY_CURRENT);
      const saved = readJSON(LEGACY_LAYOUTS);
      try { s.setItem(KEY_MIGRATED, String(Date.now())); } catch (e) { return null; }
      const layouts = saved && typeof saved === 'object' && !Array.isArray(saved)
        ? Object.keys(saved).map((name) => ({ name, at: saved[name] && saved[name].at, data: saved[name] && saved[name].data }))
        : [];
      const hasCurrent = current && Array.isArray(current.items);
      if (!hasCurrent && !layouts.length) return null;
      if (!layouts.length && M.isPristineLegacy(current)) return null;
      const venue = M.migrateLegacy({ current: hasCurrent ? current : null, layouts }, 'My 10th-floor plan');
      try { local.save(venue); } catch (e) { return null; }
      return venue;
    },
  };

  // ---------- share links ----------
  function toB64url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64url(s) {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function readLimited(stream, limit) {
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) { await reader.cancel(); throw new M.VenueError('This share link is too large to open.'); }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }

  const share = {
    async encode(venue) {
      const bytes = new TextEncoder().encode(JSON.stringify(M.shareDoc(venue)));
      if (typeof CompressionStream === 'function') {
        try {
          const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
          return 'z' + toB64url(await readLimited(stream, 20e6));
        } catch (e) { /* fall back to plain encoding */ }
      }
      return 'j' + toB64url(bytes);
    },

    async decode(code) {
      const bad = () => new M.VenueError('This share link is incomplete or damaged. Ask for a new link.');
      if (typeof code !== 'string' || code.length < 2 || !/^[zj][A-Za-z0-9_-]+$/.test(code)) throw bad();
      let bytes;
      try { bytes = fromB64url(code.slice(1)); } catch (e) { throw bad(); }
      if (code[0] === 'z') {
        if (typeof DecompressionStream !== 'function') throw new M.VenueError('This browser cannot open compressed share links. Try a current version of Chrome, Edge, Firefox or Safari.');
        try {
          bytes = await readLimited(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')), 5e6);
        } catch (e) {
          if (e && e.friendly) throw e;
          throw bad();
        }
      }
      let data;
      try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { throw bad(); }
      return M.parseImportData(data);
    },

    fromHash(hash) {
      const m = /^#plan=([A-Za-z0-9_-]+)$/.exec(hash || '');
      return m ? m[1] : null;
    },
  };

  // ---------- optional cloud sync (Supabase) ----------
  const TABLE = 'layouts';
  const ROW_PREFIX = 'venue:';
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

  function config() {
    const c = root.SUPABASE_CONFIG || {};
    return { url: String(c.url || '').trim(), key: String(c.anonKey || '').trim() };
  }

  function loadSdk() {
    if (root.supabase && typeof root.supabase.createClient === 'function') return Promise.resolve(root.supabase);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SDK_URL;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.onload = () => (root.supabase && root.supabase.createClient ? resolve(root.supabase) : reject(new Error('The Supabase library did not load.')));
      s.onerror = () => reject(new Error('Could not load the Supabase library.'));
      document.head.appendChild(s);
    });
  }

  const cloud = {
    client: null,
    user: null,

    configured() {
      const c = config();
      return /^https?:\/\/\S+$/.test(c.url) && c.key.length > 20 && !/YOUR-/i.test(c.url + c.key);
    },

    // Loads the SDK only when sync is configured, then reports auth changes through onUser(user|null).
    async init(onUser) {
      if (!cloud.configured()) return false;
      const lib = await loadSdk();
      const c = config();
      cloud.client = lib.createClient(c.url, c.key);
      cloud.client.auth.onAuthStateChange((_event, session) => {
        const u = session && session.user ? session.user : null;
        if ((u && u.id) === (cloud.user && cloud.user.id)) return;
        cloud.user = u;
        onUser(u);
      });
      const { data } = await cloud.client.auth.getSession();
      const u = data && data.session ? data.session.user : null;
      if ((u && u.id) !== (cloud.user && cloud.user.id)) {
        cloud.user = u;
        onUser(u);
      }
      return true;
    },

    async signIn(email, password) {
      const { error } = await cloud.client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signUp(email, password) {
      const { data, error } = await cloud.client.auth.signUp({ email, password });
      if (error) throw error;
      return !!(data && data.session);
    },
    async signOut() {
      await cloud.client.auth.signOut();
    },

    syncedKey() { return 'vp.sync.' + (cloud.user ? cloud.user.id : 'none'); },
    readSynced() { const m = readJSON(cloud.syncedKey()); return m && typeof m === 'object' ? m : {}; },
    writeSynced(m) { try { writeJSON(cloud.syncedKey(), m); } catch (e) { /* retried on next sync */ } },

    async upsert(userId, venue) {
      const { error } = await cloud.client.from(TABLE).upsert({
        user_id: userId, name: ROW_PREFIX + venue.id, data: venue,
        is_autosave: false, updated_at: new Date(venue.updatedAt).toISOString(),
      }, { onConflict: 'user_id,name' });
      if (error) throw error;
    },
    async deleteRow(userId, id) {
      const { error } = await cloud.client.from(TABLE).delete().eq('user_id', userId).eq('name', ROW_PREFIX + id);
      if (error) throw error;
    },

    async push(venue) {
      if (!cloud.user) return;
      await cloud.upsert(cloud.user.id, venue);
      const synced = cloud.readSynced();
      synced[venue.id] = venue.updatedAt;
      cloud.writeSynced(synced);
    },

    async remove(id) {
      if (!cloud.user) return;
      await cloud.deleteRow(cloud.user.id, id);
      const synced = cloud.readSynced();
      delete synced[id];
      cloud.writeSynced(synced);
    },

    // Two-way merge between this browser and the account. Newer copies win; a venue that was synced
    // before and is now missing on one side is treated as deleted there. Returns ids changed locally.
    async syncAll() {
      if (!cloud.user) return [];
      const uidNow = cloud.user.id;
      const { data, error } = await cloud.client.from(TABLE).select('name,data,updated_at,is_autosave').eq('user_id', uidNow);
      if (error) throw error;
      const remote = new Map();
      const legacyRows = [];
      for (const row of data || []) {
        if (typeof row.name === 'string' && row.name.indexOf(ROW_PREFIX) === 0) {
          try {
            const v = M.normalizeVenue(row.data);
            v.id = row.name.slice(ROW_PREFIX.length);
            remote.set(v.id, v);
          } catch (e) { /* skip rows that are not valid venues */ }
        } else {
          legacyRows.push(row);
        }
      }
      const synced = cloud.readSynced();
      const changed = [];

      // Rows written by the original single-venue planner become one venue, once.
      if (!remote.size && legacyRows.length && !synced.__legacy) {
        const auto = legacyRows.find((r) => r.is_autosave || r.name === '__autosave__');
        const layouts = legacyRows.filter((r) => r !== auto && !r.is_autosave)
          .map((r) => ({ name: r.name, at: Date.parse(r.updated_at) || Date.now(), data: r.data }));
        const v = M.migrateLegacy({ current: auto ? auto.data : null, layouts }, 'My 10th-floor plan (cloud)');
        local.save(v);
        changed.push(v.id);
        synced.__legacy = 1;
      }

      const localIds = new Set(local.list().map((e) => e.id));
      for (const [id, rv] of remote) {
        if (localIds.has(id)) continue;
        if (synced[id] !== undefined) {
          await cloud.deleteRow(uidNow, id);
          delete synced[id];
        } else {
          local.save(rv);
          synced[id] = rv.updatedAt;
          changed.push(id);
        }
      }
      for (const id of localIds) {
        const lv = local.load(id);
        if (!lv) continue;
        const rv = remote.get(id);
        if (!rv) {
          if (synced[id] !== undefined && lv.updatedAt <= synced[id]) {
            local.remove(id);
            delete synced[id];
            changed.push(id);
          } else {
            await cloud.upsert(uidNow, lv);
            synced[id] = lv.updatedAt;
          }
        } else if (rv.updatedAt > lv.updatedAt) {
          local.save(rv);
          synced[id] = rv.updatedAt;
          changed.push(id);
        } else if (lv.updatedAt > rv.updatedAt) {
          await cloud.upsert(uidNow, lv);
          synced[id] = lv.updatedAt;
        } else {
          synced[id] = lv.updatedAt;
        }
      }
      cloud.writeSynced(synced);
      return changed;
    },
  };

  VP.storage = { local, share, cloud };
})(typeof window !== 'undefined' ? window : globalThis);
