"""
Probabilistic Zero Forcing (PZF) engine — pure computation, no web/DOM.

Used by:
  * api/compute.py   (Vercel serverless endpoint)
  * dev_server.py    (local development server)
  * directly as a CLI / library

Public entry point:  compute_graph(n, edges, seed)  ->  dict (JSON-serializable)
"""

from fractions import Fraction
from itertools import product
from collections import deque, Counter
import math


# ----------------------------------------------------------------------------
#  graph helpers + a few presets (the frontend has its own copies for instant
#  editing; these exist for CLI use and tests)
# ----------------------------------------------------------------------------

def adjacency(n, edges):
    g = {i: set() for i in range(n)}
    for a, b in edges:
        if a == b:
            continue
        g[a].add(b)
        g[b].add(a)
    return {k: sorted(v) for k, v in g.items()}


def preset(name, a=4, b=3):
    name = name.lower()
    if name == "path":
        e = [(i, i + 1) for i in range(a - 1)]
        p = {i: [i, 0] for i in range(a)}
        return a, e, p
    if name == "cycle":
        e = [(i, (i + 1) % a) for i in range(a)]
        p = {i: [math.cos(2*math.pi*i/a), math.sin(2*math.pi*i/a)] for i in range(a)}
        return a, e, p
    if name == "grid":
        rows, cols, e, p = a, b, [], {}
        idx = lambda r, c: r*cols + c
        for r in range(rows):
            for c in range(cols):
                p[idx(r, c)] = [c, -r]
                if c+1 < cols: e.append((idx(r, c), idx(r, c+1)))
                if r+1 < rows: e.append((idx(r, c), idx(r+1, c)))
        return rows*cols, e, p
    if name == "prism":
        e, p = [], {}
        for i in range(a):
            e += [(i, (i+1) % a), (a+i, a+(i+1) % a), (i, a+i)]
            ang = 2*math.pi*i/a - math.pi/2
            p[i] = [1.7*math.cos(ang), 1.7*math.sin(ang)]
            p[a+i] = [0.75*math.cos(ang), 0.75*math.sin(ang)]
        return 2*a, e, p
    if name == "complete":
        e = [(i, j) for i in range(a) for j in range(i+1, a)]
        p = {i: [math.cos(2*math.pi*i/a), math.sin(2*math.pi*i/a)] for i in range(a)}
        return a, e, p
    if name == "star":
        e = [(0, i) for i in range(1, a)]
        p = {0: [0, 0]}
        for i in range(1, a):
            ang = 2*math.pi*(i-1)/(a-1)
            p[i] = [math.cos(ang), math.sin(ang)]
        return a, e, p
    raise ValueError(f"unknown preset: {name}")


def is_connected_from(g, seed):
    """Can the seed set reach every vertex along graph edges? (PZF needs this.)"""
    V = len(g)
    if not seed:
        return False
    seen, q = set(seed), deque(seed)
    while q:
        u = q.popleft()
        for v in g[u]:
            if v not in seen:
                seen.add(v); q.append(v)
    return len(seen) == V


# ----------------------------------------------------------------------------
#  exact expected steps to all-blue, for every state  (Θ(3^V) time, Θ(2^V) mem)
# ----------------------------------------------------------------------------

def expected_steps(g):
    V = len(g)
    target = (1 << V) - 1
    E = {target: 0.0}
    states = sorted(range(1, 1 << V), key=lambda x: bin(x).count('1'), reverse=True)
    for state in states:
        if state == target:
            continue
        S = [i for i in range(V) if (state >> i) & 1]
        W = [i for i in range(V) if not (state >> i) & 1]
        P_u = {u: (1 + sum(1 for v in g[u] if (state >> v) & 1)) / len(g[u]) for u in S}
        p_w = {}
        for w in W:
            stay = 1.0
            for u in g[w]:
                if (state >> u) & 1:
                    stay *= (1.0 - P_u[u])
            p_w[w] = 1.0 - stay
        future, stay_same = 0.0, 1.0
        for outcome in product([True, False], repeat=len(W)):
            prob, nxt = 1.0, state
            for i, flips in enumerate(outcome):
                w = W[i]
                if flips:
                    prob *= p_w[w]; nxt |= (1 << w)
                else:
                    prob *= (1.0 - p_w[w])
            if nxt == state:
                stay_same = prob
            else:
                future += prob * E.get(nxt, 0.0)
        E[state] = (1.0 + future) / (1.0 - stay_same) if stay_same < 1.0 else 0.0
    return E


