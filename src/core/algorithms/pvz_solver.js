'use strict';
// PVZ deduction game. Node.js, no dependencies. Materials are A, B, ... .
// G = exact; B = elsewhere; P = one shared material; X = no shared material.

class RNG {
  constructor(seed = 20261016) { this.x = seed >>> 0; }
  u32() {
    let t = this.x = (this.x + 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return (t ^ t >>> 14) >>> 0;
  }
  below(n) {
    if (n <= 0n) throw Error('Empty random range');
    const bits = n.toString(2).length;
    const mask = (1n << BigInt(bits)) - 1n;
    let x;
    do {
      x = 0n;
      for (let i = 0; i < bits; i += 32) x = (x << 32n) | BigInt(this.u32());
      x &= mask;
    } while (x >= n);
    return x;
  }
  index(n) { return Number(this.below(BigInt(n))); }
}

class Model {
  constructor(materials = 10, slots = 10, legal = null) {
    if (materials < 1 || materials > 26 || slots < 1 || slots > 10)
      throw Error('Supported: 1..26 materials, 1..10 slots');
    this.n = slots;
    this.pairs = [];
    for (let a = 0; a < materials; a++)
      for (let b = a; b < materials; b++) this.pairs.push([a, b]);
    this.names = this.pairs.map(([a, b]) => String.fromCharCode(65+a, 65+b));
    if (legal) {
      const keep = new Set(legal.map(s => s.toUpperCase().split('').sort().join('')));
      this.pairs = this.pairs.filter((p, i) => keep.has(this.names[i]));
      this.names = this.names.filter(s => keep.has(s));
    }
    this.m = this.pairs.length;
    if (this.m < slots) throw Error('Fewer recipes than slots');
    this.overlap = this.pairs.map(([a, b]) => this.pairs.map(([c, d]) =>
      a === c || a === d || b === c || b === d));
  }
  encode(row) {
    if (row.length !== this.n) throw Error('Wrong row length');
    return row.map(s => {
      const i = this.names.indexOf(s.toUpperCase().split('').sort().join(''));
      if (i < 0) throw Error('Illegal recipe: ' + s);
      return i;
    });
  }
  decode(row) { return row.map(v => this.names[v]); }
  feedback(secret, query) {
    const present = new Set(secret);
    return query.map((q, i) => secret[i] === q ? 'G' : present.has(q) ? 'B' :
      this.overlap[q][secret[i]] ? 'P' : 'X').join('');
  }
}

class State {
  constructor(model) {
    this.model = model;
    this.domains = Array.from({length: model.n}, () => new Set(model.pairs.map((_, i) => i)));
    this.required = new Set();
    this.locked = new Map();
    this.turns = 0;
  }
  update(query, response) {
    const {model: m} = this;
    const f = Array.from(response.toUpperCase().replace(/\s/g, ''));
    if (query.length !== m.n || f.length !== m.n || f.some(c => !'GBPX'.includes(c)))
      throw Error('Expected one G/B/P/X response per slot');
    for (let i = 0; i < m.n; i++) {
      const q = query[i];
      if (this.locked.has(i) && (this.locked.get(i) !== q || f[i] !== 'G'))
        throw Error('A locked slot must retain its plant and G response');
      if (f[i] === 'G') {
        if (!this.domains[i].has(q)) throw Error('Feedback contradicts earlier observations');
        this.domains[i] = new Set([q]);
        this.required.add(q);
        this.locked.set(i, q);
      } else if (f[i] === 'B') {
        this.domains[i].delete(q);
        this.required.add(q);
      } else {
        for (const d of this.domains) d.delete(q);
        this.domains[i] = new Set([...this.domains[i]].filter(v =>
          m.overlap[q][v] === (f[i] === 'P')));
      }
    }
    const values = [...this.locked.values()];
    if (new Set(values).size !== values.length) throw Error('Secret plants must be distinct');
    for (let i = 0; i < m.n; i++) if (!this.locked.has(i))
      for (const v of values) this.domains[i].delete(v);
    this.turns++;
  }
  get done() { return this.locked.size === this.model.n; }
}

// Exact count and uniform sampling of the posterior via subset DP.
// Each recipe can cover zero or one slot; required recipes must cover one.
class Posterior {
  constructor(state) {
    this.state = state;
    this.slots = [...Array(state.model.n).keys()].filter(i => !state.locked.has(i));
    const fixed = new Set(state.locked.values());
    this.values = [];
    this.allow = [];
    this.must = [];
    for (let v = 0; v < state.model.m; v++) {
      if (fixed.has(v)) continue;
      let mask = 0;
      this.slots.forEach((i, k) => { if (state.domains[i].has(v)) mask |= 1 << k; });
      if (mask || state.required.has(v)) {
        this.values.push(v); this.allow.push(mask); this.must.push(state.required.has(v));
      }
    }
    this.full = (1 << this.slots.length) - 1;
    const size = this.full + 1;
    this.dp = Array.from({length: this.values.length + 1}, () => Array(size).fill(0n));
    this.dp[this.values.length][this.full] = 1n;
    for (let j = this.values.length - 1; j >= 0; j--) {
      const next = this.dp[j + 1], now = this.dp[j];
      for (let mask = 0; mask < size; mask++) {
        let count = this.must[j] ? 0n : next[mask];
        for (let bits = this.allow[j] & ~mask; bits; bits &= bits - 1) {
          const bit = bits & -bits;
          count += next[mask | bit];
        }
        now[mask] = count;
      }
    }
    this.count = this.dp[0][0];
    if (!this.count) throw Error('No secret is consistent with this feedback history');
  }
  baseRow() {
    const row = Array(this.state.model.n).fill(-1);
    for (const [i, v] of this.state.locked) row[i] = v;
    return row;
  }
  sample(rng) {
    const row = this.baseRow();
    let mask = 0;
    for (let j = 0; j < this.values.length && mask !== this.full; j++) {
      let ticket = rng.below(this.dp[j][mask]);
      const skip = this.must[j] ? 0n : this.dp[j + 1][mask];
      if (ticket < skip) continue;
      ticket -= skip;
      let placed = false;
      for (let bits = this.allow[j] & ~mask; bits; bits &= bits - 1) {
        const bit = bits & -bits, weight = this.dp[j + 1][mask | bit];
        if (ticket < weight) {
          row[this.slots[31 - Math.clz32(bit)]] = this.values[j];
          mask |= bit; placed = true; break;
        }
        ticket -= weight;
      }
      if (!placed) throw Error('Internal sampling error');
    }
    return row;
  }
  enumerate(limit = 2048) {
    if (this.count > BigInt(limit)) throw Error('Enumeration limit exceeded');
    const out = [], row = this.baseRow();
    const visit = (j, mask) => {
      if (j === this.values.length) { if (mask === this.full) out.push(row.slice()); return; }
      if (!this.must[j] && this.dp[j + 1][mask]) visit(j + 1, mask);
      for (let bits = this.allow[j] & ~mask; bits; bits &= bits - 1) {
        const bit = bits & -bits;
        if (!this.dp[j + 1][mask | bit]) continue;
        const i = this.slots[31 - Math.clz32(bit)];
        row[i] = this.values[j]; visit(j + 1, mask | bit); row[i] = -1;
      }
    };
    visit(0, 0);
    return out;
  }
}

function chooseQuery(state, rng, options = {}, suppliedPosterior = null) {
  const p = suppliedPosterior || new Posterior(state), model = state.model;
  if (p.count === 1n) return p.sample(rng);
  const sampleSize = options.samples || 1024;
  const samples = p.count <= BigInt(sampleSize) ? p.enumerate(sampleSize) :
    Array.from({length: sampleSize}, () => p.sample(rng));
  const n = samples.length, k = p.slots.length;
  // Numerical codes: X=0, P=1, B=2, G=3. Use only unlocked slots.
  const tables = p.slots.map(() => Array.from({length: model.m}, () => new Uint8Array(n)));
  const greens = p.slots.map(() => new Int32Array(model.m));
  for (let s = 0; s < n; s++) {
    const present = new Set(samples[s]);
    p.slots.forEach((i, j) => {
      for (let v = 0; v < model.m; v++) {
        const f = samples[s][i] === v ? 3 : present.has(v) ? 2 : model.overlap[v][samples[s][i]] ? 1 : 0;
        tables[j][v][s] = f;
        if (f === 3) greens[j][v]++;
      }
    });
  }
  const bins = new Int32Array(1 << (2*k)), touched = new Int32Array(n);
  const winCode = (1 << (2*k)) - 1;
  function score(codes, row) {
    let used = 0, sumsq = 0, worst = 0, wins = 0;
    for (const code of codes) {
      if (code === winCode) { wins++; continue; }
      if (!bins[code]) touched[used++] = code;
      const c = ++bins[code];
      sumsq += 2*c - 1;
      if (c > worst) worst = c;
    }
    for (let t = 0; t < used; t++) bins[touched[t]] = 0;
    let hits = 0;
    row.forEach((v, j) => { hits += greens[j][v]; });
    return [worst, sumsq, -wins, -hits];
  }
  function better(a, b) {
    if (!b) return true;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
    return false;
  }
  function codesFor(row) {
    const codes = new Int32Array(n);
    row.forEach((v, j) => {
      const t = tables[j][v], shift = 2*j;
      for (let s = 0; s < n; s++) codes[s] |= t[s] << shift;
    });
    return codes;
  }
  // Seed 1 maximizes each slot's empirical entropy. Seed 2 is a possible secret.
  const entropyRow = p.slots.map((_, j) => {
    let best = 0, max = -Infinity;
    for (let v = 0; v < model.m; v++) {
      const counts = [0, 0, 0, 0];
      for (const f of tables[j][v]) counts[f]++;
      const entropy = counts.reduce((h, c) => c ? h - c/n * Math.log2(c/n) : h, 0);
      if (entropy > max) { max = entropy; best = v; }
    }
    return best;
  });
  const candidateSeed = samples[rng.index(n)];
  const seeds = [entropyRow, p.slots.map(i => candidateSeed[i])];
  // Also include several whole candidate secrets to improve finishing behavior.
  for (let s = 0; s < Math.min(8, n); s++) seeds.push(p.slots.map(i => samples[s][i]));
  let bestRow, bestScore;
  for (let restart = 0; restart < seeds.length; restart++) {
    let row = seeds[restart].slice(), codes = codesFor(row), current = score(codes, row);
    // Fully optimize the first two seeds; merely score the others.
    for (let sweep = 0; restart < 2 && sweep < (options.sweeps || 2); sweep++) {
      let changed = false;
      for (let j = 0; j < k; j++) {
        const shift = 2*j, clear = ~(3 << shift), old = row[j];
        let chosen = old, chosenScore = current;
        const trialCodes = new Int32Array(n);
        for (let v = 0; v < model.m; v++) {
          if (v === old) continue;
          const table = tables[j][v]; row[j] = v;
          for (let s = 0; s < n; s++) trialCodes[s] = (codes[s] & clear) | (table[s] << shift);
          const result = score(trialCodes, row);
          if (better(result, chosenScore)) { chosen = v; chosenScore = result; }
        }
        row[j] = chosen;
        if (chosen !== old) {
          changed = true;
          const table = tables[j][chosen];
          for (let s = 0; s < n; s++) codes[s] = (codes[s] & clear) | (table[s] << shift);
          current = chosenScore;
        }
      }
      if (!changed) break;
    }
    if (better(current, bestScore)) { bestScore = current; bestRow = row.slice(); }
  }
  const answer = p.baseRow();
  p.slots.forEach((i, j) => { answer[i] = bestRow[j]; });
  return answer;
}

function randomSecret(model, rng) {
  const pool = [...Array(model.m).keys()];
  for (let i = 0; i < model.n; i++) {
    const j = i + rng.index(model.m - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, model.n);
}

function play(model, secret, rng, options = {}) {
  const state = new State(model), trace = [];
  let previous = null;
  while (!state.done) {
    if (state.turns >= model.m * model.n + 1) throw Error('Unexpected lack of progress');
    const p = new Posterior(state);
    // A consistent-secret guess guarantees progress after a noninformative probe.
    const fallback = previous === p.count;
    const query = options.baseline || fallback ? p.sample(rng) : chooseQuery(state, rng, options, p);
    const response = model.feedback(secret, query);
    trace.push({round: state.turns + 1, candidates: p.count.toString(), query: model.decode(query), response, fallback});
    state.update(query, response);
    previous = p.count;
  }
  return trace;
}

export {RNG, Model, State, Posterior, chooseQuery, randomSecret, play};
