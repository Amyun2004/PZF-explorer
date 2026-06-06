/* ==========================================================================
   GraphEditor — a small canvas graph editor.
   Vertices are stored by array index (== their displayed label).
   Exposes window.GraphEditor.
   ========================================================================== */
(function () {
  "use strict";

  const R = 13;        // vertex draw radius (css px)
  const HIT = 18;      // pointer hit radius
  const COL = {
    vertex: "#cbd5e1", vertexEdge: "#0b1220",
    seed: "#38bdf8", seedGlow: "rgba(56,189,248,0.9)",
    edge: "rgba(148,163,184,0.55)", sel: "#f59e0b", rubber: "rgba(245,158,11,0.6)",
    label: "#0b1220", labelSeed: "#04121f"
  };

  let cv, ctx, cssW = 0, cssH = 0, dpr = 1;
  let vertices = [];      // {x,y,seed}
  let edges = [];         // [i,j] with i<j
  let tool = "add";
  let selected = -1;      // for edge tool
  let dragging = -1, dragMoved = false;
  let pointer = { x: 0, y: 0, inside: false };
  let onChange = () => {};

  // ---------- geometry helpers ----------
  function nearestVertex(x, y) {
    let best = -1, bd = HIT * HIT;
    for (let i = 0; i < vertices.length; i++) {
      const dx = vertices[i].x - x, dy = vertices[i].y - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function nearestEdge(x, y) {
    let best = -1, bd = 8 * 8;
    for (let k = 0; k < edges.length; k++) {
      const a = vertices[edges[k][0]], b = vertices[edges[k][1]];
      const d = ptSegDist2(x, y, a.x, a.y, b.x, b.y);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }
  function ptSegDist2(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return (px - cx) ** 2 + (py - cy) ** 2;
  }

  // ---------- mutations ----------
  function addVertex(x, y) {
    if (nearestVertex(x, y) !== -1) return;
    vertices.push({ x, y, seed: vertices.length === 0 });  // first vertex is seed by default
    changed();
  }
  function deleteVertex(i) {
    edges = edges.filter(e => e[0] !== i && e[1] !== i)
                 .map(e => [e[0] > i ? e[0] - 1 : e[0], e[1] > i ? e[1] - 1 : e[1]]);
    vertices.splice(i, 1);
    changed();
  }
  function toggleEdge(a, b) {
    if (a === b) return;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const k = edges.findIndex(e => e[0] === lo && e[1] === hi);
    if (k >= 0) edges.splice(k, 1); else edges.push([lo, hi]);
    changed();
  }
  function toggleSeed(i) { vertices[i].seed = !vertices[i].seed; changed(); }
  function clearAll() { vertices = []; edges = []; selected = -1; changed(); }

  function changed() { draw(); onChange(summary()); }
  function summary() {
    return { n: vertices.length, seed: vertices.filter(v => v.seed).length };
  }

  // ---------- import / export ----------
  function fitInto(rawPositions) {
    // scale arbitrary coords to fit the canvas with a margin, centered
    const xs = rawPositions.map(p => p[0]), ys = rawPositions.map(p => p[1]);
    const minx = Math.min(...xs), maxx = Math.max(...xs);
    const miny = Math.min(...ys), maxy = Math.max(...ys);
    const w = (maxx - minx) || 1, h = (maxy - miny) || 1;
    const m = 70;
    const s = Math.min((cssW - 2 * m) / w, (cssH - 2 * m) / h);
    const ox = (cssW - s * w) / 2 - s * minx, oy = (cssH - s * h) / 2 - s * miny;
    return rawPositions.map(p => ({ x: s * p[0] + ox, y: s * p[1] + oy }));
  }

  function loadGraph(g) {
    const pos = (g.positions && g.positions.length === g.n)
      ? fitInto(g.positions)
      : circleLayout(g.n);
    vertices = pos.map((p, i) => ({ x: p.x, y: p.y, seed: (g.seed || []).includes(i) }));
    edges = (g.edges || []).map(e => [Math.min(e[0], e[1]), Math.max(e[0], e[1])]);
    selected = -1;
    changed();
  }
  function circleLayout(n) {
    const cx = cssW / 2, cy = cssH / 2, r = Math.min(cssW, cssH) * 0.35;
    return Array.from({ length: n }, (_, i) => {
      const a = 2 * Math.PI * i / Math.max(n, 1) - Math.PI / 2;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });
  }

  function exportGraph() {
    return {
      n: vertices.length,
      edges: edges.map(e => [e[0], e[1]]),
      seed: vertices.map((v, i) => v.seed ? i : -1).filter(i => i >= 0),
      positions: vertices.map(v => [Math.round(v.x), Math.round(v.y)])
    };
  }

  // ---------- presets (normalized coords; fitInto rescales) ----------
  const PRESETS = {
    path: a => ({ n: a, edges: range(a - 1).map(i => [i, i + 1]),
                  positions: range(a).map(i => [i, 0]) }),
    cycle: a => ({ n: a, edges: range(a).map(i => [i, (i + 1) % a]),
                   positions: range(a).map(i => [Math.cos(2*Math.PI*i/a), Math.sin(2*Math.PI*i/a)]) }),
    complete: a => ({ n: a, edges: pairs(a),
                      positions: range(a).map(i => [Math.cos(2*Math.PI*i/a), Math.sin(2*Math.PI*i/a)]) }),
    star: a => ({ n: a, edges: range(a - 1).map(i => [0, i + 1]),
                  positions: [[0, 0]].concat(range(a - 1).map(i => [Math.cos(2*Math.PI*i/(a-1)), Math.sin(2*Math.PI*i/(a-1))])) }),
    wheel: a => {  // hub 0 + cycle of a-1 rim
      const rim = a - 1;
      const e = range(rim).map(i => [i + 1, (i + 1) % rim + 1]).concat(range(rim).map(i => [0, i + 1]));
      const pos = [[0, 0]].concat(range(rim).map(i => [Math.cos(2*Math.PI*i/rim), Math.sin(2*Math.PI*i/rim)]));
      return { n: a, edges: e, positions: pos };
    },
    grid: (a, b) => {
      const rows = a, cols = b, e = [], pos = [];
      const idx = (r, c) => r * cols + c;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        pos[idx(r, c)] = [c, -r];
        if (c + 1 < cols) e.push([idx(r, c), idx(r, c + 1)]);
        if (r + 1 < rows) e.push([idx(r, c), idx(r + 1, c)]);
      }
      return { n: rows * cols, edges: e, positions: pos };
    },
    prism: a => {
      const e = [], pos = [];
      for (let i = 0; i < a; i++) {
        e.push([i, (i + 1) % a], [a + i, a + (i + 1) % a], [i, a + i]);
        const ang = 2 * Math.PI * i / a - Math.PI / 2;
        pos[i] = [1.7 * Math.cos(ang), 1.7 * Math.sin(ang)];
        pos[a + i] = [0.75 * Math.cos(ang), 0.75 * Math.sin(ang)];
      }
      return { n: 2 * a, edges: e, positions: pos };
    }
  };
  function range(n) { return Array.from({ length: Math.max(0, n) }, (_, i) => i); }
  function pairs(n) { const r = []; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) r.push([i, j]); return r; }

  function loadPreset(name, a, b) {
    const f = PRESETS[name];
    if (!f) return;
    loadGraph(f(a, b));
  }

  // ---------- rendering ----------
  function resize() {
    const rect = cv.getBoundingClientRect();
    cssW = rect.width; cssH = rect.height;
    dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, cssW, cssH);

    // edges
    ctx.lineWidth = 2; ctx.strokeStyle = COL.edge;
    edges.forEach(e => {
      const a = vertices[e[0]], b = vertices[e[1]];
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    });

    // rubber band for edge tool
    if (tool === "edge" && selected >= 0 && pointer.inside) {
      const a = vertices[selected];
      ctx.save(); ctx.setLineDash([5, 5]); ctx.strokeStyle = COL.rubber; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(pointer.x, pointer.y); ctx.stroke(); ctx.restore();
    }

    // vertices
    vertices.forEach((v, i) => {
      ctx.beginPath(); ctx.arc(v.x, v.y, R, 0, 2 * Math.PI);
      if (v.seed) { ctx.shadowColor = COL.seedGlow; ctx.shadowBlur = 16; ctx.fillStyle = COL.seed; }
      else { ctx.shadowBlur = 0; ctx.fillStyle = COL.vertex; }
      ctx.fill(); ctx.shadowBlur = 0;
      ctx.lineWidth = i === selected ? 3 : 1.5;
      ctx.strokeStyle = i === selected ? COL.sel : COL.vertexEdge;
      ctx.stroke();
      ctx.fillStyle = v.seed ? COL.labelSeed : COL.label;
      ctx.font = "600 11px IBM Plex Mono, monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(i), v.x, v.y);
    });
  }

  // ---------- pointer handling ----------
  function pos(ev) {
    const r = cv.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }
  function onDown(ev) {
    ev.preventDefault();
    const p = pos(ev); const vi = nearestVertex(p.x, p.y);
    if (tool === "add") { if (vi === -1) addVertex(p.x, p.y); }
    else if (tool === "seed") { if (vi !== -1) toggleSeed(vi); }
    else if (tool === "erase") {
      if (vi !== -1) deleteVertex(vi);
      else { const ei = nearestEdge(p.x, p.y); if (ei !== -1) { edges.splice(ei, 1); changed(); } }
    }
    else if (tool === "edge") {
      if (vi !== -1) {
        if (selected === -1) selected = vi;
        else { toggleEdge(selected, vi); selected = -1; }
      } else { selected = -1; draw(); }
    }
    else if (tool === "move") {
      if (vi !== -1) { dragging = vi; dragMoved = false; }
    }
  }
  function onMove(ev) {
    const p = pos(ev); pointer = { x: p.x, y: p.y, inside: true };
    if (dragging >= 0) { vertices[dragging].x = p.x; vertices[dragging].y = p.y; dragMoved = true; draw(); }
    else if (tool === "edge" && selected >= 0) draw();
  }
  function onUp() {
    if (dragging >= 0) { dragging = -1; if (dragMoved) onChange(summary()); }
  }
  function onLeave() { pointer.inside = false; if (tool === "edge") draw(); }

  // ---------- public API ----------
  window.GraphEditor = {
    init(canvas, changeCb) {
      cv = canvas; ctx = cv.getContext("2d");
      onChange = changeCb || (() => {});
      cv.addEventListener("pointerdown", onDown);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      cv.addEventListener("pointerleave", onLeave);
      new ResizeObserver(resize).observe(cv);
      resize();
    },
    setTool(t) { tool = t; selected = -1; draw(); },
    clear: clearAll,
    loadPreset,
    loadGraph,
    export: exportGraph,
    summary,
    redraw: draw
  };
})();