# ----------------------------------------------------------------------------
#  automorphism group (general symmetry) + canonical form
# ----------------------------------------------------------------------------

def automorphisms(g, cap=4096):
    V = len(g)
    adjset = {v: set(g[v]) for v in range(V)}
    deg = {v: len(adjset[v]) for v in range(V)}
    inv = {v: (deg[v], tuple(sorted(deg[u] for u in adjset[v]))) for v in range(V)}
    cnt = Counter(inv.values())
    order = sorted(range(V), key=lambda v: (cnt[inv[v]], -deg[v], v))
    cand = {v: [w for w in range(V) if inv[w] == inv[v]] for v in range(V)}
    results, perm, used = [], [None]*V, [False]*V

    def bt(i):
        if len(results) >= cap:
            return
        if i == V:
            results.append(tuple(perm)); return
        v = order[i]
        for w in cand[v]:
            if used[w]:
                continue
            ok = True
            for j in range(i):
                u = order[j]
                if (u in adjset[v]) != (perm[u] in adjset[w]):
                    ok = False; break
            if ok:
                perm[v] = w; used[w] = True
                bt(i + 1)
                used[w] = False; perm[v] = None

    bt(0)
    return results or [tuple(range(V))]


def canonical(blue_set, autos):
    best = None
    for perm in autos:
        m = tuple(sorted(perm[v] for v in blue_set))
        if best is None or m < best:
            best = m
    return best


# ----------------------------------------------------------------------------
#  pattern-space DAG  (one node per pattern; everything flows to ALL-BLUE)
# ----------------------------------------------------------------------------

COL_START, COL_PATTERN, COL_ALLBLUE = "#f59e0b", "#38bdf8", "#34d399"


def build_pattern_dag(g, autos, seed, E):
    V = len(g)
    nodes, links = [], []
    pat_id, counter = {}, [0]

    def get_or_create(blue_set):
        c = canonical(blue_set, autos)
        if c in pat_id:
            return pat_id[c], False
        nid = str(counter[0]); counter[0] += 1
        pat_id[c] = nid
        arr = sorted(blue_set)
        exp = E.get(sum(1 << v for v in blue_set), 0.0)
        if len(arr) == V:
            nodes.append({"id": nid, "type": "allblue", "color": COL_ALLBLUE, "val": 15,
                          "state": arr, "exp": 0.0,
                          "name": "<b>ALL BLUE</b> &middot; terminal<br>every vertex forced &middot; E[steps] = 0.00"})
        else:
            pn = sum(1 for x in nodes if x["type"] in ("pattern", "start")) + 1
            nodes.append({"id": nid, "type": "pattern", "color": COL_PATTERN, "val": 9,
                          "state": arr, "exp": exp,
                          "name": f"<b>P{pn}</b> &middot; State {arr}<br>Expected steps: {exp:.2f}"})
        return nid, True

    start_id, _ = get_or_create(set(seed))
    for nd in nodes:
        if nd["id"] == start_id:
            nd["type"], nd["color"], nd["val"] = "start", COL_START, 13
            nd["name"] = nd["name"].replace("</b>", "</b> &middot; START", 1)
            break

    queue, expanded = deque([(start_id, frozenset(seed))]), set()
    while queue:
        src, blue = queue.popleft()
        if src in expanded:
            continue
        expanded.add(src)
        if len(blue) == V:
            continue
        white = sorted(v for v in range(V) if v not in blue)
        P_u = {u: Fraction(1 + sum(1 for v in g[u] if v in blue), len(g[u])) for u in blue}
        p_w = {}
        for w in white:
            stay = Fraction(1)
            for u in g[w]:
                if u in blue:
                    stay *= (Fraction(1) - P_u[u])
            p_w[w] = Fraction(1) - stay
        agg = {}
        for outcome in product([True, False], repeat=len(white)):
            prob, nxt = Fraction(1), set(blue)
            for i, flips in enumerate(outcome):
                w = white[i]
                if flips:
                    prob *= p_w[w]; nxt.add(w)
                else:
                    prob *= (Fraction(1) - p_w[w])
            if prob == 0 or len(nxt) == len(blue):
                continue
            c = canonical(nxt, autos)
            if c not in agg:
                agg[c] = [Fraction(0), frozenset(nxt)]
            agg[c][0] += prob
        for c, (psum, rep) in agg.items():
            dst, _ = get_or_create(rep)
            links.append({"source": src, "target": dst, "name": str(psum), "p": float(psum)})
            if dst not in expanded:
                queue.append((dst, rep))

    return nodes, links, start_id


