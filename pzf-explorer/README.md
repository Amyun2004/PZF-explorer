# PZF Explorer

An interactive explorer for **Probabilistic Zero Forcing (PZF)** on arbitrary graphs.
Build any graph in the browser, mark the starting (blue) vertices, and the app computes:

- the **exact expected number of forcing steps** to turn the whole graph blue (dynamic programming over all states),
- a **symmetry-reduced state-space map** — one node per canonical configuration, found from the graph's automorphism group, with every state flowing to the single *all-blue* terminal,
- a **live, step-by-step simulation** with exact per-vertex forcing probabilities shown as fractions and derived in full.

The front end is a static page; the heavy math runs in a **Python** backend (a Vercel serverless function locally mirrored by a tiny dev server).

> Replace this line with a screenshot or a link to your live deployment once it's up.

---

## What is Probabilistic Zero Forcing?

Start with some vertices coloured blue and the rest white. Each step, every blue vertex
independently tries to "force" — a blue vertex `u` succeeds with probability

```
P(u) = (1 + number of blue neighbours of u) / degree(u)
```

and, on success, turns one of its white neighbours blue. A white vertex `w` therefore turns
blue this step with probability

```
P(w) = 1 - ∏ over blue neighbours u of w of ( 1 - P(u) )
```

On a connected graph the process reaches all-blue with probability 1; the question this tool
answers is **how many steps that takes on average**, and **where the process tends to stall**.

---

## Features

- **Graph editor** — add / move / delete vertices, toggle edges, and mark seed vertices on a canvas.
- **Presets** — path, cycle, grid, prism, complete, star, wheel.
- **Exact engine** — expected steps for *every* state via dynamic programming.
- **Automatic symmetry reduction** — the automorphism group is computed from the graph itself, so symmetric states merge (works for any topology, not just nice ones).
- **State-space DAG** — interactive 3D graph; colour by structure or by an *expected-steps heatmap* to spot bottlenecks; optional **most-likely-path** highlight.
- **Live simulation** — click any state to watch forcing spread, with exact-fraction probability breakdowns.
- **Monte-Carlo mode** — estimate expected steps for graphs too large for the exact engine.
- **Save / load / share** — export a graph as JSON or copy a shareable URL.

---

## Run locally

No build step and no third-party Python packages (standard library only).

```bash
git clone https://github.com/YOUR_USERNAME/pzf-explorer.git
cd pzf-explorer
python dev_server.py
# open http://localhost:8000
```

`dev_server.py` serves the static files and answers `POST /api/compute` with the same engine
the Vercel function uses, so local behaviour matches production.

---

## Deploy to Vercel

This repo is a static site plus a Python serverless function in `api/`, which Vercel supports
out of the box.

**Option A — dashboard**
1. Push the repo to GitHub.
2. On [vercel.com](https://vercel.com), *Add New → Project* and import the repo.
3. Framework preset: **Other** (no build command, no output directory). Deploy.

**Option B — CLI**
```bash
npm i -g vercel
vercel          # preview deploy
vercel --prod   # production deploy
```

The page is served at `/` and the API at `/api/compute`.

> **Note on the exact engine when hosted:** serverless functions have a time limit
> (about 10 s on Vercel's free tier). The exact DP is `Θ(3ⱽ)`, so hosted exact runs are
> comfortable up to roughly **14 vertices**; beyond that use **Monte-Carlo mode**, or run
> the exact engine locally where there's no timeout.

---

## Project structure

```
pzf-explorer/
├── api/
│   ├── compute.py     # Vercel serverless endpoint (POST /api/compute)
│   └── _engine.py     # PZF math: DP, automorphisms, pattern DAG, Monte-Carlo
├── css/styles.css
├── js/
│   ├── editor.js      # canvas graph editor
│   └── app.js         # API calls + 3D DAG + live simulation
├── index.html
├── dev_server.py      # local server (mirrors the Vercel setup)
├── vercel.json
├── requirements.txt   # empty — stdlib only
├── LICENSE
└── README.md
```

The engine in `api/_engine.py` is plain importable Python; you can also use it directly:

```python
from api._engine import preset, compute_graph
n, edges, _ = preset("prism", 3)
print(compute_graph(n, edges, seed=[0])["stats"])
# {'vertices': 6, 'edges': 9, 'automorphisms': 12, 'patterns': 9, 'eSeed': 3.1213, ...}
```

---

## How it scales (and where it stops)

The exact engine evaluates every one of the `2ⱽ` states, so it is `Θ(3ⱽ)` time and `Θ(2ⱽ)`
memory. Measured runtimes (single core): `V=12 ≈ 0.5 s`, `V=14 ≈ 5 s`, `V=16 ≈ 50 s`. Each
extra vertex multiplies time by ~3. Practical exact ceiling is ~16–18 vertices locally.
Symmetry reduction shrinks the *picture*, not the DP. For larger graphs, Monte-Carlo gives an
estimate in linear-per-step time.

Note: the graph must be **connected** and the seed set must be able to reach every vertex,
otherwise all-blue is unreachable — the app checks this and tells you.

---

## API

`POST /api/compute`

```jsonc
// request
{ "n": 6, "edges": [[0,1],[1,2],[2,0],[3,4],[4,5],[5,3],[0,3],[1,4],[2,5]], "seed": [0],
  "mode": "exact" }            // or "montecarlo"

// response (exact)
{ "ok": true, "nodes": [...], "links": [...], "expected": [...],
  "mostLikelyPath": [...], "stats": { "vertices": 6, "automorphisms": 12, "patterns": 9,
  "eSeed": 3.1213, "maxE": 3.1213 } }
```

---

## License

MIT — see [LICENSE](LICENSE).
