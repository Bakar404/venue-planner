/* Venue Planner: geometry helpers. Pure functions, no DOM access.
   All coordinates are in feet, with the origin at the top-left of the room. */
(function (root) {
  'use strict';
  const VP = (root.VP = root.VP || {});

  const EPS = 1e-6;
  const ROUND_SEGMENTS = 24;

  // Outline of a shape inside its w x h box, relative to the box's top-left corner.
  // Round shapes become a 24-sided polygon; triangles keep their right angle at `corner`.
  function localOutline(shape, w, h, corner) {
    if (shape === 'round') {
      const pts = [];
      for (let i = 0; i < ROUND_SEGMENTS; i++) {
        const a = (i / ROUND_SEGMENTS) * Math.PI * 2;
        pts.push([w / 2 + (w / 2) * Math.cos(a), h / 2 + (h / 2) * Math.sin(a)]);
      }
      return pts;
    }
    if (shape === 'tri') {
      switch (corner) {
        case 'tr': return [[0, 0], [w, 0], [w, h]];
        case 'br': return [[w, 0], [w, h], [0, h]];
        case 'bl': return [[0, 0], [w, h], [0, h]];
        default: return [[0, 0], [w, 0], [0, h]];
      }
    }
    return [[0, 0], [w, 0], [w, h], [0, h]];
  }

  // Convert a point in box-local coordinates (relative to the unrotated top-left corner)
  // to room coordinates. Boxes rotate about their centre, clockwise in degrees.
  function toWorld(box, lx, ly) {
    const rad = ((box.rot || 0) * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const dx = lx - box.w / 2, dy = ly - box.h / 2;
    return [box.x + box.w / 2 + dx * cos - dy * sin, box.y + box.h / 2 + dx * sin + dy * cos];
  }

  function toLocal(box, wx, wy) {
    const rad = (-(box.rot || 0) * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const dx = wx - (box.x + box.w / 2), dy = wy - (box.y + box.h / 2);
    return [box.w / 2 + dx * cos - dy * sin, box.h / 2 + dx * sin + dy * cos];
  }

  function boxPolygon(box, shape, corner) {
    return localOutline(shape, box.w, box.h, corner).map(([lx, ly]) => toWorld(box, lx, ly));
  }

  function bounds(poly) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY };
  }

  // Ray casting; works for concave polygons too.
  function pointInPolygon(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // Separating-axis test for two convex polygons. Shapes that only touch do not overlap.
  function polygonsOverlap(a, b) {
    for (const poly of [a, b]) {
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        const ex = q[0] - p[0], ey = q[1] - p[1], len = Math.hypot(ex, ey);
        if (len < 1e-12) continue;
        const ax = -ey / len, ay = ex / len;
        let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
        for (const [x, y] of a) {
          const d = x * ax + y * ay;
          if (d < minA) minA = d;
          if (d > maxA) maxA = d;
        }
        for (const [x, y] of b) {
          const d = x * ax + y * ay;
          if (d < minB) minB = d;
          if (d > maxB) maxB = d;
        }
        if (maxA <= minB + EPS || maxB <= minA + EPS) return false;
      }
    }
    return true;
  }

  function signedArea(poly) {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
      s += x1 * y2 - x2 * y1;
    }
    return s / 2;
  }

  // Move every edge of a simple polygon inward by d and return the new corners.
  // Used to draw the inner line of the walls.
  function insetPolygon(poly, d) {
    const n = poly.length;
    const sign = signedArea(poly) >= 0 ? 1 : -1;
    const lines = poly.map((p, i) => {
      const q = poly[(i + 1) % n];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const dx = (q[0] - p[0]) / len, dy = (q[1] - p[1]) / len;
      return { px: p[0] - dy * sign * d, py: p[1] + dx * sign * d, dx, dy };
    });
    return poly.map((p, i) => {
      const a = lines[(i - 1 + n) % n], b = lines[i];
      const den = a.dx * b.dy - a.dy * b.dx;
      if (Math.abs(den) < 1e-9) return [b.px, b.py];
      const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / den;
      return [a.px + a.dx * t, a.py + a.dy * t];
    });
  }

  function centroid(poly) {
    let x = 0, y = 0;
    for (const p of poly) { x += p[0]; y += p[1]; }
    return [x / poly.length, y / poly.length];
  }

  VP.geometry = {
    EPS, localOutline, toWorld, toLocal, boxPolygon, bounds,
    pointInPolygon, polygonsOverlap, signedArea, insetPolygon, centroid,
  };
})(typeof window !== 'undefined' ? window : globalThis);
