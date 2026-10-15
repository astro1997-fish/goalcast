/* GoalCast front end: a static single-page app over the JSON in ./data. */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const BASE = new URL('.', document.currentScript.src).pathname; // site root, wherever the site is hosted
  const app = $('#app'), slipEl = $('#slip'), detailEl = $('#detail');
  const state = {
    pred: null, res: null, model: null, leagues: null, blog: null, sponsors: null, pages: null, logos: null, premium: null, country: '',
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
      <div class="card-top"><span class="lg">${leagueLogo(m.div, 16)}${esc(m.league)} · ${esc(m.country)}</span><span class="num">${fmtTime(m.kickoff)} · ${countdown(m.kickoff)}</span></div>
      <div class="teams-row">
        <span class="team">${crest(m.home, 22)}${favs().includes(m.home) ? '★ ' : ''}${esc(m.home)}</span>${formDots(m.ctx.last?.h)}
        <span class="team">${crest(m.away, 22)}${favs().includes(m.away) ? '★ ' : ''}${esc(m.away)}</span>${formDots(m.ctx.last?.a)}
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

  /* ---------- home page: hero, feature strip, featured matches ---------- */
  /* Team badge: the club crest or national flag when one is known, otherwise initials on a colour derived from the name. */
  function monogram(name, size = 44) {
    const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
    const initials = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 3)).toUpperCase();
    let hash = 0;
    for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) % 360;
    return `<span class="crest" style="--h:${hash};width:${size}px;height:${size}px;font-size:${Math.max(7, Math.round(size * (initials.length > 2 ? 0.3 : 0.38)))}px" aria-hidden="true">${esc(initials)}</span>`;
  }
  function crest(name, size = 44) {
    const url = state.logos?.teams?.[name];
    return url ? `<img class="crest-img" src="${esc(url)}" alt="" width="${size}" height="${size}" loading="lazy" data-team="${esc(name)}">` : monogram(name, size);
  }
  function leagueLogo(div, size = 20) {
    const logo = state.logos?.leagues?.[div];
    if (!logo) return '';
    const url = document.documentElement.dataset.theme === 'light' ? logo.light : logo.dark;
    return `<img class="league-logo" src="${esc(url)}" alt="" width="${size}" height="${size}" loading="lazy">`;
  }
  /* A picture that fails to load falls back to the drawn badge (teams) or disappears (competitions). */
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.classList?.contains('crest-img')) img.outerHTML = monogram(img.dataset.team, img.width);
    else if (img.classList?.contains('league-logo')) img.remove();
  }, true);
  const ICON = {
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><path d="M12 12l7.5-7.5M19.5 4.5V8M19.5 4.5H16"/>',
    bars: '<path d="M4 20V13M9.3 20V9M14.7 20V11M20 20V5"/><path d="M4 8l5-3.5 5 2.5 6-4.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    medal: '<path d="M12 3l7 2.5v6c0 4.5-3 7.5-7 9.5-4-2-7-5-7-9.5v-6z"/><path d="M12 8.2l1.2 2.5 2.7.3-2 1.9.6 2.7-2.5-1.4-2.5 1.4.6-2.7-2-1.9 2.7-.3z" fill="currentColor" stroke="none"/>',
    shield: '<path d="M12 3l7 2.5v6c0 4.5-3 7.5-7 9.5-4-2-7-5-7-9.5v-6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

  function homeHero(all, tip) {
    const photo = (window.GOALCAST_HOME || {}).heroImage;
    const second = all.filter((m) => m !== tip).sort((a, b) => b.tips['1X2'].p - a.tips['1X2'].p)[0];
    const art = photo ? `<img class="hero-photo" src="${esc(photo)}" alt="">` : `
        ${second ? `<div class="hero-card back" aria-hidden="true"><span class="hc-tag">${esc(second.league)}</span><div class="hc-teams">${crest(second.home, 34)}<b>${esc(second.home)}</b><i>v</i><b>${esc(second.away)}</b>${crest(second.away, 34)}</div></div>` : ''}
        ${tip ? `<div class="hero-card" data-action="open" data-id="${tip.id}" tabindex="0">
          <span class="hc-tag">★ Strongest pick · ${fmtDay(dayKey(tip.kickoff))} ${fmtTime(tip.kickoff)}</span>
          <div class="hc-teams">${crest(tip.home, 46)}<b>${esc(tip.home)}</b><i>v</i><b>${esc(tip.away)}</b>${crest(tip.away, 46)}</div>
          <div class="hc-big"><b>${pct(tip.tips['1X2'].p)}</b><span><strong>${esc(label(tip.tips['1X2'].sel, tip))}</strong><br>${esc(tip.league)} · likeliest score ${tip.tips.CS.sel}</span></div>
          ${probBar(tip.probs)}
        </div>` : ''}`;
    return `<section class="home-hero ${photo ? 'has-photo' : ''}">
      <div class="hero-bg" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="hero-in">
        <div class="hero-copy">
          <h1><span class="hero-kicker">Welcome to</span><span class="hero-brand">Goal<em>Cast</em></span><span class="hero-sub">Football predictions</span></h1>
          <p class="hero-lede">AI predictions. In-depth analysis. Every result published.<br>Your smarter view of the game.</p>
          <div class="hero-cta"><button class="btn primary big" data-action="to-matches">View today's predictions <span aria-hidden="true">→</span></button><a class="btn big outline" href="#/premium">♛ Explore Premium</a></div>
        </div>
        <div class="hero-art">${art}<p class="hero-slogan" aria-hidden="true">Bet smart.<br><em>Check GoalCast.</em></p></div>
      </div>
    </section>
    <section class="feature-strip">
      <div>${icon('target')}<p><strong>Data-driven predictions</strong>${int(state.model.coverage.matches)} matches analysed</p></div>
      <div>${icon('bars')}<p><strong>In-depth analysis</strong>Detailed match breakdowns</p></div>
      <div>${icon('clock')}<p><strong>Updated daily</strong>Fresh predictions twice a day</p></div>
      <a href="#/results">${icon('medal')}<p><strong>Proven results</strong>Track our performance</p></a>
      <div>${icon('shield')}<p><strong>Secure &amp; reliable</strong>Your trust matters</p></div>
    </section>
    ${adSlot('banner')}`;
  }

  /* ---------- views ---------- */
  function viewMatches(day) {
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
    else if (state.sort === 'conf') body = `<div class="grid">${feed(list, true)}</div>`;
    else body = [...new Set(list.map((m) => dayKey(m.kickoff)))].map((d, i) => `<h3 class="day-label">${fmtDay(d)} · ${list.filter((m) => dayKey(m.kickoff) === d).length} matches</h3>
        <div class="grid">${feed(list.filter((m) => dayKey(m.kickoff) === d), i === 0)}</div>`).join('');

    return `${day ? `<div class="page-head"><h1>Predictions for ${fmtDay(day)}</h1><p>Every match on this day, with the model's probabilities.</p></div>` : homeHero(all, tip)}
    ${favMatches().length ? `<div class="section-head"><h2>★ Your teams</h2><a class="btn small" href="#/my-teams">Manage teams</a></div><div class="grid">${favMatches().slice(0, 6).map(card).join('')}</div>` : ''}
    <div class="section-head featured-head" id="matches"><h2>${day ? 'Matches' : 'Upcoming matches <span class="live-dot">Upcoming</span>'}</h2>
      <div class="tabs"><button data-action="sort" data-v="time" class="${state.sort === 'time' ? 'on' : ''}">By kick-off</button><button data-action="sort" data-v="conf" class="${state.sort === 'conf' ? 'on' : ''}">By confidence</button></div>
    </div>
    <div class="filters">
      <div class="chips"><button class="chip ${state.day === 'all' ? 'on' : ''}" data-action="day" data-v="all">All days</button>${days.map((d) => `<button class="chip ${state.day === d ? 'on' : ''}" data-action="day" data-v="${d}">${fmtDay(d)}</button>`).join('')}</div>
      <select class="field" data-change="league" aria-label="League"><option value="all">All leagues</option>${leagues.map(([k, v]) => `<option value="${k}" ${state.league === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <input class="field" type="search" placeholder="Search team…" value="${esc(state.q)}" data-input="q" aria-label="Search team">
    </div>
    <div id="match-list">${body}</div>
    <div class="stats" style="margin-top:34px">
      <div class="stat"><b>${all.length}</b><span>upcoming predictions</span></div>
      <div class="stat"><b>${pct(safe.rate)}</b><span>safe-tip hit rate, ${int(safe.n)} holdout picks</span></div>
      <div class="stat"><b>${pct(x12.rate, 1)}</b><span>1X2 accuracy on ${int(x12.n)} unseen matches</span></div>
      <div class="stat"><b>${state.model.coverage.leagues}</b><span>leagues, ${int(state.model.coverage.teams)} teams tracked</span></div>
    </div>
    ${posts().length ? `<div class="section-head"><h2>From the blog</h2><a class="btn small" href="#/blog">All articles</a></div><div class="post-grid">${posts().slice(0, 3).map(postCard).join('')}</div>` : ''}
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
      ${m.intl && Object.keys(m.intl).length ? `<div class="section-head"><h2>International models</h2></div>
      <div class="table-wrap"><table class="compare"><thead><tr><th>Model</th><th>Holdout matches</th><th>1X2 accuracy</th><th>Log loss ↓</th><th>Base-rate accuracy</th><th>Base-rate log loss</th></tr></thead><tbody>
        ${Object.values(m.intl).map((f) => `<tr><td><strong>${esc(f.label)}</strong></td><td>${int(f.model.n)}</td><td class="best">${pct(f.model.accuracy, 1)}</td><td class="best">${f.model.log_loss.toFixed(4)}</td><td>${pct(f.base_rate.accuracy, 1)}</td><td>${f.base_rate.log_loss.toFixed(4)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted" style="font-size:13px">Separate models for national teams and for continental club cups, built on ratings, recent form and head-to-head from international matches only. No odds data is available for these, so they are compared with a base-rate guess rather than with bookmakers.</p>` : ''}
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
        <h2 class="vs-head">${crest(m.home, 36)}<span>${esc(m.home)} v ${esc(m.away)}</span>${crest(m.away, 36)}</h2>
        ${auth.user ? `<div class="follow">${[m.home, m.away].map((t) => `<button class="btn small" data-action="fav-toggle" data-v="${esc(t)}">${favs().includes(t) ? '★ Following' : '☆ Follow'} ${esc(t)}</button>`).join('')}</div>` : ''}</div><button class="x" data-action="close-detail" aria-label="Close">×</button></div>
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
        <div class="panel"><h3>Head to head on the numbers</h3><p>Averages over each side's last ten ${m.intl ? 'international' : 'league'} matches unless stated.</p>
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
    if (!same) state.slip.push({ id, sel, label: label(sel, m), match: `${m.home} v ${m.away}`, p: m.sels[sel] ?? m.scores.find((x) => x.s === sel)?.p ?? m.tips.CS.p });
    store.set('gc-slip', state.slip);
    renderSlip();
    if (!same) slipEl.hidden = false;
  }

  /* ---------- international ---------- */
  const REGIONS = { europe: 'Europe', africa: 'Africa', 'north-america': 'North America' };
  const regionSlug = (name) => Object.keys(REGIONS).find((k) => REGIONS[k] === name);

  function viewIntl(slug) {
    const region = REGIONS[slug] ? slug : 'europe';
    const name = REGIONS[region];
    const fixtures = upcoming().filter((m) => m.intl && m.country === name);
    const record = state.res.intl?.regions?.[name];
    const comps = [...new Set(fixtures.map((m) => m.league))];
    const dummy = (x) => ({ home: x.home, away: x.away });
    return `<div class="page-head"><span class="eyebrow">International</span><h1>${name}</h1>
        <p>Continental club competitions and national-team matches. These use two separate models trained only on international results, so they are less precise than the league predictions and have no bookmaker comparison.</p></div>
      <div class="chips" style="margin:16px 0">${Object.entries(REGIONS).map(([k, v]) => `<a class="chip ${k === region ? 'on' : ''}" href="#/intl/${k}">${v}</a>`).join('')}</div>
      ${record ? `<div class="note"><strong>${pct(record.rate, 1)} of match-result picks were right</strong> across ${int(record.n)} ${name} internationals in the last year, none of which the models had seen.</div>` : ''}
      ${fixtures.length ? comps.map((c) => `<h3 class="day-label with-crest">${leagueLogo(fixtures.find((m) => m.league === c).div, 22)}${esc(c)} · ${fixtures.filter((m) => m.league === c).length} matches</h3><div class="grid">${fixtures.filter((m) => m.league === c).map(card).join('')}</div>`).join('')
        : '<p class="empty">No international fixtures here in the next ten days. Matches appear automatically as each round or international window approaches.</p>'}
      ${record ? `<div class="section-head"><h2>Recent results</h2></div>
        <div class="table-wrap"><table><thead><tr><th>Date</th><th>Match</th><th>Score</th><th>Prediction</th><th class="r">Probability</th><th>Result</th></tr></thead><tbody>
        ${record.rows.slice(0, 40).map((x) => { const t = x.tips['1X2']; return `<tr><td class="num">${x.date}</td><td><strong>${esc(x.home)} v ${esc(x.away)}</strong><br><span class="muted">${esc(x.league)}</span></td>
          <td class="num"><strong>${x.score}</strong></td><td>${esc(label(t.sel, dummy(x)))}</td><td class="r num">${pct(t.p, 1)}</td><td><span class="badge ${t.won ? 'won' : 'lost'}">${t.won ? 'Won' : 'Lost'}</span></td></tr>`; }).join('')}
        </tbody></table></div><p class="muted" style="font-size:13px">Holdout matches: predicted by a model trained only on earlier results.</p>` : ''}`;
  }

  /* ---------- blog & sponsors ---------- */
  const todayKey = () => dayKey(new Date());
  const posts = () => (state.blog?.posts || []).filter((p) => p.date <= todayKey());
  const longDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
  let adTurn = 0;

  /* One advert for a placement ("banner", "feed" or "article"), or nothing if none is booked. */
  function adSlot(place) {
    const data = state.sponsors;
    if (!data) return '';
    const t = todayKey();
    const pool = data.sponsors.filter((s) => s.placements.includes(place) && (!s.start || s.start <= t) && (!s.end || s.end >= t));
    if (!pool.length) {
      const a = data.advertise;
      return a?.email ? `<a class="ad ad-${place} house" href="mailto:${esc(a.email)}?subject=Advertising%20on%20GoalCast"><span class="ad-label">Advertise here</span>
        <span class="ad-copy"><strong>${esc(a.text || 'Sponsor GoalCast')}</strong></span><span class="btn small">Get in touch</span></a>` : '';
    }
    const s = pool[adTurn % pool.length];
    return `<a class="ad ad-${place}" href="${esc(s.url)}" target="_blank" rel="sponsored noopener"><span class="ad-label">Sponsored</span>
      ${s.image ? `<img src="${esc(s.image)}" alt="${esc(s.name)}" loading="lazy">` : ''}
      <span class="ad-copy"><strong>${esc(s.headline)}</strong>${s.text ? `<span>${esc(s.text)}</span>` : ''}</span><span class="btn small primary">${esc(s.cta)}</span></a>`;
  }
  const feed = (list, withAd) => {
    const cards = list.map(card);
    const ad = withAd ? adSlot('feed') : '';
    if (ad) cards.splice(Math.min(6, cards.length), 0, ad);
    return cards.join('');
  };

  const postCard = (p) => `<a class="post-card" href="#/blog/${p.slug}">
      ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : ''}
      <span class="muted num">${longDate(p.date)} · ${p.minutes} min read</span><h3>${esc(p.title)}</h3>
      ${p.summary ? `<p>${esc(p.summary)}</p>` : ''}<span class="tags">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span></a>`;

  function viewBlog(slug) {
    const all = posts();
    const p = slug && all.find((x) => x.slug === decodeURIComponent(slug));
    if (!p) {
      return `<div class="page-head"><h1>Blog</h1><p>Guides, previews and notes on how the model works.</p></div>
        ${all.length ? `<div class="post-grid">${all.map(postCard).join('')}</div>` : '<p class="empty">No articles published yet.</p>'}`;
    }
    const more = all.filter((x) => x.slug !== p.slug).slice(0, 3);
    return `<article class="post">
        <a class="muted" href="#/blog">← All articles</a>
        <h1>${esc(p.title)}</h1>
        <p class="muted">${esc(p.author)} · ${longDate(p.date)} · ${p.minutes} min read</p>
        ${p.image ? `<img class="cover" src="${esc(p.image)}" alt="">` : ''}
        <div class="prose">${p.html}</div>
        ${adSlot('article')}
      </article>
      ${more.length ? `<div class="section-head"><h2>More articles</h2></div><div class="post-grid">${more.map(postCard).join('')}</div>` : ''}`;
  }

  function viewPage(slug) {
    const p = (state.pages?.pages || []).find((x) => x.slug === slug);
    if (!p) return viewMatches();
    return `<article class="post"><h1>${esc(p.title)}</h1>${p.updated ? `<p class="muted">Last updated ${longDate(p.updated)}</p>` : ''}<div class="prose">${p.html}</div></article>`;
  }

  /* ---------- favourite teams ---------- */
  const MAX_FAVS = 20;
  const favs = () => auth.user?.user_metadata?.favorite_teams || [];
  const isFav = (m) => { const f = favs(); return f.includes(m.home) || f.includes(m.away); };
  const favMatches = () => (favs().length ? upcoming().filter(isFav) : []);
  let teamIndex = null;
  /* Every team the site knows, with the competition it plays in. */
  function allTeams() {
    if (teamIndex) return teamIndex;
    teamIndex = new Map();
    Object.values(state.leagues?.leagues || {}).forEach((l) => l.table.forEach((t) => teamIndex.set(t.team, l.league)));
    (state.pred?.matches || []).forEach((m) => [m.home, m.away].forEach((t) => { if (!teamIndex.has(t)) teamIndex.set(t, m.league); }));
    return teamIndex;
  }
  const teamChips = (list) => (list.length
    ? list.map((t) => `<span class="chip on team-chip">${esc(t)}<button type="button" data-action="team-remove" data-v="${esc(t)}" aria-label="Remove ${esc(t)}">×</button></span>`).join('')
    : '<span class="muted" style="font-size:13px">None chosen yet.</span>');
  const teamPicker = (list) => `<div class="team-picker"><input class="field" list="team-list" placeholder="Type a team name…" data-team-input autocomplete="off" aria-label="Add a favourite team">
      <div class="team-chips">${teamChips(list)}</div></div>`;

  async function saveFavs(list) {
    if (!auth.client || !auth.user) return;
    const { error } = await auth.client.auth.updateUser({ data: { favorite_teams: list.slice(0, MAX_FAVS) } });
    if (error) alert(`Could not save your teams: ${error.message}`);
  }
  /* Adding works in two places: the sign-up form (kept until the account exists) and the My teams page (saved at once). */
  function addTeam(input) {
    const name = [...allTeams().keys()].find((t) => t.toLowerCase() === input.value.trim().toLowerCase());
    if (!name) return;
    input.value = '';
    if (authEl.contains(input)) {
      if (!auth.pickTeams.includes(name) && auth.pickTeams.length < MAX_FAVS) auth.pickTeams.push(name);
      $('.team-chips', authEl).innerHTML = teamChips(auth.pickTeams);
    } else if (!favs().includes(name)) saveFavs([...favs(), name]);
  }
  function removeTeam(name, inDialog) {
    if (inDialog) {
      auth.pickTeams = auth.pickTeams.filter((t) => t !== name);
      $('.team-chips', authEl).innerHTML = teamChips(auth.pickTeams);
    } else saveFavs(favs().filter((t) => t !== name));
  }

  /* Alerts on this device: shown when GoalCast is opened and a followed team plays within a day. */
  const canNotify = () => 'Notification' in window;
  const notifyOn = () => canNotify() && Notification.permission === 'granted' && store.get('gc-notify', false);
  function notifyFavs() {
    if (!notifyOn() || !state.pred) return;
    const seen = store.get('gc-notified', []);
    favMatches().filter((m) => new Date(m.kickoff) - Date.now() < 24 * 36e5 && !seen.includes(m.id)).slice(0, 3).forEach((m) => {
      const t = m.tips['1X2'];
      new Notification(`${m.home} v ${m.away}`, { body: `${fmtDay(dayKey(m.kickoff))} ${fmtTime(m.kickoff)} · ${m.league}\nPrediction: ${label(t.sel, m)} (${pct(t.p)})`, icon: `${BASE}assets/brand/goalcast-icon-lime.png`, tag: m.id });
      seen.push(m.id);
    });
    store.set('gc-notified', seen.slice(-200));
  }

  function viewMyTeams() {
    const head = `<div class="page-head"><span class="eyebrow">★ Members</span><h1>My teams</h1><p>Follow up to ${MAX_FAVS} teams. Their matches are starred across the site and collected here with the model's predictions.</p></div>`;
    if (!auth.user) {
      return `${head}<div class="note">Sign in to follow teams. It is free.</div>
        <div class="hero-cta"><button class="btn primary" data-action="auth-open" data-v="signup">Create free account</button><button class="btn" data-action="auth-open" data-v="signin">Sign in</button></div>`;
    }
    const list = favs(), matches = favMatches();
    const alerts = !canNotify() ? '<p class="muted">This browser does not support alerts.</p>'
      : Notification.permission === 'denied' ? '<p class="muted">Alerts are blocked for this site in your browser settings. Allow notifications there to switch them on.</p>'
        : `<button class="btn ${notifyOn() ? '' : 'primary'}" data-action="notify-toggle">${notifyOn() ? 'Turn alerts off on this device' : 'Turn alerts on for this device'}</button>`;
    return `${head}
      <div class="panel" style="margin-top:18px"><h3>Teams you follow</h3><p>Start typing and pick a team from the list.</p>${teamPicker(list)}</div>
      <div class="panel" style="margin-top:12px"><h3>Match alerts</h3><p>When you open GoalCast, this device shows an alert for any followed team playing in the next 24 hours.</p>${alerts}</div>
      <div class="section-head"><h2>Upcoming matches</h2></div>
      ${matches.length ? `<div class="grid">${matches.map(card).join('')}</div>`
        : `<p class="empty">${list.length ? 'None of your teams has a match listed in the next ten days.' : 'Follow a team to see its matches here.'}</p>`}`;
  }

  /* ---------- markets, leagues, premium ---------- */
  const line = (sel) => (m) => ({ sel, p: m.sels[sel] });
  const MARKETS = [
    { slug: '1x2', name: '1X2', title: 'Match result predictions', stat: '1X2', get: (m) => m.tips['1X2'] },
    { slug: 'double-chance', name: 'Double chance', title: 'Double chance predictions', stat: 'DC', get: (m) => m.tips.DC },
    { slug: 'over-1-5', name: 'Over 1.5 goals', title: 'Over 1.5 goals predictions', get: line('O1.5') },
    { slug: 'over-2-5', name: 'Over 2.5 goals', title: 'Over 2.5 goals predictions', get: line('O2.5') },
    { slug: 'under-3-5', name: 'Under 3.5 goals', title: 'Under 3.5 goals predictions', get: line('U3.5') },
    { slug: 'btts', name: 'Both teams to score', title: 'Both teams to score predictions', stat: 'BTTS', get: (m) => m.tips.BTTS },
    { slug: 'correct-score', name: 'Correct score', title: 'Correct score predictions', stat: 'CS', get: (m) => m.tips.CS },
  ];
  const marketChips = (active) => `<div class="chips" style="margin:16px 0">${MARKETS.map((k) => `<a class="chip ${k.slug === active ? 'on' : ''}" href="#/market/${k.slug}">${k.name}</a>`).join('')}
    <a class="chip" href="#/safe">Safe tips</a><a class="chip" href="#/value">Model vs market</a></div>`;

  function viewMarket(slug) {
    const k = MARKETS.find((x) => x.slug === slug) || MARKETS[0];
    const s = k.stat && marketStat(k.stat);
    const rows = upcoming().map((m) => ({ m, t: k.get(m) })).sort((a, b) => b.t.p - a.t.p);
    return `<div class="page-head"><h1>${k.title}</h1><p>Every upcoming match, most likely first. Probabilities come from the same scoreline distribution as every other market on the site.</p></div>
      ${marketChips(k.slug)}
      ${s ? `<div class="note"><strong>${pct(s.rate, 1)} landed</strong> on the holdout year — ${int(s.hits)} of ${int(s.n)} picks in this market (the model expected ${pct(s.avg_p, 1)}).</div>` : ''}
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Match</th><th>Kick-off</th><th>Prediction</th><th class="r">Probability</th><th class="r">Fair odds</th><th></th></tr></thead><tbody>
        ${rows.map(({ m, t }) => `<tr class="click" data-action="open" data-id="${m.id}"><td>${matchCell(m)}</td><td>${whenCell(m)}</td><td><strong>${esc(label(t.sel, m))}</strong></td>
          <td class="r num">${pct(t.p, 1)}</td><td class="r num">${fair(t.p)}</td><td class="r">${addBtn(m, t.sel)}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="empty">No upcoming fixtures in the feed right now.</p>'}`;
  }

  const leaderLine = (div) => { const t = state.leagues?.leagues?.[div]?.table?.[0]; return t ? `Leaders: <strong>${esc(t.team)}</strong> · ${t.pts} pts` : 'Season not started'; };
  function viewLeagues() {
    const counts = {};
    upcoming().forEach((m) => { counts[m.div] = (counts[m.div] || 0) + 1; });
    const leagues = state.res.backtest.by_league.slice().sort((a, b) => a.country.localeCompare(b.country) || a.league.localeCompare(b.league));
    return `<div class="page-head"><h1>Leagues</h1><p>Pick a league for its standings, top scorers, top assists and upcoming predictions. ${leagues.length} leagues are covered.</p></div>
      <div class="tiles" style="margin-top:18px">${leagues.map((l) => `<a class="tile link" href="#/league/${l.div}"><h3>${esc(l.country)}</h3><b class="with-crest" style="font-size:19px">${leagueLogo(l.div, 28)}${esc(l.league)}</b>
        <p>${leaderLine(l.div)}</p><p>${counts[l.div] ? `${counts[l.div]} upcoming` : 'No fixtures listed yet'} · ${pct(l.rate, 1)} model accuracy</p><div class="meter"><i style="width:${l.rate * 100}%"></i></div></a>`).join('')}</div>
      <div class="section-head"><h2>International</h2></div>
      <div class="tiles">${Object.entries(REGIONS).map(([k, v]) => { const n = upcoming().filter((m) => m.intl && m.country === v).length; const r = state.res.intl?.regions?.[v];
        return `<a class="tile link" href="#/intl/${k}"><h3>Club cups and national teams</h3><b style="font-size:19px">${v}</b><p>${n ? `${n} upcoming` : 'No fixtures listed yet'}${r ? ` · ${pct(r.rate, 1)} model accuracy` : ''}</p></a>`; }).join('')}</div>`;
  }

  function viewLeague(div) {
    const all = state.leagues?.leagues || {};
    const L = all[div];
    if (!L) return viewLeagues();
    const fixtures = upcoming().filter((m) => m.div === div);
    const acc = state.res.backtest.by_league.find((l) => l.div === div);
    const options = Object.entries(all).sort((a, b) => a[1].country.localeCompare(b[1].country) || a[1].tier - b[1].tier)
      .map(([k, v]) => `<option value="${k}" ${k === div ? 'selected' : ''}>${esc(v.country)} · ${esc(v.league)}</option>`).join('');
    const players = (rows, key, other, title, hint) => `<div class="panel"><h3>${title}</h3><p>${hint}</p>
      ${rows.length ? `<div class="table-wrap flat"><table class="players"><thead><tr><th>#</th><th>Player</th><th class="r" title="Matches played">MP</th><th class="r">${key === 'goals' ? 'Goals' : 'Assists'}</th><th class="r">${other === 'goals' ? 'Goals' : 'Assists'}</th></tr></thead><tbody>
        ${rows.map((p, i) => `<tr><td class="num muted">${i + 1}</td><td><strong>${esc(p.player)}</strong><br><span class="muted with-crest">${crest(p.team, 16)}${esc(p.team)}</span></td><td class="r num">${p.apps}</td><td class="r num"><strong>${p[key]}</strong></td><td class="r num muted">${p[other]}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">No player statistics available for this league yet.</p>'}</div>`;
    return `<div class="page-head"><span class="eyebrow">${esc(L.country)} · ${esc(L.season)}</span><h1 class="with-crest">${leagueLogo(div, 52)}${esc(L.league)}</h1>
        <p>${L.table.length} clubs · ${fixtures.length ? `${fixtures.length} upcoming predictions` : 'no fixtures listed yet'}${acc ? ` · model picked the right result in ${pct(acc.rate, 1)} of ${int(acc.n)} holdout matches here` : ''}.</p></div>
      <div class="filters" style="margin-top:16px"><select class="field" data-change-league aria-label="Switch league">${options}</select>
        <div class="chips"><button class="chip" data-action="jump" data-v="league-table">Standings</button><button class="chip" data-action="jump" data-v="league-scorers">Top scorers</button><button class="chip" data-action="jump" data-v="league-assists">Top assists</button>${fixtures.length ? '<button class="chip" data-action="jump" data-v="league-fixtures">Fixtures</button>' : ''}</div></div>
      <div class="section-head" id="league-table"><h2>Standings</h2></div>
      ${L.table.length ? `<div class="table-wrap"><table class="standings"><thead><tr><th>#</th><th>Club</th><th class="r" title="Played">P</th><th class="r" title="Won">W</th><th class="r" title="Drawn">D</th><th class="r" title="Lost">L</th><th class="r" title="Goals for">GF</th><th class="r" title="Goals against">GA</th><th class="r" title="Goal difference">GD</th><th class="r">Pts</th><th>Form</th></tr></thead><tbody>
        ${L.table.map((t) => `<tr><td class="num muted">${t.pos}</td><td><span class="with-crest">${crest(t.team, 22)}<strong>${esc(t.team)}</strong></span></td><td class="r num">${t.p}</td><td class="r num">${t.w}</td><td class="r num">${t.d}</td><td class="r num">${t.l}</td><td class="r num">${t.gf}</td><td class="r num">${t.ga}</td><td class="r num">${t.gd > 0 ? '+' : ''}${t.gd}</td><td class="r num"><strong>${t.pts}</strong></td><td>${formDots(t.form)}</td></tr>`).join('')}
        </tbody></table></div><p class="muted" style="font-size:13px">Calculated from match results: points, then goal difference, then goals scored. Points deductions and league-specific tie-breakers are not applied.</p>`
        : '<p class="empty">No matches played yet this season.</p>'}
      <div class="two" style="margin-top:8px">
        <div id="league-scorers">${players(L.scorers, 'goals', 'assists', 'Top scorers', 'League goals this season.')}</div>
        <div id="league-assists">${players(L.assists, 'assists', 'goals', 'Top assists', 'League assists this season.')}</div>
      </div>
      ${L.players_updated ? `<p class="muted" style="font-size:13px">Player statistics: ESPN, updated ${new Date(L.players_updated).toLocaleDateString()}.</p>` : ''}
      ${fixtures.length ? `<div class="section-head" id="league-fixtures"><h2>Upcoming fixtures</h2></div><div class="grid">${fixtures.map(card).join('')}</div>` : ''}`;
  }

  /* Ready-made accumulators: add the safest legs until the fair price reaches the target. */
  const accaPool = () => upcoming().filter((m) => m.tips.SAFE && new Date(m.kickoff) - Date.now() < 72 * 36e5).sort((a, b) => b.tips.SAFE.p - a.tips.SAFE.p);
  function buildAcca(pool, target) {
    const legs = [];
    let p = 1;
    for (const m of pool) {
      if (1 / p >= target) break;
      legs.push(m);
      p *= m.tips.SAFE.p;
    }
    return 1 / p >= target ? { legs, p } : null;
  }

  /* ---------- country and currency ---------- */
  const COUNTRY_CODES = 'AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HK HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MR MU MX MD MC MN ME MA MZ MM NA NP NL NZ NI NE NG MK NO OM PK PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA KR SS ES LK SD SR SE CH SY TW TJ TZ TH TL TG TO TT TN TR TM UG UA AE GB US UY UZ VU VE VN YE ZM ZW'.split(' ');
  const regionName = new Intl.DisplayNames(['en'], { type: 'region' });
  const COUNTRIES = COUNTRY_CODES.map((c) => [c, regionName.of(c)]).sort((a, b) => a[1].localeCompare(b[1]));
  function guessCountry() {
    try { if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'Africa/Lagos') return 'NG'; } catch { /* no time zone available */ }
    const region = (navigator.language || '').split('-')[1]?.toUpperCase();
    return COUNTRY_CODES.includes(region) ? region : '';
  }
  /* The country a member chose (when signing up, or in the payment window); a guess for visitors. */
  const myCountry = () => state.country || auth.user?.user_metadata?.country || store.get('gc-country', '') || guessCountry();
  const currency = () => (myCountry() === 'NG' ? 'NGN' : 'USD');
  const money = (amount, cur = currency()) => (cur === 'NGN' ? `₦${Math.round(amount).toLocaleString('en')}` : `$${Number.isInteger(amount) ? amount : amount.toFixed(2)}`);
  const planPrice = (p, cur = currency()) => money(p.amounts[cur], cur);
  const countrySelect = (attrs, selected) => `<select class="field" ${attrs}><option value="">Select your country</option>${COUNTRIES.map(([c, n]) => `<option value="${c}" ${c === selected ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
  function planNote(p) {
    const cur = currency(), month = PLANS.find((x) => x.id === 'monthly');
    if (p.id === 'monthly') return `Works out at ${money(p.amounts[cur] * 12 / 52, cur)} a week.`;
    if (p.id === 'yearly' && month) return `Works out at ${money(p.amounts[cur] / 12, cur)} a month. Save ${Math.round((1 - p.amounts[cur] / (month.amounts[cur] * 12)) * 100)}%.`;
    return p.note || '';
  }

  /* ---------- premium membership ---------- */
  const PLANS = window.GOALCAST_PLANS || [];
  /* A member's plan lives in their account's protected settings, which only the site owner can change. */
  function planOf() {
    const meta = auth.user?.app_metadata || {};
    if (!meta.plan || (meta.plan_until && meta.plan_until < todayKey())) return null;
    return { id: meta.plan, until: meta.plan_until || null, name: PLANS.find((p) => p.id === meta.plan)?.name || 'Premium' };
  }
  const isPremium = () => Boolean(planOf());
  /* Stake guide: more confident picks get more units, never more than three. */
  const units = (p) => (p >= 0.75 ? 3 : p >= 0.6 ? 2 : 1);
  const unitPips = (p) => `<span class="units" title="${units(p)} of 3 units">${[1, 2, 3].map((i) => `<i class="${i <= units(p) ? 'on' : ''}"></i>`).join('')}</span>`;
  const selectionTable = (rows) => `<div class="table-wrap"><table><thead><tr><th>Match</th><th>Kick-off</th><th>Selection</th><th class="r">Chance</th><th class="r">Fair odds</th><th>Stake</th><th></th></tr></thead><tbody>
      ${rows.map((m) => { const t = m.tips['1X2']; return `<tr class="click" data-action="open" data-id="${m.id}"><td>${matchCell(m)}</td><td>${whenCell(m)}</td><td><strong>${esc(label(t.sel, m))}</strong></td>
        <td class="r num">${pct(t.p, 1)}</td><td class="r num">${fair(t.p)}</td><td>${unitPips(t.p)}</td><td class="r">${addBtn(m, t.sel)}</td></tr>`; }).join('')}</tbody></table></div>`;
  const strongest = (list, n) => list.slice().sort((a, b) => b.tips['1X2'].p - a.tips['1X2'].p).slice(0, n);

  /* Special picks: fetched from the members-only table, so they exist only for accounts with an active plan. */
  async function loadPremium() {
    const api = (cfg.neonDataApi || '').replace(/\/+$/, '');
    if (!isPremium()) { state.premium = null; return; }
    if (!api) state.premium = { missing: true };
    else try {
      const { data } = await auth.client.auth.getSession();
      const r = await fetch(`${api}/premium_content?id=eq.picks&select=payload`, { headers: { Authorization: `Bearer ${data.session?.access_token}`, Accept: 'application/json' } });
      const rows = r.ok ? await r.json() : [];
      state.premium = rows[0]?.payload || { missing: true };
    } catch {
      state.premium = { missing: true };
    }
    if (currentRoute().split('/')[0] === 'premium') render(true);
  }
  const specialRow = (e) => `<tr class="click" data-action="open" data-id="${e.id}"><td><strong>${esc(e.home)} v ${esc(e.away)}</strong><br><span class="muted">${esc(e.league)}</span></td>
      <td>${fmtDay(dayKey(e.kickoff))} ${fmtTime(e.kickoff)}<br><span class="muted">${countdown(e.kickoff)}</span></td><td><strong>${esc(e.label)}</strong></td>
      <td class="r num">${pct(e.p, 1)}</td><td class="r num">${fair(e.p)}</td><td>${unitPips(e.p)}</td></tr>`;
  function specialPicks() {
    const P = state.premium;
    if (!P) return '<p class="empty">Loading your special picks…</p>';
    if (P.missing) return '<div class="note warn">Special picks are being prepared and will appear here shortly.</div>';
    const now = new Date().toISOString();
    const days = P.days.map((d) => ({ ...d, picks: d.picks.filter((e) => e.kickoff > now) })).filter((d) => d.picks.length);
    const r = P.record?.picks;
    return `${r ? `<div class="note"><strong>${pct(r.rate, 1)} of special picks landed</strong> on a year of matches the model had never seen (${int(r.hits)} of ${int(r.n)}; it expected ${pct(r.expected, 1)}). That still means roughly ${Math.round((1 - r.rate) * 10)} in ten lose.</div>` : ''}
      ${days.length ? days.map((d) => `<h3 class="day-label">${fmtDay(d.date)} · ${d.picks.length} special picks</h3>
        <div class="table-wrap"><table><thead><tr><th>Match</th><th>Kick-off</th><th>Special pick</th><th class="r">Chance</th><th class="r">Fair odds</th><th>Stake</th></tr></thead><tbody>${d.picks.map(specialRow).join('')}</tbody></table></div>`).join('')
        : '<p class="empty">No special picks for the next few days yet. New ones are added twice a day.</p>'}
      <div class="two" style="margin-top:16px">
        ${P.treble && P.treble.legs.every((e) => e.kickoff > now) ? `<div class="panel"><h3>⭐ Special treble</h3><p>${pct(P.treble.p, 1)} chance all three land · fair odds ${fair(P.treble.p)}</p>
          <ul class="list">${P.treble.legs.map((e) => `<li><span><strong>${esc(e.label)}</strong><br><span class="muted">${esc(e.home)} v ${esc(e.away)}</span></span><span class="num">${pct(e.p)}</span></li>`).join('')}</ul></div>` : ''}
        ${P.long && P.long.kickoff > now ? `<div class="panel"><h3>🎲 Big-price pick</h3><p>A long shot: more likely to lose than win, at a bigger price.</p>
          <ul class="list"><li><span><strong>${esc(P.long.label)}</strong><br><span class="muted">${esc(P.long.home)} v ${esc(P.long.away)} · ${fmtDay(dayKey(P.long.kickoff))} ${fmtTime(P.long.kickoff)}</span></span><span class="num">${pct(P.long.p)} · fair odds ${fair(P.long.p)}</span></li></ul>
          ${P.record?.long ? `<p class="muted" style="margin-top:8px">Picks like this landed ${pct(P.record.long.rate, 1)} of the time on the holdout year.</p>` : ''}</div>` : ''}
      </div>`;
  }

  function premiumMembers(plan) {
    const all = upcoming();
    const today = strongest(all.filter((m) => dayKey(m.kickoff) === todayKey()), 6);
    const weekend = strongest(all.filter((m) => [0, 6].includes(new Date(m.kickoff).getDay()) && new Date(m.kickoff) - Date.now() < 7 * 864e5), 8);
    const pool = accaPool();
    const banker = pool[0];
    const accas = [2, 3, 5].map((target) => ({ target, acca: buildAcca(pool, target) })).filter((x) => x.acca);
    const s = marketStat('SAFE'), x = marketStat('1X2');
    return `<div class="page-head"><span class="eyebrow">★ ${esc(plan.name)} member</span><h1>Premium</h1>
        <p>Signed in as ${esc(displayName())}.${plan.until ? ` Your membership runs until ${longDate(plan.until)}.` : ''}</p></div>
      ${banker ? `<div class="totd" data-action="open" data-id="${banker.id}" tabindex="0" style="margin:18px 0 6px">
        <span class="tag" style="background:none;padding:0">★ BANKER OF THE DAY · ${fmtDay(dayKey(banker.kickoff)).toUpperCase()} ${fmtTime(banker.kickoff)}</span>
        <div class="teams">${esc(banker.home)} v ${esc(banker.away)}</div><div class="muted">${esc(banker.league)} · ${countdown(banker.kickoff)}</div>
        <div class="big"><b>${pct(banker.tips.SAFE.p)}</b><span><strong>${esc(label(banker.tips.SAFE.sel, banker))}</strong><br><span class="muted">fair odds ${fair(banker.tips.SAFE.p)}</span></span></div></div>` : ''}
      <div class="section-head"><h2>⭐ Special picks <span class="badge won">Members only</span></h2></div>
      ${specialPicks()}
      <div class="section-head"><h2>🎯 Today's selections</h2></div>
      ${today.length ? selectionTable(today) : '<p class="empty">No matches today. See the weekend selections below.</p>'}
      <div class="section-head"><h2>🎯 Weekend selections</h2></div>
      ${weekend.length ? selectionTable(weekend) : '<p class="empty">Weekend fixtures appear here from midweek.</p>'}
      <div class="section-head"><h2>🏆 Accumulator analysis</h2></div>
      ${accas.length ? `<div class="tiles" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${accas.map(({ target, acca }) => `<div class="panel"><h3>${target} odds accumulator</h3>
        <p>${acca.legs.length} legs · ${pct(acca.p, 1)} chance all land · fair odds ${fair(acca.p)}</p>
        <ul class="list">${acca.legs.map((m) => `<li><span><strong>${esc(label(m.tips.SAFE.sel, m))}</strong><br><span class="muted">${esc(m.home)} v ${esc(m.away)}</span></span><span class="num">${pct(m.tips.SAFE.p)}</span></li>`).join('')}</ul>
        <button class="btn small" style="margin-top:12px" data-action="acca-load" data-v="${target}">Load into slip</button></div>`).join('')}</div>` : '<p class="empty">Not enough safe selections in the next three days to build accumulators.</p>'}
      <div class="two" style="margin-top:22px">
        <div class="panel"><h3>💡 Staking guide</h3><p>How to read the stake bars beside each selection.</p>
          <ul class="list"><li><span>${unitPips(0.8)} 3 units</span><span class="muted">75% chance or higher</span></li><li><span>${unitPips(0.65)} 2 units</span><span class="muted">60% to 75%</span></li><li><span>${unitPips(0.5)} 1 unit</span><span class="muted">below 60%</span></li></ul>
          <p style="margin-top:10px">Treat one unit as about 1% of the money you have set aside for betting, and never raise stakes to chase a loss. This is a way to keep stakes consistent, not a promise of profit.</p></div>
        <div class="panel"><h3>📈 The record</h3><p>Measured on a year of matches the model had never seen.</p>
          <ul class="list"><li><span>Match-result picks</span><strong class="num">${pct(x.rate, 1)} of ${int(x.n)}</strong></li><li><span>Safe tips</span><strong class="num">${pct(s.rate, 1)} of ${int(s.n)}</strong></li></ul>
          <p style="margin-top:10px"><a href="#/results">See every result, wins and losses</a> · <a href="#/my-teams">Set up alerts for your teams</a></p></div>
      </div>`;
  }

  const FEATURES = [
    ['⭐', 'Special picks', 'Members-only selections from combination markets you will not find on the free site, such as a win with goals or a win to nil.', true],
    ['📊', 'Match statistics and analysis', 'Full breakdown of every match: all markets, scoreline chances, form and head-to-head.', true],
    ['🎯', 'Daily and weekend selections', "The model's strongest picks for today and for the weekend, in one list.", true],
    ['🏆', 'Accumulator analysis', 'Ready-made combinations with the true chance that every leg lands.', true],
    ['💡', 'Staking guide', 'A suggested stake size beside each selection, to keep your betting consistent.', true],
    ['🔔', 'Alerts for your teams', 'Follow up to 20 teams and get an alert on your device before they play.', true],
    ['📈', 'Transparent results tracking', 'Every selection is logged before kick-off and its result published, win or lose.', true],
    ['📲', 'Telegram and WhatsApp alerts', 'Selections sent straight to your phone.', false],
  ];

  function premiumSales() {
    const s = marketStat('SAFE');
    const card = (p) => `<div class="plan ${p.badge ? 'featured' : ''}">${p.badge ? `<span class="plan-badge">${esc(p.badge)}</span>` : ''}
        <h3>${esc(p.name)}</h3><div class="plan-price"><b>${planPrice(p)}</b><span>/ ${esc(p.per)}</span></div>
        <p class="plan-note">${esc(planNote(p) || ' ')}</p>
        <button class="btn ${p.badge ? 'primary' : 'outline'}" data-action="plan-choose" data-v="${esc(p.id)}">Choose ${esc(p.name.toLowerCase())}</button></div>`;
    const paid = new URLSearchParams(location.search).has('paid');
    return `${paid ? '<div class="note" style="margin-top:18px"><strong>Thank you. Your payment is being confirmed.</strong> Premium switches on for your account as soon as it clears. <button class="linkish" data-action="plan-refresh">Refresh my access</button></div>' : ''}<div class="page-head premium-head"><span class="eyebrow">★ GoalCast Premium</span><h1>Go deeper on every match.</h1>
        <p>Daily and weekend selections, accumulator analysis, a staking guide and alerts for your teams. No promises of guaranteed wins: you can check our full record, losses included, before you join.</p></div>
      <div class="plans">
        <div class="plan"><h3>Free</h3><div class="plan-price"><b>${money(0)}</b></div><p class="plan-note">Match-result predictions, league tables and results.</p>
          ${auth.user ? '<button class="btn" disabled>Your current plan</button>' : '<button class="btn outline" data-action="auth-open" data-v="signup">Create free account</button>'}</div>
        ${PLANS.map(card).join('')}
      </div>
      ${state.res.premium?.picks ? `<div class="note" style="margin-top:22px"><strong>Special picks landed ${pct(state.res.premium.picks.rate, 1)} of the time</strong> across ${int(state.res.premium.picks.n)} picks on a year of matches the model had never seen. The model expected ${pct(state.res.premium.picks.expected, 1)}. No pick is guaranteed.</div>` : ''}
      <div class="section-head"><h2>What members receive</h2></div>
      <div class="features">${FEATURES.map(([icon, title, text, live]) => `<div class="feature"><span class="feature-icon">${icon}</span><div><strong>${title}${live ? '' : ' <span class="badge pending">Coming soon</span>'}</strong><p>${text}</p></div></div>`).join('')}</div>
      <div class="two" style="margin-top:22px">
        <div class="panel"><h3>How joining works</h3><ol class="steps-list"><li>Create a free account, or sign in.</li><li>Choose a plan${PAYMENTS.some((m) => payHere(m) && (viaPaystack(m) || m.address || Object.values(m.links || {}).some(Boolean))) ? ' and pay online' : ' and message us to arrange payment'}.</li><li>Premium switches on for your account and you get full access.</li></ol>
          <p class="muted" style="margin-top:8px">Plans do not renew automatically. You decide whether to continue when yours ends.</p></div>
        <div class="panel"><h3>Straight answers</h3>
          <p><strong>Do you guarantee wins?</strong> No. Nobody honestly can. Safe tips landed ${pct(s.rate, 1)} of the time on a year of unseen matches, which still means some lose. <a href="#/results">See the record</a>.</p>
          <p><strong>Who is it for?</strong> Adults aged 18 and over who bet for entertainment and want better information. Please read our <a href="#/responsible-gambling">responsible gambling</a> page.</p></div>
      </div>
      ${auth.user ? '<p class="muted" style="margin-top:16px">Already paid? <button class="linkish" data-action="plan-refresh">Refresh my access</button></p>' : ''}`;
  }

  function viewPremium() {
    const plan = planOf();
    return plan ? premiumMembers(plan) : premiumSales();
  }

  /* Until card payments are connected, joining is arranged by message; the owner then switches the plan on. */
  /* Ways to pay, from site/config.js. A method is offered once it has a payment link for the plan (card and
     bank methods) or a wallet address (crypto), and only in the countries it is meant for. */
  const PAYMENTS = window.GOALCAST_PAYMENTS || [];
  const PAYSTACK = window.GOALCAST_PAYSTACK || {};
  const viaPaystack = (m) => m.provider === 'paystack' && Boolean(PAYSTACK.publicKey) && (PAYSTACK.currencies || ['NGN']).includes(m.currency);
  const payReady = (m, p) => viaPaystack(m) || Boolean(m.links?.[p.id] || m.address);
  const payHere = (m) => { const c = myCountry(); return (!m.only || m.only.includes(c)) && (!m.except || !m.except.includes(c)); };
  const payMethods = (p) => PAYMENTS.filter((m) => payHere(m) && payReady(m, p));
  const payPrice = (m, p) => (m.currency === 'USDT' ? `${p.amounts.USD.toFixed(2)} USDT` : money(p.amounts[m.currency], m.currency));
  function checkoutUrl(link) {
    const url = new URL(link);  // carries the account so the payment can be matched to it
    url.searchParams.set('prefilled_email', auth.user.email);
    url.searchParams.set('email', auth.user.email);
    url.searchParams.set('client_reference_id', auth.user.id || '');
    return url.toString();
  }
  function contactOptions(text, subject) {
    const links = window.GOALCAST_LINKS || {}, email = (state.sponsors?.advertise || {}).email;
    return [
      links.whatsapp && ['WhatsApp', `https://wa.me/${String(links.whatsapp).replace(/\D/g, '')}?text=${encodeURIComponent(text)}`],
      links.telegramSupport && ['Telegram', linkFor.telegram(String(links.telegramSupport))],
      email && ['Email', `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`],
    ].filter(Boolean);
  }
  const contactButtons = (options) => `<div class="hero-cta">${options.map(([name, href], i) => `<a class="btn ${i ? '' : 'primary'}" href="${esc(href)}" target="_blank" rel="noopener">${name}</a>`).join('')}</div>`;

  /* Paystack checkout opens over the page. Its webhook (supabase/functions/paystack-webhook) switches the plan on,
     so after paying we refresh the account until Premium appears. */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('could not load the payment window'));
      document.head.append(s);
    });
  }
  async function payWithPaystack(methodId) {
    const p = PLANS.find((x) => x.id === detailEl.dataset.plan), m = PAYMENTS.find((x) => x.id === methodId);
    if (!p || !m || !auth.user) return;
    try {
      await loadScript('https://js.paystack.co/v2/inline.js');
    } catch (err) {
      alert(`${err.message}. Please try again, or choose another way to pay.`);
      return;
    }
    detailEl.close();
    new window.PaystackPop().newTransaction({
      key: PAYSTACK.publicKey,
      email: auth.user.email,
      amount: Math.round(p.amounts[m.currency] * 100),
      currency: m.currency,
      metadata: { user_id: auth.user.id, plan: p.id, custom_fields: [{ display_name: 'Plan', variable_name: 'plan', value: `${p.name} (${planPrice(p, m.currency)})` }] },
      onSuccess: () => awaitPremium(p),
      onCancel: () => openPlan(p.id),
    });
  }
  async function awaitPremium(p) {
    detailEl.innerHTML = `<div class="d-head"><div><div class="muted">GoalCast Premium</div><h2>Payment received</h2></div><button class="x" data-action="close-detail" aria-label="Close">×</button></div>
      <div class="d-body"><div class="panel"><h3>Switching Premium on…</h3><p id="activation">Thank you. Your ${esc(p.name.toLowerCase())} plan is being switched on. This usually takes a few seconds.</p></div></div>`;
    delete detailEl.dataset.id;
    if (!detailEl.open) detailEl.showModal();
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 3000));
      await auth.client?.auth.refreshSession();
      if (isPremium()) {
        detailEl.close();
        navigate('premium');
        loadPremium();
        return;
      }
    }
    const note = $('#activation', detailEl);
    if (note) note.innerHTML = 'Your payment went through, but switching Premium on is taking longer than usual. Refresh this page in a few minutes. If it still has not switched on, message us with your payment receipt and we will sort it out straight away.';
  }

  function openPlan(id) {
    const p = PLANS.find((x) => x.id === id);
    if (!p) return;
    if (!auth.user) { auth.msg = { text: `Create a free account first, then choose the ${p.name.toLowerCase()} plan.`, ok: true }; openAuth('signup'); return; }
    const methods = payMethods(p);
    const head = `<div class="d-head"><div><div class="muted">GoalCast Premium · ${esc(auth.user.email)}</div><h2>${esc(p.name)} plan · ${planPrice(p)} per ${esc(p.per)}</h2></div><button class="x" data-action="close-detail" aria-label="Close">×</button></div>`;
    const where = `<label class="pay-country">Paying from ${countrySelect('data-change-country aria-label="Country you are paying from"', myCountry())}</label>`;
    const small = `<p class="muted" style="font-size:13px;margin:0">Predictions are probabilities, not guarantees, and some will lose. 18+ only. <a href="#/terms">Terms</a> · <a href="#/responsible-gambling">Responsible gambling</a></p>`;
    let body;
    if (!myCountry()) body = `<div class="panel"><h3>Where are you paying from?</h3><p>Choose your country to see the ways to pay there.</p>${where}</div>`;
    else if (!methods.length) {
      const text = `Hello GoalCast, I would like the ${p.name} plan (${planPrice(p)} per ${p.per}). My account email is ${auth.user.email}.`;
      body = `<div class="panel"><h3>Message us to join</h3>${where}
        <p style="margin-top:12px">Online payment is being set up for your country. For now, send us a message and we will arrange payment and switch Premium on for your account. Your plan and email are already filled in.</p>
        ${contactButtons(contactOptions(text, `GoalCast ${p.name} plan`).map(([n, h]) => [`Message on ${n}`, h]))}</div>`;
    } else {
      body = `<div class="panel"><h3>Choose how to pay</h3>${where}<div class="pay-list">${methods.map((m) => (viaPaystack(m)
        ? `<button class="pay-method" data-action="paystack" data-v="${esc(m.id)}"><span class="pay-icon">${esc(m.icon || '💳')}</span><span><strong>${esc(m.label)}</strong><small>${esc(m.sub || '')}</small></span><b>${payPrice(m, p)} →</b></button>`
        : m.links
        ? `<a class="pay-method" href="${esc(checkoutUrl(m.links[p.id]))}"><span class="pay-icon">${esc(m.icon || '💳')}</span><span><strong>${esc(m.label)}</strong><small>${esc(m.sub || '')}</small></span><b>${payPrice(m, p)} →</b></a>`
        : `<details class="pay-method crypto"><summary><span class="pay-icon">${esc(m.icon || '🪙')}</span><span><strong>${esc(m.label)}</strong><small>${esc(m.sub || '')}</small></span><b>${payPrice(m, p)}</b></summary>
            <div class="pay-crypto"><p>Send exactly <strong>${payPrice(m, p)}</strong> on the <strong>${esc(m.network)}</strong> network to this address:</p>
              <div class="pay-address"><code>${esc(m.address)}</code><button class="btn small" data-action="copy" data-v="${esc(m.address)}">Copy</button></div>
              <p class="muted">Use only the ${esc(m.network)} network. Coins sent on another network cannot be recovered. Crypto payments cannot be reversed.</p>
              <p><strong>After sending,</strong> tell us the transaction ID so we can switch Premium on:</p>
              ${contactButtons(contactOptions(`Hello GoalCast, I have paid ${payPrice(m, p)} for the ${p.name} plan (${m.network}). My account email is ${auth.user.email}. Transaction ID: `, `GoalCast ${p.name} plan: crypto payment`))}</div></details>`)).join('')}</div></div>`;
    }
    detailEl.innerHTML = `${head}<div class="d-body">${body}${small}</div>`;
    delete detailEl.dataset.id;
    detailEl.dataset.plan = id;
    if (!detailEl.open) detailEl.showModal();
  }
  /* Changing country updates the prices and the ways to pay at once, and is remembered on the account. */
  function setCountry(code) {
    state.country = code;
    store.set('gc-country', code);
    if (auth.user && auth.client) auth.client.auth.updateUser({ data: { country: code } });
    render(true);
    if (detailEl.open && detailEl.dataset.plan) openPlan(detailEl.dataset.plan);
  }

  /* ---------- navigation ---------- */
  function renderNav() {
    const days = [...new Set(upcoming().map((m) => dayKey(m.kickoff)))].slice(0, 8);
    const byCountry = {};
    state.res.backtest.by_league.forEach((l) => { (byCountry[l.country] ||= []).push(l); });
    const dd = (name, key, body) => `<details class="dd" data-group="${key}"><summary>${name}</summary><div class="menu">${body}</div></details>`;
    $('#nav').innerHTML = routed(`<a href="#/" data-route="">Predictions</a>
      ${dd('Markets', 'market', `${MARKETS.map((k) => `<a href="#/market/${k.slug}">${k.name}</a>`).join('')}<hr><a href="#/safe">Safe tips</a><a href="#/value">Model vs market</a>`)}
      ${dd('By day', 'day', days.length ? days.map((d) => `<a href="#/day/${d}">${fmtDay(d)}</a>`).join('') : '<span class="muted">No fixtures listed</span>')}
      ${dd('Leagues', 'league', `<div class="menu-cols">${Object.keys(byCountry).sort().map((c) => `<div><h4>${esc(c)}</h4>${byCountry[c].map((l) => `<a href="#/league/${l.div}">${esc(l.league)}</a>`).join('')}</div>`).join('')}</div><hr><a href="#/leagues">All leagues</a>`)}
      ${dd('International', 'intl', Object.entries(REGIONS).map(([k, v]) => `<a href="#/intl/${k}">${v}</a>`).join(''))}
      <a href="#/results" data-route="results">Results</a>
      <a href="#/model" data-route="model">Model</a>
      <a href="#/blog" data-route="blog">Blog</a>
      <a href="#/premium" data-route="premium" class="premium">★ Premium</a>`);
  }
  const closeMenus = (except) => document.querySelectorAll('details.dd[open]').forEach((d) => { if (d !== except) d.open = false; });

  /* ---------- accounts (Supabase Auth) ---------- */
  const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  const cfg = window.GOALCAST_CONFIG || {};
  const auth = { client: null, user: null, mode: 'signin', msg: null, busy: false, pickTeams: [] };
  const authEl = $('#auth');
  const displayName = () => auth.user?.user_metadata?.display_name || auth.user?.email?.split('@')[0] || 'Member';
  const redirectTo = () => location.origin + BASE;

  function renderAccount() {
    $('#account').innerHTML = routed(auth.user
      ? `<details class="dd right"><summary class="avatar" aria-label="Account menu">${esc(displayName()[0].toUpperCase())}</summary><div class="menu">
          <span class="muted" style="padding:6px 10px;display:block">${esc(auth.user.email)}</span><hr>${isPremium() ? `<span class="badge won" style="margin:4px 10px">★ ${esc(planOf().name)}</span>` : ''}<a href="#/my-teams">My teams${favMatches().length ? ` · ${favMatches().length} upcoming` : ''}</a><a href="#/premium">★ Premium</a><button data-action="sign-out">Sign out</button></div></details>`
      : `<button class="btn outline btn-login" data-action="auth-open" data-v="signin">Log in</button><button class="btn primary" data-action="auth-open" data-v="signup">Sign up</button>`);
  }

  function openAuth(mode, keep = {}) {
    auth.mode = mode || 'signin';
    const m = auth.mode;
    const titles = { signin: 'Sign in', signup: 'Create your account', reset: 'Reset your password', newpass: 'Choose a new password' };
    const actions = { signin: 'Sign in', signup: 'Create account', reset: 'Email me a reset link', newpass: 'Save new password' };
    const field = (name, lbl, type, extra = '') => `<label>${lbl}<input class="field" name="${name}" type="${type}" required ${extra}></label>`;
    authEl.innerHTML = `<form id="auth-form" novalidate>
      <div class="d-head" style="position:static;border:0;padding:0 0 4px;background:none"><h2>${titles[m]}</h2><button type="button" class="x" data-action="auth-close" aria-label="Close">×</button></div>
      ${m === 'signin' || m === 'signup' ? `<div class="tabs" style="margin-bottom:6px"><button type="button" data-action="auth-open" data-v="signin" class="${m === 'signin' ? 'on' : ''}">Sign in</button><button type="button" data-action="auth-open" data-v="signup" class="${m === 'signup' ? 'on' : ''}">Create account</button></div>` : ''}
      ${m === 'signup' ? field('name', 'Name', 'text', 'autocomplete="name" maxlength="60"') : ''}
      ${m === 'signup' ? `<label>Country${countrySelect('name="country" required autocomplete="country"', keep.country || myCountry())}</label>` : ''}
      ${m !== 'newpass' ? field('email', 'Email', 'email', 'autocomplete="email"') : ''}
      ${m !== 'reset' ? field('password', m === 'newpass' ? 'New password' : 'Password', 'password', `autocomplete="${m === 'signin' ? 'current-password' : 'new-password'}"`) : ''}
      ${m !== 'reset' ? `<label class="check"><input type="checkbox" data-show-password ${auth.showPassword ? 'checked' : ''}> Show password</label>` : ''}
      ${m === 'signup' || m === 'newpass' ? '<p class="muted" style="font-size:12.5px;margin:0">At least 8 characters. <span id="pw-count"></span></p>' : ''}
      ${m === 'signup' ? `<div class="pick-teams"><span>Favourite teams <small>(optional)</small></span>${teamPicker(auth.pickTeams)}<small>We will star their matches and collect them for you.</small></div>` : ''}
      ${auth.msg ? `<p class="auth-msg ${auth.msg.ok ? 'ok' : 'err'}" role="alert">${esc(auth.msg.text)}</p>` : ''}
      <button class="btn primary" type="submit" ${auth.busy ? 'disabled' : ''}>${auth.busy ? 'Please wait…' : actions[m]}</button>
      ${m === 'signin' ? '<button type="button" class="linkish" data-action="auth-open" data-v="reset">Forgot your password?</button>' : ''}
      ${m === 'reset' ? '<button type="button" class="linkish" data-action="auth-open" data-v="signin">Back to sign in</button>' : ''}
      ${m === 'signup' ? '<p class="muted" style="font-size:12px;margin:0">18+ only. We store your email to sign you in and nothing else.</p>' : ''}
    </form>`;
    for (const name of ['name', 'email', 'password']) { const box = authEl.querySelector(`[name=${name}]`); if (box && keep[name]) box.value = keep[name]; }
    syncPassword();
    if (!authEl.open) authEl.showModal();
    authEl.querySelector('input')?.focus();
  }

  /* Keeps the password box in step with the "Show password" tick and the character count. */
  function syncPassword() {
    const box = authEl.querySelector('[name=password]');
    if (!box) return;
    box.type = auth.showPassword ? 'text' : 'password';
    const count = $('#pw-count', authEl);
    if (count) count.textContent = box.value.length ? `You have typed ${box.value.length}.` : '';
  }

  async function submitAuth(form) {
    const v = Object.fromEntries(new FormData(form));
    const valid = form.checkValidity();
    const say = (text, ok = false) => { auth.msg = { text, ok }; auth.busy = false; openAuth(auth.mode, v); };
    if (!auth.client) return say('Accounts are not switched on yet. The site owner needs to add the sign-in settings in config.js.');
    if (auth.mode === 'signup' && !v.country) return say('Please select your country.');
    if ((auth.mode === 'signup' || auth.mode === 'newpass') && v.password.length < 8) return say(`Passwords need at least 8 characters. Yours has ${v.password.length}.`);
    if (!valid) return say('Please fill in every field with a valid value.');
    auth.busy = true; auth.msg = null; openAuth(auth.mode, v);
    const a = auth.client.auth;
    try {
      if (auth.mode === 'signup') {
        const { data, error } = await a.signUp({ email: v.email, password: v.password, options: { data: { display_name: v.name.trim(), country: v.country, favorite_teams: auth.pickTeams }, emailRedirectTo: redirectTo() } });
        if (error) throw error;
        auth.pickTeams = [];
        state.country = v.country;
        store.set('gc-country', v.country);
        if (!data.session) return say('Almost there: we sent a confirmation link to your email. Open it to finish creating your account.', true);
      } else if (auth.mode === 'signin') {
        const { error } = await a.signInWithPassword({ email: v.email, password: v.password });
        if (error) throw error;
      } else if (auth.mode === 'reset') {
        const { error } = await a.resetPasswordForEmail(v.email, { redirectTo: redirectTo() });
        if (error) throw error;
        return say('If that email has an account, a reset link is on its way.', true);
      } else {
        const { error } = await a.updateUser({ password: v.password });
        if (error) throw error;
      }
      auth.busy = false; auth.msg = null;
      authEl.close();
    } catch (err) {
      say(err.message || 'Something went wrong. Please try again.');
    }
  }

  async function initAuth() {
    renderAccount();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return;
    try {
      if (!window.supabase) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = SUPABASE_CDN; s.onload = resolve; s.onerror = () => reject(new Error('could not load the sign-in library'));
          document.head.append(s);
        });
      }
      auth.client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
      auth.client.auth.onAuthStateChange((event, session) => {
        auth.user = session?.user ?? null;
        renderAccount();
        if (state.pred) render(true);
        if (event === 'PASSWORD_RECOVERY') { auth.msg = null; openAuth('newpass'); }
        notifyFavs();
        loadPremium();
      });
    } catch (err) {
      console.error('GoalCast accounts unavailable:', err);
    }
  }

  /* ---------- social & support links ---------- */
  const ICONS = {
    x: '<path d="M18.9 2H22l-7.2 8.3L23 22h-6.6l-5.1-6.7L5.4 22H2.3l7.7-8.8L1.5 2h6.7l4.6 6.2L18.9 2zm-1.1 18h1.8L7.2 3.9H5.3L17.8 20z"/>',
    telegram: '<path d="M21.9 4.3 18.7 19.6c-.2 1.1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.3-5 9-8.1c.4-.3-.1-.5-.6-.2L6.2 13.3l-4.8-1.5c-1-.3-1-1 .2-1.5L20.5 3c.9-.3 1.6.2 1.4 1.3z"/>',
    whatsapp: '<path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-2.9-.4-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z"/><path d="M9.2 7.4 10.3 9.6 9.4 10.6C10.1 11.9 11.1 12.9 12.4 13.6L13.4 12.7 15.6 13.8C15.7 15 14.7 16 13.5 15.9 10.4 15.6 7.4 12.6 7.1 9.5 7 8.3 8 7.3 9.2 7.4Z"/>',
  };
  const handle = (v) => String(v || '').trim().replace(/^@/, '');
  const linkFor = {
    x: (v) => (/^https:\/\//.test(v) ? v : `https://x.com/${encodeURIComponent(handle(v))}`),
    telegram: (v) => (/^https:\/\//.test(v) ? v : `https://t.me/${encodeURIComponent(handle(v))}`),
    whatsapp: (v) => (/^https:\/\//.test(v) ? v : `https://wa.me/${String(v).replace(/\D/g, '')}`),
  };
  function renderFootLinks() {
    const links = window.GOALCAST_LINKS || {};
    const item = (kind, value, text) => {
      const icon = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">${ICONS[kind]}</svg>`;
      return String(value || '').trim()
        ? `<a class="social" href="${esc(linkFor[kind](String(value).trim()))}" target="_blank" rel="noopener" aria-label="${text}" title="${text}">${icon}</a>`
        : `<span class="social off" role="img" aria-label="${text} (coming soon)" title="${text}: coming soon">${icon}</span>`;
    };
    $('#foot-links').innerHTML = `<div><h4>Follow GoalCast</h4><div class="social-row">${item('x', links.x, 'X')}${item('telegram', links.telegramChannel, 'Telegram channel')}</div></div>
      <div><h4>Contact support</h4><div class="social-row">${item('whatsapp', links.whatsapp, 'WhatsApp support')}${item('telegram', links.telegramSupport, 'Telegram support')}</div></div>`;
  }

  /* ---------- routing & events ---------- */
  const TITLES = { safe: 'Safe football tips today', value: 'Model vs bookmaker odds', results: 'Football prediction results', model: 'How the GoalCast model performs',
    premium: 'GoalCast Premium: plans and prices', 'my-teams': 'My teams', leagues: 'Football leagues, standings and top scorers', blog: 'GoalCast blog' };
  function pageTitle(route, arg) {
    if (route === 'league' && state.leagues?.leagues?.[arg]) return `${state.leagues.leagues[arg].league} table, top scorers and predictions`;
    if (route === 'market') return (MARKETS.find((k) => k.slug === arg) || MARKETS[0]).title;
    if (route === 'intl') return `${REGIONS[arg] || 'Europe'} international football predictions`;
    if (route === 'blog' && arg) return posts().find((p) => p.slug === arg)?.title || TITLES.blog;
    return TITLES[route] || (state.pages?.pages || []).find((p) => p.slug === route)?.title || '';
  }
  /* Internal links are written as "#/route" in the templates and become real addresses here. */
  const routed = (html) => html.replaceAll('href="#/', `href="${BASE}`).replaceAll('src="assets/', `src="${BASE}assets/`);
  const currentRoute = () => decodeURIComponent(location.pathname.slice(BASE.length)).replace(/\/+$/, '').replace(/^index\.html$/, '');
  function navigate(path) {
    history.pushState(null, '', BASE + path);
    render(false);
  }
  const routes = { '': viewMatches, safe: viewSafe, value: viewValue, results: viewResults, model: viewModel,
    market: viewMarket, leagues: viewLeagues, premium: viewPremium, day: viewMatches, league: viewLeague, blog: viewBlog, intl: viewIntl, 'my-teams': viewMyTeams,
    terms: () => viewPage('terms'), privacy: () => viewPage('privacy'), 'responsible-gambling': () => viewPage('responsible-gambling') };
  const GROUPS = { market: 'market', safe: 'market', value: 'market', day: 'day', league: 'league', leagues: 'league', intl: 'intl' };
  function render(keepScroll) {
    let [route, arg] = currentRoute().split('/');
    if (!routes[route]) route = '';
    if (!keepScroll) {
      adTurn += 1; // booked sponsors take turns, one step per page view
      // a fresh navigation sets the matches filters from the address
      if (route === 'day') { state.day = arg; state.league = 'all'; }
      else if (route === '') { state.day = 'all'; state.league = 'all'; }
    }
    document.querySelectorAll('#nav > a').forEach((a) => a.classList.toggle('on', a.dataset.route === route));
    document.querySelectorAll('#nav details').forEach((d) => d.classList.toggle('on', d.dataset.group === GROUPS[route]));
    const y = scrollY;
    app.innerHTML = routed((route === '' ? '' : adSlot('banner')) + routes[route](arg));
    const title = pageTitle(route, arg);
    document.title = title ? `${title} | GoalCast` : 'GoalCast: football predictions, graded in public';
    scrollTo(0, keepScroll ? y : 0);
    if (detailEl.open && detailEl.dataset.id) openDetail(detailEl.dataset.id);
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (e.target === detailEl) return detailEl.close();
    if (e.target === authEl) return authEl.close();
    closeMenus(e.target.closest('details.dd'));
    if (e.target.closest('.menu a, #nav > a')) { closeMenus(); document.body.classList.remove('nav-open'); }
    if (!el) return;
    const { action, id, sel, v } = el.dataset;
    const rerender = () => render(true);
    switch (action) {
      case 'slip-add': e.stopPropagation(); slipAdd(id, sel); rerender(); break;
      case 'slip-remove': state.slip = state.slip.filter((x) => x.id !== id); store.set('gc-slip', state.slip); renderSlip(); rerender(); break;
      case 'slip-clear': state.slip = []; store.set('gc-slip', []); renderSlip(); rerender(); break;
      case 'toggle-slip': slipEl.hidden = !slipEl.hidden; break;
      case 'open': openDetail(id); break;
      case 'team-remove': removeTeam(v, authEl.contains(el)); break;
      case 'fav-toggle': saveFavs(favs().includes(v) ? favs().filter((t) => t !== v) : [...favs(), v]); break;
      case 'notify-toggle':
        if (notifyOn()) { store.set('gc-notify', false); rerender(); break; }
        Notification.requestPermission().then((permission) => { store.set('gc-notify', permission === 'granted'); store.set('gc-notified', []); render(true); notifyFavs(); });
        break;
      case 'plan-choose': openPlan(v); break;
      case 'paystack': payWithPaystack(v); break;
      case 'copy': navigator.clipboard?.writeText(v).then(() => { el.textContent = 'Copied'; }); break;
      case 'plan-refresh':
        auth.client?.auth.refreshSession().then(() => { render(true); loadPremium(); if (!isPremium()) alert('Premium is not active on this account yet. If you have paid, please message us and we will switch it on.'); });
        break;
      case 'burger': document.body.classList.toggle('nav-open'); break;
      case 'auth-open': auth.msg = null; openAuth(v); break;
      case 'auth-close': authEl.close(); break;
      case 'sign-out': auth.client?.auth.signOut(); break;
      case 'acca-load': {
        const acca = buildAcca(accaPool(), Number(v));
        if (!acca) break;
        state.slip = acca.legs.map((m) => ({ id: m.id, sel: m.tips.SAFE.sel, label: label(m.tips.SAFE.sel, m), match: `${m.home} v ${m.away}`, p: m.tips.SAFE.p }));
        store.set('gc-slip', state.slip); renderSlip(); slipEl.hidden = false; rerender(); break;
      }
      case 'jump': document.getElementById(v)?.scrollIntoView(); break;
      case 'to-matches': $('#matches').scrollIntoView(); break;
      case 'close-detail': detailEl.close(); break;
      case 'day': state.day = v; rerender(); break;
      case 'sort': state.sort = v; rerender(); break;
      case 'res-tab': state.resTab = v; rerender(); break;
      case 'res-outcome': state.resOutcome = v; rerender(); break;
      case 'theme': {
        const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
        document.documentElement.dataset.theme = next; store.set('gc-theme', next); if (state.pred) render(true); break;
      }
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-action="open"]')) openDetail(e.target.dataset.id);
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'auth-form') return;
    e.preventDefault();
    submitAuth(e.target);
  });
  document.addEventListener('change', (e) => {
    if ('changeCountry' in e.target.dataset) { setCountry(e.target.value); return; }
    if ('teamInput' in e.target.dataset) { addTeam(e.target); return; }
    if ('showPassword' in e.target.dataset) { auth.showPassword = e.target.checked; syncPassword(); return; }
    if ('changeLeague' in e.target.dataset) { navigate(`league/${e.target.value}`); return; }
    const key = e.target.dataset.change;
    if (key) { state[key] = e.target.value; render(true); }
  });
  document.addEventListener('input', (e) => {
    if ('teamInput' in e.target.dataset) { addTeam(e.target); return; }
    if (e.target.name === 'password' && authEl.contains(e.target)) { syncPassword(); return; }
    if (e.target.dataset.input !== 'q') return;
    state.q = e.target.value;
    render(true);
    const box = $('[data-input="q"]');
    box.focus(); box.setSelectionRange(state.q.length, state.q.length);
  });
  /* Links inside the site switch page without a reload; everything else behaves normally. */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || a.target || a.origin !== location.origin) return;
    if (!a.pathname.startsWith(BASE) || /\.[a-z0-9]+$/i.test(a.pathname) || !state.pred) return;
    e.preventDefault();
    history.pushState(null, '', a.href);
    render(false);
  });
  addEventListener('popstate', () => { if (state.pred) render(false); });
  addEventListener('hashchange', () => { if (location.hash.startsWith('#/') && state.pred) { history.replaceState(null, '', BASE + location.hash.slice(2)); render(false); } });

  /* ---------- visitor counting ---------- */
  function startAnalytics() {
    const token = (window.GOALCAST_ANALYTICS || {}).cloudflareToken;
    if (!token || location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;
    const s = document.createElement('script');
    s.type = 'module';
    s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    s.dataset.cfBeacon = JSON.stringify({ token }); // the beacon follows page changes inside the app by itself
    document.head.append(s);
  }

  /* ---------- boot ---------- */
  startAnalytics();
  if (location.hash.startsWith('#/')) history.replaceState(null, '', BASE + location.hash.slice(2)); // links shared before pages had real addresses
  $('.brand').href = BASE;
  renderFootLinks();
  document.documentElement.dataset.theme = store.get('gc-theme', matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const load = (name) => fetch(`${BASE}data/${name}.json`, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`${name}: ${r.status}`); return r.json(); });
  Promise.all([...['predictions', 'results', 'model'].map(load), ...['leagues', 'blog', 'sponsors', 'pages', 'logos'].map((n) => load(n).catch(() => null))]).then(([pred, res, model, leagues, blog, sponsors, pages, logos]) => {
    Object.assign(state, { pred, res, model, leagues, blog, sponsors, pages, logos });
    const live = new Set(pred.matches.map((m) => m.id));
    state.slip = store.get('gc-slip', []).filter((x) => live.has(x.id));
    $('#foot-meta').textContent = `Updated ${new Date(pred.generated).toLocaleString()} · model ${pred.version}`;
    renderSlip();
    renderNav();
    document.body.insertAdjacentHTML('beforeend', `<datalist id="team-list">${[...allTeams()].sort((a, b) => a[0].localeCompare(b[0])).map(([t, l]) => `<option value="${esc(t)}">${esc(l)}</option>`).join('')}</datalist>`);
    render(false);
    initAuth();
    setInterval(() => { if (!detailEl.open && !document.activeElement?.matches('input, select')) render(true); }, 60000);
  }).catch((err) => {
    app.innerHTML = `<p class="empty">Could not load prediction data (${esc(err.message)}). Run <code>python -m ml.pipeline</code> and serve the <code>site</code> folder.</p>`;
  });
})();
