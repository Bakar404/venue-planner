/* Venue Planner: SVG rendering. Produces markup strings that the app inserts into the page and
   that the PNG export rasterizes, so both always match. Colors are literal attributes because
   page CSS does not apply inside an exported image. */
(function (root) {
  'use strict';
  const VP = (root.VP = root.VP || {});
  const G = VP.geometry;
  const M = VP.model;

  const FT = 11; // SVG units per foot
  const PAD = { t: 78, r: 40, b: 76, l: 54 };
  const FONT = 'Segoe UI, system-ui, -apple-system, Helvetica, Arial, sans-serif';
  const C = {
    ink: '#1f2733', blue: '#2f5d8a', blueFill: '#e4edf5', grid: '#d8d3c6', paper: '#f6f4ee',
    accent: '#b5562e', conflict: '#c0392b', note: '#6b6658', wood: '#a8896a', woodDark: '#8a6f52',
  };

  const n = (v) => Math.round(v * 100) / 100;
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

  function shade(hex, k) {
    const v = parseInt(hex.slice(1), 16);
    const ch = (s) => Math.max(0, Math.min(255, Math.round(((v >> s) & 255) * k)));
    return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
  }
  function luminance(hex) {
    const v = parseInt(hex.slice(1), 16);
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
  }

  // Rough text width so labels can be shrunk, wrapped or hidden without measuring the DOM.
  function textWidth(s, fs) {
    let w = 0;
    for (const ch of s) {
      if (ch === ' ') w += 0.28;
      else if ('il.,:;|!\'`'.includes(ch)) w += 0.27;
      else if ('mwMW'.includes(ch)) w += 0.82;
      else if (/[A-Z0-9]/.test(ch)) w += 0.64;
      else if (/[a-z]/.test(ch)) w += 0.53;
      else w += 0.4;
    }
    return w * fs;
  }
  function wrap(lines, fs, maxW) {
    const out = [];
    for (const line of lines) {
      if (textWidth(line, fs) <= maxW) { out.push(line); continue; }
      let cur = '';
      for (const word of line.split(/\s+/)) {
        const t = cur ? cur + ' ' + word : word;
        if (cur && textWidth(t, fs) > maxW) { out.push(cur); cur = word; } else cur = t;
      }
      if (cur) out.push(cur);
    }
    return out;
  }
  const upsideDown = (rot) => { const r = ((rot % 360) + 360) % 360; return r > 90 && r <= 270; };

  function textBlock(lines, cx, cy, fs, attrs, flip, lineGap) {
    const lh = fs * (lineGap || 1.15);
    const y0 = cy - ((lines.length - 1) * lh) / 2;
    const tf = flip ? ' transform="rotate(180 ' + n(cx) + ' ' + n(cy) + ')"' : '';
    return '<text font-size="' + n(fs) + '" text-anchor="middle" dominant-baseline="middle" font-family="' + FONT + '" ' + attrs + tf + '>' +
      lines.map((l, i) => '<tspan x="' + n(cx) + '" y="' + n(y0 + i * lh) + '">' + esc(l) + '</tspan>').join('') + '</text>';
  }

  function groupTransform(box) {
    const W = box.w * FT, H = box.h * FT;
    return 'translate(' + n(box.x * FT) + ' ' + n(box.y * FT) + ')' + (box.rot ? ' rotate(' + n(box.rot) + ' ' + n(W / 2) + ' ' + n(H / 2) + ')' : '');
  }

  function shapeMarkup(shape, corner, W, H, attrs, rx) {
    if (shape === 'round') return '<ellipse cx="' + n(W / 2) + '" cy="' + n(H / 2) + '" rx="' + n(W / 2) + '" ry="' + n(H / 2) + '" ' + attrs + '/>';
    if (shape === 'tri') return '<polygon points="' + G.localOutline('tri', W, H, corner).map((p) => n(p[0]) + ',' + n(p[1])).join(' ') + '" ' + attrs + '/>';
    return '<rect width="' + n(W) + '" height="' + n(H) + '" rx="' + n(Math.min(rx || 0, W / 2, H / 2)) + '" ' + attrs + '/>';
  }

  function defs() {
    return '<defs>' +
      '<filter id="vp-shadow" x="-10%" y="-40%" width="120%" height="180%"><feDropShadow dx="0" dy="0.8" stdDeviation="0.55" flood-color="#000" flood-opacity=".38"/></filter>' +
      '<pattern id="vp-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#fbeee9"/><line x1="0" y1="0" x2="0" y2="8" stroke="#c0392b" stroke-width="2" stroke-opacity=".35"/></pattern>' +
      '<pattern id="vp-checker" width="22" height="22" patternUnits="userSpaceOnUse"><rect width="22" height="22" fill="#f4ecdd"/><rect width="11" height="11" fill="#e9dcc3"/><rect x="11" y="11" width="11" height="11" fill="#e9dcc3"/></pattern>' +
      '</defs>';
  }

  // ---------- room ----------
  function gridStep(venue) {
    let step = venue.units === 'm' ? 2 / M.M_PER_FT : 5;
    while (Math.max(venue.room.w, venue.room.h) / step > 200) step *= 2;
    return step;
  }

  function structureSVG(venue, opts) {
    const W = venue.room.w, H = venue.room.h;
    const outline = M.roomOutline(venue);
    const pts = (poly) => poly.map((p) => n(p[0] * FT) + ',' + n(p[1] * FT)).join(' ');
    let s = '<polygon points="' + pts(outline) + '" fill="#fff"/>';
    if (opts.grid) {
      const step = gridStep(venue);
      let d = '';
      for (let g = 0; g <= W + 1e-6; g += step) d += 'M' + n(g * FT) + ' 0V' + n(H * FT);
      for (let g = 0; g <= H + 1e-6; g += step) d += 'M0 ' + n(g * FT) + 'H' + n(W * FT);
      s += '<path d="' + d + '" stroke="' + C.grid + '" stroke-width=".6" fill="none"/>';
    }
    s += '<polygon points="' + pts(outline) + '" fill="none" stroke="' + C.ink + '" stroke-width="2.4"/>';
    s += '<polygon points="' + pts(G.insetPolygon(outline, 0.7)) + '" fill="none" stroke="' + C.ink + '" stroke-width=".8" opacity=".5"/>';
    return s;
  }

  // ---------- fixed features ----------
  function featureSVG(f, opts) {
    const W = f.w * FT, H = f.h * FT;
    const shp = (attrs, rx) => shapeMarkup(f.shape, f.corner, W, H, attrs, rx);
    const hit = '<rect width="' + n(W) + '" height="' + n(H) + '" fill="#fff" fill-opacity="0"/>';
    let body = '', color = C.blue, weight = 600, textOnly = false;
    switch (f.kind) {
      case 'column': body = shp('fill="' + C.ink + '" fill-opacity=".55"', 0); color = C.ink; break;
      case 'wall': body = shp('fill="#3a4350" stroke="' + C.ink + '" stroke-width=".8"', 0); color = '#fff'; break;
      case 'room': body = shp('fill="#fff" stroke="' + C.blue + '" stroke-width="1.4"', 2); break;
      case 'stairs': body = shp('fill="' + C.blueFill + '" stroke="' + C.blue + '" stroke-width="1.4"', 2); break;
      case 'elevator':
        body = shp('fill="' + C.blueFill + '" stroke="' + C.blue + '" stroke-width="1.4"', 2) +
          '<path d="M0 0L' + n(W) + ' ' + n(H) + 'M0 ' + n(H) + 'L' + n(W) + ' 0" stroke="' + C.blue + '" stroke-width=".8"/>';
        break;
      case 'area': body = shp('fill="' + C.blue + '" fill-opacity=".07" stroke="' + C.blue + '" stroke-width="1"', 2); break;
      case 'stage': body = shp('fill="#ede4d3" stroke="' + C.woodDark + '" stroke-width="1.4"', 2); color = '#5c4630'; break;
      case 'bar':
      case 'counter': body = shp('fill="#e6d5bd" stroke="' + C.woodDark + '" stroke-width="1.2"', 3); color = '#5c4630'; break;
      case 'dance': body = shp('fill="url(#vp-checker)" stroke="#a07d4c" stroke-width="1.2"', 2); color = '#6e5230'; break;
      case 'nogo': body = shp('fill="url(#vp-hatch)" stroke="#a13f1f" stroke-width="1.2" stroke-dasharray="5 3"', 2); color = '#a13f1f'; break;
      case 'window':
        body = shp('fill="#dcebf7" stroke="' + C.blue + '" stroke-width="1"', 0) +
          '<line x1="0" y1="' + n(H / 2) + '" x2="' + n(W) + '" y2="' + n(H / 2) + '" stroke="' + C.blue + '" stroke-width=".7"/>';
        break;
      case 'door':
      case 'exit': {
        const col = f.kind === 'exit' ? '#2e7d4f' : C.ink;
        color = col;
        body = hit +
          '<path d="M0 0L' + n(W) + ' 0A' + n(W) + ' ' + n(H) + ' 0 0 1 0 ' + n(H) + 'Z" fill="' + col + '" fill-opacity=".07"/>' +
          '<path d="M' + n(W) + ' 0A' + n(W) + ' ' + n(H) + ' 0 0 1 0 ' + n(H) + '" fill="none" stroke="' + col + '" stroke-width=".9" stroke-dasharray="3 2"/>' +
          '<line x1="0" y1="0" x2="' + n(W) + '" y2="0" stroke="#fff" stroke-width="3"/>' +
          '<line x1="0" y1="0" x2="0" y2="' + n(H) + '" stroke="' + col + '" stroke-width="1.6"/>';
        break;
      }
      case 'note': textOnly = true; color = C.note; weight = 400; body = hit; break;
      default: textOnly = true; body = hit; // label
    }

    let label = '';
    if (f.label) {
      let lines = f.label.split('\n');
      let fs = f.fs || (textOnly ? H * 0.64 : M.clamp(Math.min(W, H) * 0.16, 7, 12));
      if (!textOnly) {
        const maxW = Math.max(W * 0.92, 4);
        lines = wrap(lines, fs, maxW);
        while (fs > 5 && (lines.length * fs * 1.25 > H + 2 || lines.some((l) => textWidth(l, fs) > maxW))) {
          fs -= 0.5;
          lines = wrap(f.label.split('\n'), fs, maxW);
        }
      }
      let cx = W / 2, cy = H / 2;
      if (f.shape === 'tri') { const c = G.centroid(G.localOutline('tri', W, H, f.corner)); cx = c[0]; cy = c[1]; }
      if (f.kind === 'door' || f.kind === 'exit') { cx = W * 0.42; cy = H * 0.42; }
      const attrs = 'fill="' + color + '" font-weight="' + weight + '"' + (f.kind === 'note' || f.kind === 'label' ? '' : ' letter-spacing=".2"');
      label = textBlock(lines, cx, cy, fs, attrs, upsideDown(f.rot), textOnly ? 1.15 : 1.3);
    }

    const desc = M.describeFeature(f, opts.units);
    const a11y = opts.interactive ? ' tabindex="0" role="button" aria-label="' + esc(desc) + '"' : '';
    return '<g class="feat feat-' + f.kind + '" data-feat="' + esc(f.id) + '" transform="' + groupTransform(f) + '"' + a11y + '>' + body + label + '</g>';
  }

  // ---------- furniture ----------
  function chairsAlongSides(t, W, H, dark) {
    const cw = 1.0 * FT, ch = 1.25 * FT;
    const rows = [[Math.ceil(t.seats / 2), 0.2 * FT], [Math.floor(t.seats / 2), H - 1.45 * FT]];
    let s = '';
    for (const [count, y] of rows) {
      if (!count) continue;
      let w = cw, gap = (W - count * cw) / (count + 1);
      if (gap < 1.1) { gap = 1.1; w = (W - gap * (count + 1)) / count; }
      for (let i = 0; i < count; i++) {
        s += '<rect x="' + n(gap + i * (w + gap)) + '" y="' + n(y) + '" width="' + n(Math.max(w, 2)) + '" height="' + n(ch) + '" rx="3" fill="' + dark + '" fill-opacity=".85"/>';
      }
    }
    return s;
  }
  function chairsAround(t, W, H, dark) {
    const cw = 1.0 * FT, ch = 1.25 * FT;
    const rx = (t.w / 2 + 1.425) * FT, ry = (t.h / 2 + 1.425) * FT;
    let s = '';
    for (let i = 0; i < t.seats; i++) {
      const a = -Math.PI / 2 + (i / t.seats) * Math.PI * 2;
      const x = W / 2 + rx * Math.cos(a), y = H / 2 + ry * Math.sin(a);
      s += '<rect x="' + n(-cw / 2) + '" y="' + n(-ch / 2) + '" width="' + n(cw) + '" height="' + n(ch) + '" rx="3" fill="' + dark +
        '" fill-opacity=".85" transform="translate(' + n(x) + ' ' + n(y) + ') rotate(' + n((a * 180) / Math.PI + 90) + ')"/>';
    }
    return s;
  }

  function itemSVG(it, t, opts) {
    const fp = M.footprint(it, t);
    const W = fp.w * FT, H = fp.h * FT;
    const seated = M.isSeated(it, t);
    const wood = M.canHaveChairs(t) && it.bare;
    const fill = wood ? C.wood : t.color;
    const dark = wood ? C.woodDark : shade(t.color, 0.78);
    let body = '';
    let availW = W - 4, availH = H - 2, cx = W / 2, cy = H / 2;
    switch (t.style) {
      case 'table': {
        const ty = seated ? M.CHAIR_BAND * FT : 0;
        body = '<rect y="' + n(ty) + '" width="' + n(W) + '" height="' + n(t.h * FT) + '" rx="' + n(Math.min(4, t.h * FT / 2)) + '" fill="' + fill + '" stroke="' + dark + '"/>';
        if (seated) { body += chairsAlongSides(t, W, H, dark); availH = t.h * FT; }
        break;
      }
      case 'round': {
        body = '<ellipse cx="' + n(W / 2) + '" cy="' + n(H / 2) + '" rx="' + n(t.w * FT / 2) + '" ry="' + n(t.h * FT / 2) + '" fill="' + fill + '" stroke="' + dark + '"/>';
        if (seated) body += chairsAround(t, W, H, dark);
        availW = t.w * FT * 0.82; availH = t.h * FT * 0.8;
        break;
      }
      case 'chairs': {
        const count = Math.max(1, t.seats), cwp = W / count;
        for (let i = 0; i < count; i++) {
          body += '<rect x="' + n(i * cwp + 1) + '" y="1" width="' + n(Math.max(cwp - 2, 1)) + '" height="' + n(Math.max(H - 2, 1)) + '" rx="3" fill="' + fill + '" stroke="' + dark + '"/>' +
            '<rect x="' + n(i * cwp + 2.5) + '" y="2" width="' + n(Math.max(cwp - 5, 1)) + '" height="' + n(Math.max(H * 0.24, 1)) + '" rx="2" fill="' + dark + '" fill-opacity=".6"/>';
        }
        break;
      }
      case 'sofa':
        body = '<rect width="' + n(W) + '" height="' + n(H) + '" rx="' + n(Math.min(7, W / 2, H / 2)) + '" fill="' + fill + '" stroke="' + dark + '"/>' +
          '<rect x="' + n(W * 0.06) + '" y="' + n(H * 0.08) + '" width="' + n(W * 0.88) + '" height="' + n(H * 0.26) + '" rx="' + n(Math.min(5, H * 0.13)) + '" fill="' + dark + '" fill-opacity=".6"/>';
        break;
      case 'circle':
        body = '<ellipse cx="' + n(W / 2) + '" cy="' + n(H / 2) + '" rx="' + n(W / 2) + '" ry="' + n(H / 2) + '" fill="' + fill + '" stroke="' + dark + '"/>';
        availW = W * 0.86; availH = H * 0.8;
        break;
      case 'zone':
        body = '<rect x="1" y="1" width="' + n(Math.max(W - 2, 1)) + '" height="' + n(Math.max(H - 2, 1)) + '" rx="' + n(Math.min(8, W / 2, H / 2)) + '" fill="' + t.color + '" fill-opacity=".1" stroke="' + t.color + '" stroke-width="2" stroke-dasharray="6 4"/>';
        break;
      default:
        body = '<rect width="' + n(W) + '" height="' + n(H) + '" rx="' + n(Math.min(5, W / 4, H / 4)) + '" fill="' + fill + '" stroke="' + dark + '"/>';
    }

    const zone = t.style === 'zone';
    const lines = [M.itemLabel(it, t)];
    if (seated) lines.push('(seats ' + t.seats + ')');
    const base = zone ? 12 : 9;
    const fits = (ls, fs) => ls.every((l) => textWidth(l, fs) <= availW) && ls.length * fs * 1.1 <= availH + 3;
    let ls = lines, fs = base;
    while (!fits(ls, fs) && fs > 6.5) fs -= 0.5;
    if (!fits(ls, fs) && ls.length > 1) {
      ls = [ls[0]];
      fs = base;
      while (!fits(ls, fs) && fs > 6.5) fs -= 0.5;
    }
    let label = '';
    if (fits(ls, fs)) {
      const light = !zone && luminance(fill) > 0.5;
      const attrs = zone
        ? 'fill="' + t.color + '" font-weight="600" letter-spacing=".5"'
        : light ? 'fill="' + C.ink + '" font-weight="600"' : 'fill="#fff" font-weight="600" filter="url(#vp-shadow)"';
      label = textBlock(ls, cx, cy, fs, attrs, upsideDown(it.rot), 1.1);
    }
    const desc = M.describeItem(it, t, opts.units);
    const a11y = opts.interactive ? ' tabindex="0" role="button" aria-label="' + esc(desc) + '"' : '';
    return '<g class="item' + (zone ? ' zone' : '') + '" data-item="' + esc(it.id) + '" transform="' + groupTransform(M.itemBox(it, t)) + '"' + a11y + '>' + body + label + '</g>';
  }

  function itemsSVG(venue, opts) {
    const types = M.typeMap(venue);
    let zones = '', rest = '';
    for (const it of venue.items) {
      const t = types.get(it.type);
      if (!t) continue;
      if (t.style === 'zone') zones += itemSVG(it, t, opts);
      else rest += itemSVG(it, t, opts);
    }
    return zones + rest;
  }

  // ---------- dimensions, caption and scale bar ----------
  function chainBreaks(venue, axis) {
    if (venue.dims) return venue.dims[axis] || [];
    const max = axis === 'x' ? venue.room.w : venue.room.h;
    const vals = venue.features.filter((f) => f.kind === 'column')
      .map((f) => (axis === 'x' ? f.x + f.w / 2 : f.y + f.h / 2))
      .filter((v) => v > 0.5 && v < max - 0.5).sort((a, b) => a - b);
    const out = [];
    for (const v of vals) if (!out.length || v - out[out.length - 1] > 0.75) out.push(v);
    return out.slice(0, 30);
  }

  function dimsSVG(venue) {
    const Wf = venue.room.w, Hf = venue.room.h, u = venue.units;
    const L = (x1, y1, x2, y2) => '<line x1="' + n(x1 * FT) + '" y1="' + n(y1 * FT) + '" x2="' + n(x2 * FT) + '" y2="' + n(y2 * FT) + '" stroke="' + C.blue + '" stroke-width=".8"/>';
    const T = (x, y, str, fs, rot) => '<text x="' + n(x) + '" y="' + n(y) + '" font-size="' + fs + '" fill="' + C.blue + '" font-weight="600" text-anchor="middle" dominant-baseline="middle" font-family="' + FONT + '"' +
      (rot ? ' transform="rotate(-90 ' + n(x) + ' ' + n(y) + ')"' : '') + '>' + esc(str) + '</text>';
    let s = '';
    const xs = chainBreaks(venue, 'x'), ys = chainBreaks(venue, 'y');
    const dy = -2.4;
    if (xs.length) {
      const xb = [0].concat(xs, [Wf]);
      s += L(0, dy - 2, Wf, dy - 2) + T((Wf / 2) * FT, (dy - 3.4) * FT, M.fmtDim(Wf, u), 9);
      xb.forEach((x) => { s += L(x, dy - 2, x, dy); });
      s += L(0, dy, Wf, dy);
      for (let i = 0; i < xb.length - 1; i++) s += T(((xb[i] + xb[i + 1]) / 2) * FT, (dy - 1) * FT, M.fmtDim(xb[i + 1] - xb[i], u), 8);
    } else {
      s += L(0, dy, Wf, dy) + L(0, dy - 0.8, 0, dy + 0.8) + L(Wf, dy - 0.8, Wf, dy + 0.8) + T((Wf / 2) * FT, (dy - 1.1) * FT, M.fmtDim(Wf, u), 9);
    }
    const lx = -3.2, lx2 = -1.4;
    if (ys.length) {
      const yb = [0].concat(ys, [Hf]);
      s += L(lx, 0, lx, Hf) + T(lx * FT - 4, (Hf / 2) * FT, M.fmtDim(Hf, u), 9, true);
      yb.forEach((y) => { s += L(lx2 - 1.4, y, lx2, y); });
      s += L(lx2, 0, lx2, Hf);
      for (let i = 0; i < yb.length - 1; i++) s += T(lx2 * FT - 3, ((yb[i] + yb[i + 1]) / 2) * FT, M.fmtDim(yb[i + 1] - yb[i], u), 8, true);
    } else {
      s += L(lx2, 0, lx2, Hf) + L(lx2 - 0.8, 0, lx2 + 0.8, 0) + L(lx2 - 0.8, Hf, lx2 + 0.8, Hf) + T(lx2 * FT - 9, (Hf / 2) * FT, M.fmtDim(Hf, u), 9, true);
    }
    return s;
  }

  function captionText(venue) {
    return venue.caption || venue.name.toUpperCase() + ' \u00b7 ' + M.fmtDim(venue.room.w, venue.units) + ' \u00d7 ' + M.fmtDim(venue.room.h, venue.units);
  }

  function captionSVG(venue) {
    const W = venue.room.w * FT, capY = (venue.room.h + 3.2) * FT;
    const caption = captionText(venue);
    let s = '<text x="' + n(W / 2) + '" y="' + n(capY) + '" font-size="9" fill="' + C.ink + '" font-weight="600" text-anchor="middle" dominant-baseline="middle" font-family="' + FONT + '">' + esc(caption) + '</text>';
    const metric = venue.units === 'm';
    const choices = metric ? [1, 2, 5, 10, 20, 50, 100] : [1, 2, 5, 10, 20, 50, 100, 200];
    let unit = choices[0];
    for (const c of choices) if ((metric ? c / M.M_PER_FT : c) <= venue.room.w / 4) unit = c;
    const len = (metric ? unit / M.M_PER_FT : unit) * FT;
    let bx = W - len, by = capY - 2;
    if (W / 2 + textWidth(caption, 9) / 2 + 14 > bx) { bx = W / 2 - len / 2; by = capY + 13; }
    const seg = len / 4;
    for (let i = 0; i < 4; i++) {
      s += '<rect x="' + n(bx + i * seg) + '" y="' + n(by) + '" width="' + n(seg) + '" height="4" fill="' + (i % 2 ? '#fff' : C.ink) + '" stroke="' + C.ink + '" stroke-width=".6"/>';
    }
    s += '<text x="' + n(bx + len / 2) + '" y="' + n(by + 11) + '" font-size="7.5" fill="' + C.ink + '" text-anchor="middle" dominant-baseline="middle" font-family="' + FONT + '">' + unit + (metric ? ' m' : ' ft') + '</text>';
    return s;
  }

  // ---------- overlays ----------
  function outlineAround(box, color, dashed) {
    const W = box.w * FT, H = box.h * FT;
    return '<g transform="' + groupTransform(box) + '"><rect x="-3" y="-3" width="' + n(W + 6) + '" height="' + n(H + 6) + '" rx="4" fill="none" stroke="' + color +
      '" stroke-width="2" vector-effect="non-scaling-stroke"' + (dashed ? ' stroke-dasharray="5 3"' : '') + '/></g>';
  }

  function overlaySVG(venue, o) {
    const types = M.typeMap(venue);
    let s = '';
    if (o.conflicts) {
      for (const it of venue.items) {
        if (!o.conflicts.has(it.id) || (o.sel && o.sel.id === it.id)) continue;
        const t = types.get(it.type);
        if (t) s += outlineAround(M.itemBox(it, t), C.conflict);
      }
    }
    if (o.sel) {
      if (o.sel.kind === 'item') {
        const it = venue.items.find((i) => i.id === o.sel.id);
        const t = it && types.get(it.type);
        if (t) s += outlineAround(M.itemBox(it, t), o.conflicts && o.conflicts.has(it.id) ? C.conflict : C.accent);
      } else {
        const f = venue.features.find((x) => x.id === o.sel.id);
        if (f) {
          s += outlineAround(f, C.accent, true);
          const z = o.zoom || 1, hs = 10 / z, hr = 18 / z, W = f.w * FT, H = f.h * FT;
          s += '<g transform="' + groupTransform(f) + '"><rect class="handle" data-handle="resize" x="' + n(W - hs / 2) + '" y="' + n(H - hs / 2) + '" width="' + n(hs) + '" height="' + n(hs) +
            '" fill="#fff" stroke="' + C.accent + '" stroke-width="2" vector-effect="non-scaling-stroke"/><circle class="handle" data-handle="resize" cx="' + n(W) + '" cy="' + n(H) + '" r="' + n(hr) + '" fill="#fff" fill-opacity="0"/></g>';
        }
      }
    }
    return s;
  }

  function measureSVG(m, units, zoom) {
    if (!m) return '';
    const z = zoom || 1;
    const x1 = m.x1 * FT, y1 = m.y1 * FT, x2 = m.x2 * FT, y2 = m.y2 * FT;
    const d = Math.hypot(m.x2 - m.x1, m.y2 - m.y1);
    const fs = 12 / z;
    return '<line x1="' + n(x1) + '" y1="' + n(y1) + '" x2="' + n(x2) + '" y2="' + n(y2) + '" stroke="' + C.accent + '" stroke-width="2" stroke-dasharray="' + n(6 / z) + ' ' + n(4 / z) + '" vector-effect="non-scaling-stroke"/>' +
      '<circle cx="' + n(x1) + '" cy="' + n(y1) + '" r="' + n(4 / z) + '" fill="' + C.accent + '"/>' +
      '<circle cx="' + n(x2) + '" cy="' + n(y2) + '" r="' + n(4 / z) + '" fill="' + C.accent + '"/>' +
      '<text x="' + n((x1 + x2) / 2) + '" y="' + n((y1 + y2) / 2 - 8 / z) + '" font-size="' + n(fs) + '" font-weight="700" fill="' + C.accent + '" text-anchor="middle" font-family="' + FONT +
      '" paint-order="stroke" stroke="#fff" stroke-width="' + n(3 / z) + '">' + esc(M.fmtLen(d, units)) + '</text>';
  }

  // ---------- whole scene ----------
  function viewBox(venue) {
    return { x: -PAD.l, y: -PAD.t, w: venue.room.w * FT + PAD.l + PAD.r, h: venue.room.h * FT + PAD.t + PAD.b };
  }

  function featuresSVG(venue, opts) {
    return venue.features.map((f) => featureSVG(f, opts)).join('');
  }

  function sceneSVG(venue, opts) {
    const room = opts.mode === 'room';
    return '<g class="layer-structure">' + structureSVG(venue, opts) + '</g>' +
      '<g class="layer-features' + (room ? ' active' : '') + '">' + featuresSVG(venue, { units: venue.units, interactive: room && opts.interactive }) + '</g>' +
      '<g class="layer-items' + (room ? ' muted' : ' active') + '">' + itemsSVG(venue, { units: venue.units, interactive: !room && opts.interactive }) + '</g>' +
      '<g class="layer-dims">' + (opts.dims ? dimsSVG(venue) : '') + captionSVG(venue) + '</g>';
  }

  // Self-contained SVG document for export; scale is output pixels per SVG unit.
  function standaloneSVG(venue, opts) {
    const vb = viewBox(venue);
    const scale = opts.scale || 2;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(vb.w * scale) + '" height="' + Math.round(vb.h * scale) + '" viewBox="' + vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h + '">' +
      defs() + '<rect x="' + vb.x + '" y="' + vb.y + '" width="' + vb.w + '" height="' + vb.h + '" fill="' + C.paper + '"/>' +
      sceneSVG(venue, { grid: opts.grid, dims: opts.dims, mode: 'plan', interactive: false }) + '</svg>';
  }

  VP.plan = { FT, PAD, C, esc, shade, viewBox, defs, groupTransform, sceneSVG, itemSVG, featureSVG, overlaySVG, measureSVG, standaloneSVG, gridStep, textWidth };
})(typeof window !== 'undefined' ? window : globalThis);
