/* ==========================================================================
   PZF Explorer — front-end controller.
   Calls POST /api/compute (Python), renders the 3D pattern-DAG and the live
   2D simulation. Depends on window.GraphEditor + UMD libs + fraction.js.
   ========================================================================== */
(function () {
  "use strict";

  const $ = s => document.querySelector(s);
  const API = "/api/compute";

  // ---------- colour helpers ----------
  function ramp(stops, t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 0; i < stops.length - 1; i++) {
      const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
      if (t <= t1) { const f = (t - t0) / ((t1 - t0) || 1);
        return [Math.round(c0[0] + (c1[0]-c0[0])*f), Math.round(c0[1] + (c1[1]-c0[1])*f), Math.round(c0[2] + (c1[2]-c0[2])*f)]; }
    }
    return stops[stops.length - 1][1];
  }
  const HEAT = [[0,[45,212,191]],[0.25,[163,230,53]],[0.5,[250,204,21]],[0.75,[251,146,60]],[1,[244,63,94]]];
  const PRESSURE = [[0,[51,65,85]],[0.42,[56,189,248]],[0.75,[250,204,21]],[1,[244,63,94]]];
  const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;

  // ---------- app state ----------
  let result = null;       // last compute result + derived adjacency/positions
  let colorMode = "structure";
  let pathHi = false;
  let expMin = 0, expMax = 1;
  let pathNodeSet = new Set(), pathEdgeSet = new Set();
  let Graph3D = null;

  function toast(msg, ok) {
    const t = $("#toast"); t.textContent = msg; t.className = "show" + (ok ? " ok" : "");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.className = "", 3600);
  }
  function showComputing(on) { $("#computing").classList.toggle("show", on); }

  // ====================================================================
  //  TABS
  // ====================================================================
  function setView(name) {
    $("#view-build").classList.toggle("active", name === "build");
    $("#view-explore").classList.toggle("active", name === "explore");
    $("#tab-build").classList.toggle("active", name === "build");
    $("#tab-explore").classList.toggle("active", name === "explore");
    $("#build-controls").style.display = name === "build" ? "" : "none";
    $("#explore-controls").style.display = name === "explore" ? "" : "none";
    if (name === "build") GraphEditor.redraw();
    if (name === "explore" && Graph3D) sizeGraph();
  }
  function sizeGraph() {
    const el = $("#graph");
    Graph3D.width(el.clientWidth).height(el.clientHeight);
  }

  // ====================================================================
  //  COMPUTE
  // ====================================================================
  async function compute() {
    const g = GraphEditor.export();
    if (g.n < 1) return toast("Add at least one vertex (Add tool, click the canvas).");
    if (g.seed.length < 1) return toast("Mark at least one start vertex with the Seed tool.");
    const mc = $("#mc-mode").checked;

    $("#compute").disabled = true; showComputing(true);
    try {
      const res = await fetch(API, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n: g.n, edges: g.edges, seed: g.seed, mode: mc ? "montecarlo" : "exact" })
      });
      const data = await res.json();
      if (!data.ok) { toast(data.error || "Computation failed."); return; }
      if (data.mode === "montecarlo") { onMonteCarlo(data); return; }
      onResult(data, g);
    } catch (err) {
      toast("Couldn't reach the compute API. Run `python dev_server.py` (or deploy to Vercel).");
    } finally {
      $("#compute").disabled = false; showComputing(false);
    }
  }

  function onMonteCarlo(data) {
    setView("explore");
    $("#explore-empty").style.display = "flex";
    $("#explore-empty").innerHTML =
      "Monte-Carlo estimate (" + data.stats.trials.toLocaleString() + " runs):<br><br>" +
      "<span style='font-size:30px;color:var(--amber);font-family:var(--mono)'>" +
      data.stats.eSeedEstimate + "</span><br>expected steps to all-blue";
    if (Graph3D) Graph3D.graphData({ nodes: [], links: [] });
    renderStats({ vertices: data.stats.vertices, edges: data.stats.edges,
      automorphisms: "—", patterns: "—", eSeed: "≈" + data.stats.eSeedEstimate, maxE: "—" });
    toast("Monte-Carlo estimate ready.", true);
  }

  function onResult(data, g) {
    // adjacency + positions for the live simulation
    const adj = Array.from({ length: g.n }, () => []);
    g.edges.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a); });

    result = {
      nodes: data.nodes, links: data.links, expected: data.expected,
      adj, positions: g.positions, n: g.n,
      path: data.mostLikelyPath || [], pathEdges: data.mostLikelyEdges || []
    };
    pathNodeSet = new Set(result.path);
    pathEdgeSet = new Set(result.pathEdges.map(e => e[0] + ">" + e[1]));

    const exps = data.nodes.map(n => n.exp).filter(v => typeof v === "number");
    expMin = Math.min(...exps); expMax = Math.max(...exps);
    if (!isFinite(expMin)) expMin = 0;
    if (!isFinite(expMax) || expMax === expMin) expMax = expMin + 1;

    $("#explore-empty").style.display = "none";
    renderStats(data.stats);
    renderLegend();
    setView("explore");
    drawDAG();
    toast("State-space computed.", true);
  }

  function renderStats(s) {
    $("#stats").innerHTML = [
      ["Vertices", s.vertices], ["Edges", s.edges],
      ["Automorphisms", s.automorphisms], ["Patterns", s.patterns],
      ["E[steps] from start", s.eSeed], ["Max E[steps]", s.maxE]
    ].map(([l, v]) => `<div class="stat"><div class="n">${v}</div><div class="l">${l}</div></div>`).join("");
  }

  // ====================================================================
  //  3D PATTERN DAG
  // ====================================================================
  function nodeColor(d) {
    if (pathHi && !pathNodeSet.has(d.id)) return "rgba(120,140,170,0.35)";
    if (colorMode === "steps") {
      if (d.type === "allblue") return "#34d399";
      return rgb(ramp(HEAT, (d.exp - expMin) / (expMax - expMin)));
    }
    return d.color;
  }
  function linkColor(l) {
    const key = (l.source.id || l.source) + ">" + (l.target.id || l.target);
    if (pathHi) return pathEdgeSet.has(key) ? "#a78bfa" : "rgba(120,140,170,0.12)";
    return "rgba(125,170,215,0.85)";
  }
  function linkWidth(l) {
    const key = (l.source.id || l.source) + ">" + (l.target.id || l.target);
    return (pathHi && pathEdgeSet.has(key)) ? 3 : 1.2;
  }

  function drawDAG() {
    if (!Graph3D) {
      Graph3D = ForceGraph3D()($("#graph"))
        .backgroundColor("rgba(0,0,0,0)")
        .nodeLabel("name")
        .nodeColor(nodeColor)
        .nodeOpacity(0.95)
        .nodeRelSize(4)
        .linkColor(linkColor)
        .linkOpacity(0.6)
        .linkWidth(linkWidth)
        .linkDirectionalParticles(2)
        .linkDirectionalParticleWidth(2)
        .linkDirectionalParticleSpeed(0.006)
        .linkDirectionalParticleColor(() => "#38bdf8")
        .dagMode("lr")
        .dagLevelDistance(320)
        .linkThreeObjectExtend(true)
        .linkThreeObject(link => {
          const s = new SpriteText(link.name);
          s.color = "rgba(186,230,253,0.92)";
          s.backgroundColor = "rgba(6,8,15,0.55)";
          s.padding = 1.2; s.borderRadius = 2; s.textHeight = 4.6;
          s.fontFace = "IBM Plex Mono, monospace";
          return s;
        })
        .linkPositionUpdate((sprite, { start, end }) => {
          const mid = Object.assign(...["x","y","z"].map(c => ({ [c]: start[c] + (end[c]-start[c]) / 2 })));
          Object.assign(sprite.position, mid);
        })
        .onNodeClick(node => openSim(node));
      Graph3D.d3Force("charge").strength(-2800).distanceMax(900);
      Graph3D.d3Force("link").distance(150).strength(0.18);
      Graph3D.d3VelocityDecay(0.28).d3AlphaDecay(0.0125).warmupTicks(80).cooldownTime(20000);
      Graph3D.onEngineStop(() => Graph3D.zoomToFit(900, 80));
      window.addEventListener("resize", () => { if (Graph3D) sizeGraph(); });
    }
    sizeGraph();
    Graph3D.graphData({ nodes: result.nodes, links: result.links });
  }

  function refreshDAGColors() {
    if (Graph3D) Graph3D.nodeColor(nodeColor).linkColor(linkColor).linkWidth(linkWidth);
  }

  function renderLegend() {
    const el = $("#legend");
    if (colorMode === "structure") {
      el.innerHTML =
        '<div class="legend-row"><span class="dot" style="color:#f59e0b;background:#f59e0b"></span> Start (seed)</div>' +
        '<div class="legend-row"><span class="dot" style="color:#38bdf8;background:#38bdf8"></span> State pattern</div>' +
        '<div class="legend-row"><span class="dot" style="color:#34d399;background:#34d399"></span> All blue (terminal)</div>' +
        '<div class="note">Every pattern flows to the terminal. Edge labels are exact one-step probabilities.</div>';
    } else {
      el.innerHTML =
        '<div class="scale-bar"></div>' +
        '<div class="scale-ends"><span>' + expMin.toFixed(2) + '</span><span>' + expMax.toFixed(2) + '</span></div>' +
        '<div class="note">Warmer = more expected steps. Hot clusters are the statistical bottlenecks.</div>';
    }
  }

  // ====================================================================
  //  LIVE SIMULATION (2D)
  // ====================================================================
  let simGraph = null, simNodes = [], simLinks = [], initState = [], step = 0, autoT = null;

  const F = (a, b) => new Fraction(a, b === undefined ? 1 : b);
  const fracStr = f => (f.s < 0 ? "-" : "") + (f.d === 1 ? "" + f.n : f.n + "/" + f.d);

  function breakdown(w) {
    const adj = result.adj;
    const blueNbrs = adj[w.id].filter(u => simNodes.find(n => n.id === u).isBlue);
    if (blueNbrs.length === 0) return { dormant: true, pFloat: 0, pStr: "0", terms: [] };
    let prod = F(1);
    const terms = blueNbrs.map(u => {
      const b = adj[u].filter(v => simNodes.find(n => n.id === v).isBlue).length;
      const deg = adj[u].length;
      const Pu = F(1 + b, deg);
      prod = prod.mul(F(1).sub(Pu));
      return { u, b, deg, Pu };
    });
    const p = F(1).sub(prod);
    return { dormant: false, prod, p, pFloat: p.valueOf(), pStr: fracStr(p), terms };
  }

  function openSim(node) {
    $("#overlay").classList.add("open");
    $("#m-title").innerHTML = "Live simulation &middot; <span>start [" + node.state.join(", ") + "]</span>";
    initState = node.state.slice();
    resetSim();
  }
  function closeSim() { if (autoT) toggleAuto(); $("#overlay").classList.remove("open"); }

  function fitPositions() {
    const pos = result.positions;
    if (!pos || pos.length !== result.n) return null;
    const xs = pos.map(p => p[0]), ys = pos.map(p => p[1]);
    const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
    const w = (maxx - minx) || 1, h = (maxy - miny) || 1, box = 320, s = Math.min(box / w, box / h);
    return i => [(pos[i][0] - (minx + maxx) / 2) * s, (pos[i][1] - (miny + maxy) / 2) * s];
  }

  function buildSimGeometry() {
    simNodes = []; simLinks = [];
    const norm = fitPositions();
    for (let i = 0; i < result.n; i++) {
      const node = { id: i, isBlue: initState.includes(i) };
      if (norm) { const [x, y] = norm(i); node.fx = x; node.fy = y; }
      simNodes.push(node);
    }
    const seen = new Set();
    result.adj.forEach((nbrs, u) => nbrs.forEach(v => {
      const key = u < v ? u + "-" + v : v + "-" + u;
      if (!seen.has(key)) { simLinks.push({ source: u, target: v }); seen.add(key); }
    }));
  }

  function renderSim() {
    if (!simGraph) {
      simGraph = ForceGraph()($("#sim"))
        .backgroundColor("rgba(0,0,0,0)")
        .linkColor(() => "rgba(148,163,184,0.4)")
        .linkWidth(2)
        .nodeCanvasObject((node, ctx) => {
          const r = 12, bd = node.isBlue ? null : breakdown(node);
          const p = node.isBlue ? 1 : bd.pFloat;
          ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
          if (node.isBlue) { ctx.shadowColor = "rgba(56,189,248,0.9)"; ctx.shadowBlur = 16; ctx.fillStyle = "#38bdf8"; }
          else { ctx.shadowBlur = 0; ctx.fillStyle = rgb(ramp(PRESSURE, p)); }
          ctx.fill(); ctx.shadowBlur = 0;
          ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(6,8,15,0.85)"; ctx.stroke();
          ctx.fillStyle = node.isBlue ? "#04121f" : "#e8eefb";
          ctx.font = "600 9px IBM Plex Mono, monospace";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(node.id, node.x, node.y);
          if (!node.isBlue && p > 0.001) {
            ctx.fillStyle = rgb(ramp(PRESSURE, p));
            ctx.font = "600 12px IBM Plex Mono, monospace";
            ctx.fillText(bd.pStr, node.x, node.y - 20);
          }
        });
      if (!fitPositions()) { simGraph.d3Force("charge").strength(-220); simGraph.d3Force("link").distance(70); }
      new ResizeObserver(() => { const el = $("#sim"); simGraph.width(el.clientWidth).height(el.clientHeight); simGraph.zoomToFit(200, 70); }).observe($("#sim"));
    }
    simGraph.graphData({ nodes: [...simNodes], links: [...simLinks] });

    $("#step-counter").textContent = step;
    let stateInt = 0; simNodes.forEach(n => { if (n.isBlue) stateInt |= (1 << n.id); });
    const E = result.expected;
    $("#exp-counter").textContent = E ? (E[stateInt] || 0).toFixed(2) : "—";
    renderBreakdownPanel();
  }

  function renderBreakdownPanel() {
    const list = $("#bd-list");
    const whites = simNodes.filter(n => !n.isBlue).sort((a, b) => a.id - b.id);
    if (whites.length === 0) { list.innerHTML = '<div class="bd-done">&#10003; every vertex forced.</div>'; return; }
    list.innerHTML = whites.map(w => {
      const bd = breakdown(w), c = ramp(PRESSURE, bd.pFloat);
      const lum = 0.299*c[0] + 0.587*c[1] + 0.114*c[2];
      const chip = 'style="background:' + rgb(c) + ';color:' + (lum > 140 ? "#04121f" : "#e8eefb") + '"';
      const head = '<div class="bd-top"><span class="bd-chip" ' + chip + '>' + w.id + '</span><span class="bd-name">vertex ' + w.id + '</span></div>';
      if (bd.dormant) return '<div class="bd-item">' + head + '<div class="bd-line bd-dormant">no blue neighbour yet &rarr; P = 0</div></div>';
      const src = bd.terms.map(t => '<div class="bd-line"><span class="src">via #' + t.u + ':</span> P = (1+' + t.b + ')/' + t.deg + ' = ' + fracStr(t.Pu) + '</div>').join("");
      const fac = bd.terms.map(t => "(1&minus;" + fracStr(t.Pu) + ")").join("");
      return '<div class="bd-item">' + head + src +
        '<div class="bd-final">P = 1 &minus; ' + fac + '<br>&nbsp;= 1 &minus; ' + fracStr(bd.prod) + ' = <b>' + bd.pStr + '</b></div></div>';
    }).join("");
  }

  function simStep() {
    const newly = []; let all = true;
    simNodes.forEach(w => { if (!w.isBlue) { all = false; if (Math.random() < breakdown(w).pFloat) newly.push(w.id); } });
    if (all) { if (autoT) toggleAuto(); flashDone(); return; }
    newly.forEach(id => { simNodes.find(n => n.id === id).isBlue = true; });
    step++; renderSim();
  }
  function flashDone() {
    const t = $("#m-title"), prev = t.innerHTML;
    t.innerHTML = '<span style="color:#34d399">&#10003; fully forced in ' + step + ' steps</span>';
    setTimeout(() => t.innerHTML = prev, 2200);
  }
  function toggleAuto() {
    const b = $("#sim-auto");
    if (autoT) { clearInterval(autoT); autoT = null; b.textContent = "Auto-play"; b.classList.remove("primary"); b.classList.add("ghost"); }
    else { autoT = setInterval(simStep, 850); b.textContent = "Stop"; b.classList.remove("ghost"); b.classList.add("primary"); }
  }
  function resetSim() {
    if (autoT) toggleAuto();
    step = 0; buildSimGeometry(); renderSim();
    setTimeout(() => { if (simGraph) simGraph.zoomToFit(300, 70); }, 60);
  }

  // ====================================================================
  //  SAVE / LOAD / SHARE
  // ====================================================================
  function save() {
    const blob = new Blob([JSON.stringify(GraphEditor.export(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "pzf-graph.json"; a.click();
    URL.revokeObjectURL(a.href);
  }
  function loadFile(ev) {
    const f = ev.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { GraphEditor.loadGraph(JSON.parse(r.result)); toast("Graph loaded.", true); } catch { toast("Invalid graph file."); } };
    r.readAsText(f); ev.target.value = "";
  }
  function encodeGraph(g) { return btoa(unescape(encodeURIComponent(JSON.stringify(g)))); }
  function decodeGraph(s) { return JSON.parse(decodeURIComponent(escape(atob(s)))); }
  function share() {
    const code = encodeGraph(GraphEditor.export());
    const url = location.origin + location.pathname + "#g=" + code;
    history.replaceState(null, "", "#g=" + code);
    navigator.clipboard?.writeText(url).then(
      () => toast("Shareable link copied to clipboard.", true),
      () => toast("Link is in the address bar.")
    );
  }
  function loadFromHash() {
    const m = location.hash.match(/#g=(.+)$/);
    if (!m) return false;
    try { GraphEditor.loadGraph(decodeGraph(m[1])); return true; } catch { return false; }
  }

  // ====================================================================
  //  WIRING
  // ====================================================================
  function init() {
    GraphEditor.init($("#editor"), updateVCount);

    document.querySelectorAll(".tool").forEach(btn =>
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tool").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        GraphEditor.setTool(btn.dataset.tool);
        $("#build-hint").innerHTML = HINTS[btn.dataset.tool];
      }));

    $("#tab-build").addEventListener("click", () => setView("build"));
    $("#tab-explore").addEventListener("click", () => { if (!result) return toast("Compute a graph first."); setView("explore"); });

    $("#preset").addEventListener("change", e => { $("#preset-b").style.display = e.target.value === "grid" ? "" : "none"; });
    $("#preset-go").addEventListener("click", () => {
      const name = $("#preset").value; if (!name) return;
      GraphEditor.loadPreset(name, +$("#preset-a").value || 3, +$("#preset-b").value || 3);
    });

    $("#clear").addEventListener("click", () => GraphEditor.clear());
    $("#save").addEventListener("click", save);
    $("#load").addEventListener("click", () => $("#file").click());
    $("#file").addEventListener("change", loadFile);
    $("#share").addEventListener("click", share);
    $("#compute").addEventListener("click", compute);

    $("#mode-struct").addEventListener("click", () => { colorMode = "structure"; $("#mode-struct").classList.add("active"); $("#mode-steps").classList.remove("active"); renderLegend(); refreshDAGColors(); });
    $("#mode-steps").addEventListener("click", () => { colorMode = "steps"; $("#mode-steps").classList.add("active"); $("#mode-struct").classList.remove("active"); renderLegend(); refreshDAGColors(); });
    $("#path-toggle").addEventListener("change", e => { pathHi = e.target.checked; refreshDAGColors(); });

    $("#sim-step").addEventListener("click", simStep);
    $("#sim-auto").addEventListener("click", toggleAuto);
    $("#sim-reset").addEventListener("click", resetSim);
    $("#close").addEventListener("click", closeSim);
    window.addEventListener("keydown", e => { if (e.key === "Escape") closeSim(); });

    $("#build-hint").innerHTML = HINTS.add;

    // initial graph: from a shared link, else a default prism
    if (!loadFromHash()) GraphEditor.loadPreset("prism", 3);
    updateVCount(GraphEditor.summary());
  }

  const HINTS = {
    add: "<b>Add</b>: click empty space to drop a vertex",
    edge: "<b>Edge</b>: click two vertices to connect or disconnect them",
    move: "<b>Move</b>: drag a vertex to reposition it",
    seed: "<b>Seed</b>: click a vertex to toggle it blue (the starting set)",
    erase: "<b>Erase</b>: click a vertex or an edge to delete it"
  };

  function updateVCount(s) {
    $("#vcount").textContent = s.n + " vertices · " + s.seed + " seed";
  }

  document.addEventListener("DOMContentLoaded", init);
})();
