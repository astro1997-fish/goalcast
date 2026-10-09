/* GoalCast front end: a static single-page app over the JSON in ./data. */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const app = $('#app'), slipEl = $('#slip'), detailEl = $('#detail');
  const state = {
    pred: null, res: null, model: null,
    day: 'all', league: 'all', q: '', sort: 'time',
    resTab: 'backtest', resMarket: '1X2', resOutcome: 'all',
    slip: [],
  };

  /* ---------- helpers ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (p, d = 0) => (p * 100).toFixed(d) + '%';
  const fair = (p) => (p > 0 ? (1 / p).toFixed(2) : '–');
  const int = (n) => Number(n).toLocaleString('en');
  const store = {
    get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const dayKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fmtDay = (key) => {
    const today = dayKey(new Date()), tomorrow = dayKey(new Date(Date.now() + 864e5));
    if (key === today) return 'Today';
    if (key === tomorrow) return 'Tomorrow';
    return new Date(key + 'T12:00:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  };
  const countdown = (iso) => {
    const mins = Math.round((new Date(iso) - Date.now()) / 6e4);
    if (mins <= 0) return 'Kicked off';
    if (mins < 60) return `in ${mins}m`;
    if (mins < 1440) return `in ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
    return `in ${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
  };
  const label = (sel, m) => {
    const names = { '1': `${m.home} win`, 'X': 'Draw', '2': `${m.away} win`, '1X': `${m.home} or draw`, 'X2': `${m.away} or draw`, '12': 'No draw' };
    if (names[sel]) return names[sel];
    if (/^\d+-\d+$/.test(sel)) return `Correct score ${sel}`;
    return state.pred.labels[sel] || sel;
  };
  const upcoming = () => state.pred.matches.filter((m) => new Date(m.kickoff) > Date.now());
  const marketStat = (key, scope = 'backtest') => state.res[scope].markets.find((x) => x.key === key);
  const inSlip = (id, sel) => state.slip.some((s) => s.id === id && s.sel === sel);

  /* ---------- shared fragments ---------- */
  const formDots = (arr) => `<span class="form" aria-label="Last five results">${(arr || []).map((r) => `<i class="${r}">${r}</i>`).join('')}</span>`;
  const pips = (n) => `<span class="pips" title="Confidence ${n}/5" aria-label="Confidence ${n} of 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
  const probBar = (p) => `<div class="bar" role="img" aria-label="Home ${pct(p.h)}, draw ${pct(p.d)}, away ${pct(p.a)}">
      <span class="h" style="flex:${p.h}">${pct(p.h)}</span><span class="d" style="flex:${p.d}">${pct(p.d)}</span><span class="a" style="flex:${p.a}">${pct(p.a)}</span></div>`;
  const addBtn = (m, sel, text = '+ Slip') => `<button class="add ${inSlip(m.id, sel) ? 'on' : ''}" data-action="slip-add" data-id="${m.id}" data-sel="${sel}">${inSlip(m.id, sel) ? '✓ Added' : text}</button>`;

  const card = (m) => {
    const t = m.tips;
    return `<article class="card" data-action="open" data-id="${m.id}" tabindex="0">
      <div class="card-top"><span class="lg">${esc(m.league)} · ${esc(m.country)}</span><span class="num">${fmtTime(m.kickoff)} · ${countdown(m.kickoff)}</span></div>
      <div class="teams-row">
        <span class="team">${esc(m.home)}</span>${formDots(m.ctx.last?.h)}
        <span class="team">${esc(m.away)}</span>${formDots(m.ctx.last?.a)}
      </div>
      ${probBar(m.probs)}
      <div class="bar-legend"><span>Home</span><span>Draw</span><span>Away</span></div>
      <div class="card-foot">
        <span class="pick">${esc(label(t['1X2'].sel, m))} <small class="num">${pct(t['1X2'].p)}</small>${pips(m.confidence)}</span>
        ${addBtn(m, t['1X2'].sel)}
      </div>
      <div class="tags">
        ${t.SAFE ? `<span class="tag safe">Safe: ${esc(label(t.SAFE.sel, m))} ${pct(t.SAFE.p)}</span>` : ''}
        ${t.VALUE ? `<span class="tag value">Edge +${pct(t.VALUE.edge)} @ ${t.VALUE.odds}</span>` : ''}
        <span class="tag">${esc(state.pred.labels[t['O/U 2.5'].sel])} ${pct(t['O/U 2.5'].p)}</span>
        <span class="tag">BTTS ${t.BTTS.sel === 'BTTS-Y' ? 'yes' : 'no'} ${pct(t.BTTS.p)}</span>
        <span class="tag">Score ${t.CS.sel}</span>
      </div>
    </article>`;
  };

  /* ---------- views ---------- */
  function viewMatches() {
    const all = upcoming();
    const safe = marketStat('SAFE'), x12 = marketStat('1X2');
    const soon = all.filter((m) => new Date(m.kickoff) - Date.now() < 48 * 36e5);
    const tip = (soon.length ? soon : all).slice().sort((a, b) => b.tips['1X2'].p - a.tips['1X2'].p)[0];
    const days = [...new Set(all.map((m) => dayKey(m.kickoff)))];
    const leagues = [...new Map(all.map((m) => [m.div, `${m.country} · ${m.league}`])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    if (state.day !== 'all' && !days.includes(state.day)) state.day = 'all';

    const q = state.q.trim().toLowerCase();
    let list = all.filter((m) => (state.day === 'all' || dayKey(m.kickoff) === state.day)
      && (state.league === 'all' || m.div === state.league)
      && (!q || `${m.home} ${m.away} ${m.league}`.toLowerCase().includes(q)));
    if (state.sort === 'conf') list = list.slice().sort((a, b) => b.tips['1X2'].p - a.tips['1X2'].p);

    let body;
    if (!all.length) body = `<p class="empty">No fixtures scheduled in the next ten days. Predictions appear here as soon as the schedule feed lists them — meanwhile, see how the last rounds went on the <a href="#/results">Results</a> page.</p>`;
    else if (!list.length) body = `<p class="empty">No matches match these filters.</p>`;
    else if (state.sort === 'conf') body = `<div class="grid">${list.map(card).join('')}</div>`;
    else body = [...new Set(list.map((m) => dayKey(m.kickoff)))].map((d) => `<h3 class="day-label">${fmtDay(d)} · ${list.filter((m) => dayKey(m.kickoff) === d).length} matches</h3>
        <div class="grid">${list.filter((m) => dayKey(m.kickoff) === d).map(card).join('')}</div>`).join('');

    return `<section class="hero">
      <div>
        <span class="eyebrow">Open model · free · graded in public</span>
        <h1>Football predictions that <em>show their working</em>.</h1>
        <p class="lede">An XGBoost model trained on ${int(state.model.coverage.matches)} matches turns form, Elo ratings, shots and head-to-head records into one scoreline distribution per match. Every market is read from it — and every result is published, losses included.</p>
        <div class="hero-cta"><button class="btn primary" data-action="to-matches">See ${all.length} predictions</button><a class="btn" href="#/results">Check our record</a></div>
      </div>
      ${tip ? `<div class="totd" data-action="open" data-id="${tip.id}" tabindex="0">
        <span class="tag" style="background:none;padding:0">★ STRONGEST PICK · ${fmtDay(dayKey(tip.kickoff)).toUpperCase()} ${fmtTime(tip.kickoff)}</span>
        <div class="teams">${esc(tip.home)} v ${esc(tip.away)}</div>
        <div class="muted">${esc(tip.league)} · ${countdown(tip.kickoff)}</div>
        <div class="big"><b>${pct(tip.tips['1X2'].p)}</b><span><strong>${esc(label(tip.tips['1X2'].sel, tip))}</strong><br><span class="muted">fair odds ${fair(tip.tips['1X2'].p)} · likeliest score ${tip.tips.CS.sel}</span></span></div>
        <div style="margin-top:14px">${probBar(tip.probs)}</div>
      </div>` : ''}
    </section>
    <div class="stats">
      <div class="stat"><b>${all.length}</b><span>upcoming predictions</span></div>
      <div class="stat"><b>${pct(safe.rate)}</b><span>safe-tip hit rate, ${int(safe.n)} holdout picks</span></div>
      <div class="stat"><b>${pct(x12.rate, 1)}</b><span>1X2 accuracy on ${int(x12.n)} unseen matches</span></div>
      <div class="stat"><b>${state.model.coverage.leagues}</b><span>leagues, ${int(state.model.coverage.teams)} teams tracked</span></div>
    </div>
    <div class="section-head" id="matches"><h2>Upcoming matches</h2>
      <div class="tabs"><button data-action="sort" data-v="time" class="${state.sort === 'time' ? 'on' : ''}">By kick-off</button><button data-action="sort" data-v="conf" class="${state.sort === 'conf' ? 'on' : ''}">By confidence</button></div>
    </div>
    <div class="filters">
      <div class="chips"><button class="chip ${state.day === 'all' ? 'on' : ''}" data-action="day" data-v="all">All days</button>${days.map((d) => `<button class="chip ${state.day === d ? 'on' : ''}" data-action="day" data-v="${d}">${fmtDay(d)}</button>`).join('')}</div>
      <select class="field" data-change="league" aria-label="League"><option value="all">All leagues</option>${leagues.map(([k, v]) => `<option value="${k}" ${state.league === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <input class="field" type="search" placeholder="Search team…" value="${esc(state.q)}" data-input="q" aria-label="Search team">
    </div>
    <div id="match-list">${body}</div>
    <div class="section-head"><h2>How it works</h2></div>
    <div class="steps">
      <div class="panel"><h3>One distribution per match</h3><p>Three models estimate the result and each side's expected goals. They are merged into a single grid of scoreline probabilities, so 1X2, totals, BTTS and correct score never contradict each other.</p></div>
      <div class="panel"><h3>No odds inside the model</h3><p>Bookmaker prices are never an input. That keeps the model's view independent, and lets us show honestly where it disagrees with the market — and how those disagreements have fared.</p></div>
      <div class="panel"><h3>Logged before kick-off</h3><p>Each prediction is written to a public ledger when it is published and settled when the match ends. The record can't be tidied up afterwards. <a href="#/results">See it</a>.</p></div>
    </div>`;
  }

  function tipTable(rows, cols) {
    return `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th class="${c.r ? 'r' : ''}">${c.h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((m) => `<tr class="click" data-action="open" data-id="${m.id}">${cols.map((c) => `<td class="${c.r ? 'r num' : ''}">${c.f(m)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  const matchCell = (m) => `<strong>${esc(m.home)} v ${esc(m.away)}</strong><br><span class="muted">${esc(m.league)}</span>`;
  const whenCell = (m) => `${fmtDay(dayKey(m.kickoff))} ${fmtTime(m.kickoff)}<br><span class="muted">${countdown(m.kickoff)}</span>`;

  function viewSafe() {
    const s = marketStat('SAFE');
    const rows = upcoming().filter((m) => m.tips.SAFE).sort((a, b) => b.tips.SAFE.p - a.tips.SAFE.p);
    return `<div class="page-head"><h1>Safe tips</h1><p>The single most likely selection in each match, shown only when the model puts it at 80% or higher. Useful as accumulator legs — add them to the slip to see the combined probability.</p></div>
      <div class="note"><strong>${pct(s.rate, 1)} landed</strong> — ${int(s.hits)} of ${int(s.n)} safe tips on the last year of matches the model had never seen (it expected ${pct(s.avg_p, 1)}). That still means roughly one in ${Math.round(1 / (1 - s.rate))} loses.</div>
      ${rows.length ? tipTable(rows, [
        { h: 'Match', f: matchCell }, { h: 'Kick-off', f: whenCell },
        { h: 'Safe tip', f: (m) => `<strong>${esc(label(m.tips.SAFE.sel, m))}</strong>` },
        { h: 'Probability', r: 1, f: (m) => pct(m.tips.SAFE.p, 1) }, { h: 'Fair odds', r: 1, f: (m) => fair(m.tips.SAFE.p) },
        { h: '', r: 1, f: (m) => addBtn(m, m.tips.SAFE.sel) },
      ]) : '<p class="empty">No selection clears the 80% bar right now.</p>'}`;
  }

  function viewValue() {
    const v = marketStat('VALUE');
    const rows = upcoming().filter((m) => m.tips.VALUE).sort((a, b) => b.tips.VALUE.edge - a.tips.VALUE.edge);
    const priced = upcoming().filter((m) => m.odds.h).length;
    return `<div class="page-head"><h1>Model vs market</h1><p>Selections where the model's probability, multiplied by the bookmaker's average price, implies a positive expected return of 5% or more.</p></div>
      <div class="note warn"><strong>Read this first.</strong> On the holdout year, backing every one of these disagreements at 1 unit returned <strong>${pct(v.roi, 1)}</strong> per bet across ${int(v.n)} bets (${pct(v.rate, 1)} won; the model expected ${pct(v.avg_p, 1)}). When this model and the market disagree, the market has usually been right. We show these as a research signal, not as recommendations.</div>
      ${rows.length ? tipTable(rows, [
        { h: 'Match', f: matchCell }, { h: 'Kick-off', f: whenCell },
        { h: 'Selection', f: (m) => `<strong>${esc(label(m.tips.VALUE.sel, m))}</strong>` },
        { h: 'Model', r: 1, f: (m) => pct(m.tips.VALUE.p, 1) }, { h: 'Market', r: 1, f: (m) => pct(1 / m.tips.VALUE.odds, 1) },
        { h: 'Odds', r: 1, f: (m) => m.tips.VALUE.odds.toFixed(2) }, { h: 'Edge', r: 1, f: (m) => `+${pct(m.tips.VALUE.edge, 1)}` },
        { h: '', r: 1, f: (m) => addBtn(m, m.tips.VALUE.sel) },
      ]) : `<p class="empty">${priced ? 'No disagreements of 5% or more among the priced fixtures.' : 'No bookmaker prices in the feed yet for the upcoming fixtures. Odds are usually published two to three days before kick-off; this page fills in on the next daily refresh.'}</p>`}`;
  }

  function viewResults() {
    const r = state.res, tab = state.resTab, data = r[tab];
    const markets = data.markets;
    if (!markets.some((m) => m.key === state.resMarket)) state.resMarket = '1X2';
    let rows = data.rows.filter((x) => x.tips[state.resMarket]);
    if (state.resOutcome !== 'all') rows = rows.filter((x) => x.tips[state.resMarket].won === (state.resOutcome === 'won'));
    const shown = rows.slice(0, 120);
    const dummy = (x) => ({ home: x.home, away: x.away });
    const tiles = markets.map((m) => `<div class="tile"><h3>${esc(m.label)}</h3><b>${pct(m.rate, 1)}</b>
        <p>${int(m.hits)} of ${int(m.n)} · expected ${pct(m.avg_p, 1)}${m.roi !== undefined ? ` · ROI ${pct(m.roi, 1)}` : ''}</p><div class="meter"><i style="width:${m.rate * 100}%"></i></div></div>`).join('');
    const bt = r.backtest;
    const intro = tab === 'backtest'
      ? `<div class="note"><strong>Holdout backtest, ${bt.from} to ${bt.to}.</strong> ${int(bt.n)} matches the model was not trained on: it learned only from matches before this window, then predicted each of these. Every match is counted — nothing is filtered out.</div>`
      : `<div class="note"><strong>Live ledger.</strong> ${r.live.since ? `Logging since ${r.live.since.slice(0, 10)}.` : ''} ${int(r.live.n)} predictions settled, ${int(r.live.pending)} awaiting a result. Each entry is committed to the public repository before kick-off and never revised.</div>`;

    return `<div class="page-head"><h1>Results</h1><p>Wins and losses, side by side. "Expected" is the average probability the model gave its picks: if it is honest, the hit rate lands close to it.</p></div>
      <div class="tabs" style="margin-top:16px"><button data-action="res-tab" data-v="backtest" class="${tab === 'backtest' ? 'on' : ''}">Holdout backtest</button><button data-action="res-tab" data-v="live" class="${tab === 'live' ? 'on' : ''}">Live ledger (${int(r.live.n)})</button></div>
      ${intro}
      ${markets.length ? `<div class="tiles">${tiles}</div>` : ''}
      ${tab === 'backtest' ? `<div class="two" style="margin-top:14px">
        <div class="panel"><h3>1X2 accuracy by month</h3><p>Share of match-result picks that were right.</p>
          <div class="months">${bt.monthly.map((m) => `<div title="${m.n} matches"><b>${Math.round(m.rate * 100)}</b><i style="height:${m.rate * 100 * 1.6}%"></i>${m.month.slice(5)}/${m.month.slice(2, 4)}</div>`).join('')}</div></div>
        <div class="panel"><h3>1X2 accuracy by league</h3><p>Some leagues are more predictable than others.</p>
          ${bt.by_league.map((l) => `<div class="hbar"><span>${esc(l.league)}</span><div><i style="width:${l.rate * 100}%"></i></div><span class="num">${pct(l.rate, 1)}</span></div>`).join('')}</div>
      </div>` : ''}
      <div class="section-head"><h2>Settled predictions</h2>
        <div class="filters" style="margin:0">
          <select class="field" data-change="resMarket" aria-label="Market">${markets.map((m) => `<option value="${m.key}" ${state.resMarket === m.key ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>
          <div class="tabs">${['all', 'won', 'lost'].map((o) => `<button data-action="res-outcome" data-v="${o}" class="${state.resOutcome === o ? 'on' : ''}">${o[0].toUpperCase() + o.slice(1)}</button>`).join('')}</div>
        </div>
      </div>
      ${shown.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Match</th><th>Score</th><th>Prediction</th><th class="r">Probability</th><th class="r">Odds</th><th>Result</th></tr></thead><tbody>
        ${shown.map((x) => { const t = x.tips[state.resMarket]; return `<tr><td class="num">${x.date}</td><td><strong>${esc(x.home)} v ${esc(x.away)}</strong><br><span class="muted">${esc(x.league)}</span></td>
          <td class="num"><strong>${x.score}</strong></td><td>${esc(label(t.sel, dummy(x)))}</td><td class="r num">${pct(t.p, 1)}</td><td class="r num">${t.odds ? t.odds.toFixed(2) : `<span class="muted">${fair(t.p)} fair</span>`}</td>
          <td><span class="badge ${t.won ? 'won' : 'lost'}">${t.won ? 'Won' : 'Lost'}</span></td></tr>`; }).join('')}
        </tbody></table></div><p class="muted" style="font-size:13px">Showing the ${shown.length} most recent of ${int(rows.length)} in view.</p>`
        : `<p class="empty">${tab === 'live' ? 'Nothing settled yet. The first results appear after the next daily refresh following kick-off.' : 'No rows for this filter.'}</p>`}`;
  }

  function viewModel() {
    const m = state.model, x = m.metrics, s = x.splits;
    const rows = [['GoalCast model', x.model_on_priced], ['Bookmaker odds (margin removed)', x.bookmaker], ['Always predict league base rates', x.base_rate]];
    const best = (k, hi) => rows.map((r) => r[1][k]).reduce((a, b) => (hi ? Math.max(a, b) : Math.min(a, b)));
    const cell = (v, k, hi, d) => `<td class="${v === best(k, hi) ? 'best' : ''}">${k === 'accuracy' ? pct(v, 1) : v.toFixed(d)}</td>`;
    const S = 280, pad = 34, sc = (v) => pad + v * (S - pad - 8), sy = (v) => S - pad - v * (S - pad - 8);
    const maxN = Math.max(...x.calibration.map((c) => c.n));
    const cal = `<svg viewBox="0 0 ${S} ${S}" width="100%" style="max-width:340px" role="img" aria-label="Calibration plot: predicted probability against observed frequency">
      ${[0, .25, .5, .75, 1].map((t) => `<line x1="${sc(t)}" y1="${sy(0)}" x2="${sc(t)}" y2="${sy(1)}" stroke="var(--line)"/><line x1="${sc(0)}" y1="${sy(t)}" x2="${sc(1)}" y2="${sy(t)}" stroke="var(--line)"/>
        <text x="${sc(t)}" y="${S - 14}" font-size="10" fill="var(--muted)" text-anchor="middle">${t * 100}%</text><text x="${pad - 6}" y="${sy(t) + 3}" font-size="10" fill="var(--muted)" text-anchor="end">${t * 100}%</text>`).join('')}
      <line x1="${sc(0)}" y1="${sy(0)}" x2="${sc(1)}" y2="${sy(1)}" stroke="var(--muted)" stroke-dasharray="4 4"/>
      <polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${x.calibration.map((c) => `${sc(c.predicted)},${sy(c.observed)}`).join(' ')}"/>
      ${x.calibration.map((c) => `<circle cx="${sc(c.predicted)}" cy="${sy(c.observed)}" r="${3 + 5 * Math.sqrt(c.n / maxN)}" fill="var(--accent)" fill-opacity=".85"><title>Predicted ${pct(c.predicted, 1)}, happened ${pct(c.observed, 1)} (${int(c.n)} outcomes)</title></circle>`).join('')}
      <text x="${S / 2}" y="${S - 1}" font-size="10" fill="var(--muted)" text-anchor="middle">model said</text></svg>`;
    const maxGain = x.importance[0].gain;
    const gap = x.model_on_priced.log_loss - x.bookmaker.log_loss;

    return `<div class="page-head"><h1>The model, measured</h1><p>Version <span class="num">${m.version}</span>, trained on ${int(s.train + s.val + s.test)} matches from ${s.data_from} to ${s.data_through}. Scores below are from the final ${int(s.test)} matches (from ${s.test_from}), which were held back from training.</p></div>
      <div class="section-head"><h2>Against the bookmakers</h2></div>
      <div class="table-wrap"><table class="compare"><thead><tr><th>Forecaster</th><th>1X2 accuracy</th><th>Log loss ↓</th><th>Brier ↓</th><th>RPS ↓</th></tr></thead><tbody>
        ${rows.map(([n, r]) => `<tr><td><strong>${n}</strong></td>${cell(r.accuracy, 'accuracy', true)}${cell(r.log_loss, 'log_loss', false, 4)}${cell(r.brier, 'brier', false, 4)}${cell(r.rps, 'rps', false, 4)}</tr>`).join('')}
      </tbody></table></div>
      <div class="note ${gap > 0 ? 'warn' : ''}">${gap > 0
        ? `<strong>The market is still ahead</strong> by ${gap.toFixed(4)} log loss. That is the normal state of affairs for a model built on public results data — bookmaker prices also absorb team news, injuries and money. The model clearly beats the naive baseline and is well calibrated, which is what makes its probabilities useful for comparing matches and markets.`
        : `<strong>The model edges the market</strong> on this holdout by ${(-gap).toFixed(4)} log loss. Treat that with caution: one season is a small sample.`}</div>
      <div class="two">
        <div class="panel"><h3>Calibration</h3><p>When the model says 70%, does it happen 70% of the time? Points on the dashed line are perfectly honest. Bigger dots hold more predictions.</p>${cal}</div>
        <div class="panel"><h3>What drives a prediction</h3><p>Share of the match-result model's total gain, top ${x.importance.length} of 46 inputs.</p>
          ${x.importance.map((f) => `<div class="hbar"><span class="num">${esc(f.feature)}</span><div><i style="width:${(f.gain / maxGain) * 100}%"></i></div><span class="num">${pct(f.gain, 1)}</span></div>`).join('')}</div>
      </div>
      <div class="section-head"><h2>Version history</h2></div>
      <div class="table-wrap"><table class="compare"><thead><tr><th>Version</th><th>Holdout matches</th><th>Accuracy</th><th>Log loss</th><th>Market log loss</th></tr></thead><tbody>
        ${m.history.map((h) => `<tr><td class="num"><strong>${h.version}</strong>${h.version === m.version ? ' <span class="badge won">active</span>' : ''}</td><td>${int(h.n_test)}</td><td>${pct(h.accuracy, 1)}</td><td>${h.log_loss.toFixed(4)}</td><td>${h.bookmaker_log_loss.toFixed(4)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted" style="font-size:13px">Every training run registers a new version; earlier artifacts are never overwritten. The pipeline retrains daily as new results arrive.</p>
      <div class="section-head"><h2>Method</h2></div>
      <div class="steps">
        <div class="panel"><h3>Inputs</h3><p>Elo ratings with a home-advantage term, points and goals over the last 5 and 10 matches, home-only and away-only form, shots and shots on target, rest days, season points per game, the last six head-to-head meetings and league scoring rates. Each is computed only from matches played earlier.</p></div>
        <div class="panel"><h3>Models</h3><p>Gradient-boosted trees (XGBoost): a three-class model for home/draw/away and two Poisson models for each side's goals. Inputs are standardised; the number of boosting rounds is chosen on a validation year, never on the holdout.</p></div>
        <div class="panel"><h3>Markets</h3><p>The Poisson goal expectations form a scoreline grid, which is rescaled so its home/draw/away mass equals the result model's output. Double chance, totals, BTTS and correct score are sums over that one grid.</p></div>
      </div>`;
  }

  /* ---------- match detail ---------- */
  function openDetail(id) {
    const m = state.pred.matches.find((x) => x.id === id);
    if (!m) return;
    const s = m.sels, c = m.ctx;
    const mk = (sel) => `<button class="${inSlip(m.id, sel) ? 'on' : ''}" data-action="slip-add" data-id="${m.id}" data-sel="${sel}"><span>${esc(label(sel, m))}<small>fair odds ${fair(s[sel])}</small></span><b>${pct(s[sel], 1)}</b></button>`;
    const max = Math.max(...m.matrix.flat());
    const heat = `<table class="heat"><tr><th></th>${m.matrix[0].map((_, j) => `<th>${j}</th>`).join('')}</tr>
      ${m.matrix.map((row, i) => `<tr><th>${i}</th>${row.map((p) => `<td style="background:color-mix(in srgb, var(--accent) ${Math.round((p / max) * 85)}%, var(--surface-2));color:${p / max > .55 ? 'var(--on-accent)' : 'var(--text)'}">${(p * 100).toFixed(1)}</td>`).join('')}</tr>`).join('')}</table>`;
    const vsRow = (name, a, b) => `<span class="l">${a ?? '–'}</span><span class="c">${name}</span><span class="rr">${b ?? '–'}</span>`;
    const formList = (arr) => (arr && arr.length ? `<ul class="list">${arr.slice().reverse().map((f) => `<li><span>${esc(f.slice(2))}</span><span class="badge ${f[0] === 'W' ? 'won' : f[0] === 'L' ? 'lost' : 'pending'}">${f[0]}</span></li>`).join('')}</ul>` : '<p class="muted">No recent matches on record.</p>');

    detailEl.innerHTML = `<div class="d-head"><div><div class="muted">${esc(m.league)} · ${esc(m.country)} · ${fmtDay(dayKey(m.kickoff))} ${fmtTime(m.kickoff)} · ${countdown(m.kickoff)}</div>
        <h2>${esc(m.home)} v ${esc(m.away)}</h2></div><button class="x" data-action="close-detail" aria-label="Close">×</button></div>
      <div class="d-body">
        <div class="panel"><h3>Match result ${pips(m.confidence)}</h3><p>Model: expected goals ${m.xg.h.toFixed(2)} – ${m.xg.a.toFixed(2)}.</p>
          ${probBar(m.probs)}<div class="bar-legend"><span>${esc(m.home)}</span><span>Draw</span><span>${esc(m.away)}</span></div>
          ${m.implied ? `<p style="margin:14px 0 6px" class="muted">Bookmakers (margin removed), average odds ${m.odds.h} / ${m.odds.d} / ${m.odds.a}:</p>${probBar(m.implied)}` : '<p class="muted" style="margin:12px 0 0">Bookmaker prices not published yet for this fixture.</p>'}
        </div>
        <div class="panel"><h3>All markets</h3><p>Tap a selection to add it to your slip. Fair odds are 1 ÷ probability, with no bookmaker margin.</p>
          <div class="mk">${['1', 'X', '2', '1X', '12', 'X2', 'O1.5', 'U1.5', 'O2.5', 'U2.5', 'O3.5', 'U3.5', 'BTTS-Y', 'BTTS-N'].map(mk).join('')}</div></div>
        <div class="two">
          <div class="panel"><h3>Scoreline probabilities</h3><p>Rows: ${esc(m.home)} goals. Columns: ${esc(m.away)} goals. Values in %.</p><div style="overflow-x:auto">${heat}</div></div>
          <div class="panel"><h3>Likeliest scores</h3><p>Even the top score is a long shot.</p>
            ${m.scores.map((x) => `<div class="hbar" style="grid-template-columns:44px 1fr 48px"><strong class="num">${x.s}</strong><div><i style="width:${(x.p / m.scores[0].p) * 100}%"></i></div><span class="num">${pct(x.p, 1)}</span></div>`).join('')}</div>
        </div>
        <div class="panel"><h3>Head to head on the numbers</h3><p>Averages over each side's last ten league matches unless stated.</p>
          <div class="vs"><span class="l">${esc(m.home)}</span><span class="c"></span><span class="rr">${esc(m.away)}</span>
            ${vsRow('Elo rating', c.elo?.h, c.elo?.a)}${vsRow('Points / game', c.stats.h.ppg, c.stats.a.ppg)}${vsRow('Goals for', c.stats.h.gf, c.stats.a.gf)}
            ${vsRow('Goals against', c.stats.h.ga, c.stats.a.ga)}${vsRow('Shots on target (last 5)', c.stats.h.sot, c.stats.a.sot)}${vsRow('Season points / game', c.stats.h.season_ppg, c.stats.a.season_ppg)}${vsRow('Days since last match', c.rest.h, c.rest.a)}</div></div>
        <div class="two">
          <div class="panel"><h3>${esc(m.home)} — recent form</h3>${formList(c.form?.h)}</div>
          <div class="panel"><h3>${esc(m.away)} — recent form</h3>${formList(c.form?.a)}</div>
        </div>
        <div class="panel"><h3>Previous meetings</h3>${c.h2h && c.h2h.length ? `<ul class="list">${c.h2h.map((g) => `<li><span>${g.date} · ${esc(g.home)} v ${esc(g.away)}</span><strong class="num">${g.score}</strong></li>`).join('')}</ul>` : '<p class="muted">No meetings in the data since 2015.</p>'}</div>
      </div>`;
    detailEl.dataset.id = id;
    if (!detailEl.open) detailEl.showModal();
  }

  /* ---------- slip ---------- */
  function renderSlip() {
    $('#slip-count').textContent = state.slip.length;
    const p = state.slip.reduce((acc, x) => acc * x.p, 1);
    slipEl.innerHTML = `<h3>Accumulator slip <button class="x" data-action="toggle-slip" aria-label="Close slip">×</button></h3>
      ${state.slip.length ? `${state.slip.map((x) => `<div class="slip-item"><span><b>${esc(x.label)}</b><span class="muted">${esc(x.match)} · ${pct(x.p, 1)}</span></span><button class="x" data-action="slip-remove" data-id="${x.id}" aria-label="Remove">×</button></div>`).join('')}
        <div class="slip-total"><span>Legs</span><b>${state.slip.length}</b><span>Chance all land</span><b>${pct(p, 1)}</b><span>Fair combined odds</span><b>${fair(p)}</b></div>
        <p class="muted" style="font-size:12px;margin:10px 0">Treats matches as independent. A price above the fair odds is the only way an accumulator has positive expected value.</p>
        <button class="btn small" data-action="slip-clear">Clear slip</button>`
        : '<p class="muted" style="font-size:13.5px">Add selections from any match to see the true chance that all of them land.</p>'}`;
  }
  function slipAdd(id, sel) {
    const m = state.pred.matches.find((x) => x.id === id);
    if (!m) return;
    const same = inSlip(id, sel);
    state.slip = state.slip.filter((x) => x.id !== id); // one leg per match
    if (!same) state.slip.push({ id, sel, label: label(sel, m), match: `${m.home} v ${m.away}`, p: m.sels[sel] });
    store.set('gc-slip', state.slip);
    renderSlip();
    if (!same) slipEl.hidden = false;
  }

  /* ---------- routing & events ---------- */
  const routes = { '': viewMatches, safe: viewSafe, value: viewValue, results: viewResults, model: viewModel };
  function render(keepScroll) {
    const route = location.hash.replace(/^#\/?/, '');
    const view = routes[route] || viewMatches;
    document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.route === (routes[route] ? route : '')));
    const y = scrollY;
    app.innerHTML = view();
    scrollTo(0, keepScroll ? y : 0);
    if (detailEl.open) openDetail(detailEl.dataset.id);
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (e.target === detailEl) return detailEl.close();
    if (!el) return;
    const { action, id, sel, v } = el.dataset;
    const rerender = () => render(true);
    switch (action) {
      case 'slip-add': e.stopPropagation(); slipAdd(id, sel); rerender(); break;
      case 'slip-remove': state.slip = state.slip.filter((x) => x.id !== id); store.set('gc-slip', state.slip); renderSlip(); rerender(); break;
      case 'slip-clear': state.slip = []; store.set('gc-slip', []); renderSlip(); rerender(); break;
      case 'toggle-slip': slipEl.hidden = !slipEl.hidden; break;
      case 'open': openDetail(id); break;
      case 'to-matches': $('#matches').scrollIntoView(); break;
      case 'close-detail': detailEl.close(); break;
      case 'day': state.day = v; rerender(); break;
      case 'sort': state.sort = v; rerender(); break;
      case 'res-tab': state.resTab = v; rerender(); break;
      case 'res-outcome': state.resOutcome = v; rerender(); break;
      case 'theme': {
        const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
        document.documentElement.dataset.theme = next; store.set('gc-theme', next); break;
      }
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-action="open"]')) openDetail(e.target.dataset.id);
  });
  document.addEventListener('change', (e) => {
    const key = e.target.dataset.change;
    if (key) { state[key] = e.target.value; render(true); }
  });
  document.addEventListener('input', (e) => {
    if (e.target.dataset.input !== 'q') return;
    state.q = e.target.value;
    render(true);
    const box = $('[data-input="q"]');
    box.focus(); box.setSelectionRange(state.q.length, state.q.length);
  });
  addEventListener('hashchange', () => render(false));

  /* ---------- boot ---------- */
  document.documentElement.dataset.theme = store.get('gc-theme', matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const load = (name) => fetch(`data/${name}.json`, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`${name}: ${r.status}`); return r.json(); });
  Promise.all(['predictions', 'results', 'model'].map(load)).then(([pred, res, model]) => {
    Object.assign(state, { pred, res, model });
    const live = new Set(pred.matches.map((m) => m.id));
    state.slip = store.get('gc-slip', []).filter((x) => live.has(x.id));
    $('#foot-meta').textContent = `Updated ${new Date(pred.generated).toLocaleString()} · model ${pred.version}`;
    renderSlip();
    render(false);
    setInterval(() => { if (!detailEl.open && !document.activeElement?.matches('input, select')) render(true); }, 60000);
  }).catch((err) => {
    app.innerHTML = `<p class="empty">Could not load prediction data (${esc(err.message)}). Run <code>python -m ml.pipeline</code> and serve the <code>site</code> folder.</p>`;
  });
})();