def most_likely_path(nodes, links, start_id):
    """Greedy highest-probability single trajectory start -> ... -> all-blue."""
    out = {}
    for l in links:
        out.setdefault(l["source"], []).append(l)
    sink = next((n["id"] for n in nodes if n["type"] == "allblue"), None)
    path, edges, cur, guard = [start_id], [], start_id, 0
    while cur != sink and cur in out and guard < len(nodes) + 2:
        best = max(out[cur], key=lambda l: l["p"])
        edges.append([best["source"], best["target"]])
        cur = best["target"]; path.append(cur); guard += 1
    return path, edges


# ----------------------------------------------------------------------------
#  Monte-Carlo estimate (for graphs too big for the exact DP)
# ----------------------------------------------------------------------------

def monte_carlo(g, seed, trials=2000):
    import random
    V = len(g)
    full = (1 << V) - 1
    total = 0
    for _ in range(trials):
        state, steps = 0, 0
        for v in seed:
            state |= (1 << v)
        while state != full and steps < 100000:
            blue = [u for u in range(V) if (state >> u) & 1]
            P_u = {u: (1 + sum(1 for v in g[u] if (state >> v) & 1)) / len(g[u]) for u in blue}
            new = state
            for w in range(V):
                if (state >> w) & 1:
                    continue
                stay = 1.0
                for u in g[w]:
                    if (state >> u) & 1:
                        stay *= (1.0 - P_u[u])
                if random.random() < (1.0 - stay):
                    new |= (1 << w)
            state = new; steps += 1
        total += steps
    return total / trials


# ----------------------------------------------------------------------------
#  main entry point used by the API
# ----------------------------------------------------------------------------

FULL_E_CAP = 1 << 16          # return the whole E table only up to this many states
EXACT_VERTEX_CAP = 20         # refuse exact DP above this (would be far too slow)


def compute_graph(n, edges, seed, mode="exact", trials=2000):
    if n < 1:
        return {"ok": False, "error": "Graph has no vertices."}
    g = adjacency(n, edges)
    seed = sorted(set(int(s) for s in seed))
    if not seed:
        return {"ok": False, "error": "Pick at least one starting (blue) vertex."}
    if max(seed) >= n or min(seed) < 0:
        return {"ok": False, "error": "Seed vertex out of range."}
    if not is_connected_from(g, seed):
        return {"ok": False,
                "error": "Some vertices can never be forced — the graph must be connected "
                         "and the start set must reach every vertex."}

    if mode == "montecarlo":
        mean = monte_carlo(g, seed, trials)
        return {"ok": True, "mode": "montecarlo", "stats": {
            "vertices": n, "edges": len(edges),
            "eSeedEstimate": round(mean, 3), "trials": trials}}

    if n > EXACT_VERTEX_CAP:
        return {"ok": False,
                "error": f"{n} vertices is too many for the exact engine "
                         f"(state space is 2^{n}). Try Monte-Carlo mode instead."}

    E = expected_steps(g)
    autos = automorphisms(g)
    nodes, links, start_id = build_pattern_dag(g, autos, seed, E)
    path, path_edges = most_likely_path(nodes, links, start_id)

    seed_mask = sum(1 << v for v in seed)
    max_e = max((nd["exp"] for nd in nodes), default=0.0)
    full_E = [E.get(i, 0.0) for i in range(1 << n)] if (1 << n) <= FULL_E_CAP else None

    return {
        "ok": True,
        "mode": "exact",
        "nodes": nodes,
        "links": links,
        "startId": start_id,
        "expected": full_E,
        "mostLikelyPath": path,
        "mostLikelyEdges": path_edges,
        "stats": {
            "vertices": n,
            "edges": len(edges),
            "automorphisms": len(autos),
            "patterns": sum(1 for x in nodes if x["type"] in ("pattern", "start")),
            "eSeed": round(E.get(seed_mask, 0.0), 4),
            "maxE": round(max_e, 4),
        },
    }


if __name__ == "__main__":
    # quick self-test / demo
    n, edges, _ = preset("prism", 3)
    out = compute_graph(n, edges, [0])
    print("prism Y3 stats:", out["stats"])
    print("most-likely path:", out["mostLikelyPath"])
