const DATA = window.__VIBESTATS_DATA;
const PRICING = DATA.pricing;

// Header meta. A dashboard is built from a point-in-time source (a snapshot
// copy, or the live dirs read at build time), and nothing re-reads it while the
// page is open — so state the age loudly. A stale build looks identical to a
// current one otherwise, which is how a months-old view goes unnoticed.
(function renderSnapshotMeta() {
  const el = document.getElementById('snapshotMeta');
  const s = DATA.summary;
  const origin = s.live ? 'live' : 'snapshot';
  const parts = [origin + ' ' + s.snapshot, s.firstDay + ' → ' + s.lastDay];
  const ageDays = (() => {
    if (!s.snapshot) return null;
    const built = Date.parse(s.snapshot + 'T00:00:00');
    if (Number.isNaN(built)) return null;
    const now = new Date();
    const todayUtc = Date.parse(
      now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') + 'T00:00:00'
    );
    return Math.round((todayUtc - built) / 86400000);
  })();
  el.textContent = parts.join(' · ');
  if (ageDays !== null && ageDays >= 1) {
    const warn = document.createElement('span');
    warn.className = 'stale-badge';
    warn.textContent = ageDays === 1 ? '1 day old — refresh' : ageDays + ' days old — refresh';
    warn.title = 'Data was built ' + ageDays + ' days ago. Click Refresh, or run `vibestats live`.';
    el.appendChild(document.createTextNode(' '));
    el.appendChild(warn);
  }
  const stale = s.staleTools || [];
  if (stale.length) {
    const note = document.createElement('span');
    note.className = 'stale-badge';
    note.textContent = 'stale: ' + stale.map(t => t.tool + ' @ ' + t.snapshot).join(', ');
    note.title = 'These tools contributed older aggregates — their source dirs were missing on the last build.';
    el.appendChild(document.createTextNode(' '));
    el.appendChild(note);
  }
})();

// First-run banner: only show if pricing was auto-detected AND user hasn't dismissed in last 7 days.
(function setupAutoBanner() {
  const sub = PRICING.subscription;
  if (!sub || !sub._autoDetected) return;
  const dismissedAt = Number(localStorage.getItem('vibestats:autoBannerDismissed') || 0);
  if (Date.now() - dismissedAt < 7 * 24 * 3600 * 1000) return;
  const banner = document.getElementById('autoBanner');
  const sig = sub._signals || {};
  const mTok = sig.avgMonthlyTokens ? (sig.avgMonthlyTokens / 1e6).toFixed(0) + 'M' : '?';
  const opus = sig.opusShare != null ? (sig.opusShare * 100).toFixed(0) + '%' : '?';
  document.getElementById('autoBannerMsg').innerHTML =
    'Guessed your plan: <b>' + escapeHtml(sub.tier) + '</b> ($' + escapeHtml(sub.monthly_usd) + '/mo, started ' + escapeHtml(sub.started) + '). ' +
    'Based on ' + escapeHtml(mTok) + ' tokens/mo · ' + escapeHtml(opus) + ' Opus. Cost multiple will be wrong if this is off.';
  banner.style.display = 'flex';
  document.getElementById('autoBannerConfirm').onclick = () => {
    localStorage.setItem('vibestats:autoBannerDismissed', String(Date.now()));
    banner.style.display = 'none';
    alert('Marked as correct. To persist: edit pricing.json and remove the `_autoDetected: true` line from the subscription block. Then the auto-detector will leave it alone.');
  };
  document.getElementById('autoBannerDismiss').onclick = () => {
    localStorage.setItem('vibestats:autoBannerDismissed', String(Date.now()));
    banner.style.display = 'none';
    // Inside Tauri, open the Settings panel directly. Outside (e.g. serve.sh),
    // fall back to the instructional alert since there's no UI to launch.
    if (window.__TAURI__ && window.__TAURI__.core) {
      window.__TAURI__.core.invoke('open_settings').catch(e => {
        alert('Could not open Settings: ' + e);
      });
      return;
    }
    alert('Edit pricing.json directly to fix tier/monthly_usd/started. Remove _autoDetected:true so the guess does not overwrite your edit on the next snapshot.');
  };
})();

// Pending-merges banner: shown when detect-merges found medium-confidence merge candidates
// the auto-merger couldn't resolve. 7-day dismiss like the pricing banner.
(function setupMergesBanner() {
  const n = DATA.summary && DATA.summary.pendingMergesCount;
  if (!n) return;
  const dismissedAt = Number(localStorage.getItem('vibestats:mergesBannerDismissed') || 0);
  if (Date.now() - dismissedAt < 7 * 24 * 3600 * 1000) return;
  const banner = document.getElementById('mergesBanner');
  document.getElementById('mergesBannerMsg').innerHTML =
    n + ' potential project merge' + (n === 1 ? '' : 's') + ' detected. ' +
    'Review with <code>vibestats merges list</code>, then <code>vibestats merges accept &lt;id&gt;</code> or <code>reject &lt;id&gt;</code>.';
  banner.style.display = 'flex';
  document.getElementById('mergesBannerDismiss').onclick = () => {
    localStorage.setItem('vibestats:mergesBannerDismissed', String(Date.now()));
    banner.style.display = 'none';
  };
})();

const footnoteBits = [
  'Subscription: ' + escapeHtml(PRICING.subscription.tier) + ' @ $' + escapeHtml(PRICING.subscription.monthly_usd) + '/mo, started ' + escapeHtml(PRICING.subscription.started) + '. Edit pricing.json to adjust.',
  'Costs exclude server-tool charges (web search at $10/1k, code execution runtime) which the jsonl does not expose cleanly.',
];
if (DATA.summary.unknownModels && DATA.summary.unknownModels.length) {
  footnoteBits.push('Models without pricing (zero cost contribution): ' + DATA.summary.unknownModels.map(escapeHtml).join(', '));
}
document.getElementById('footnote').innerHTML = footnoteBits.join('<br>');

function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}
function fmtUsd(n) {
  if (!n) return '$0';
  if (n >= 10000) return '$' + (n / 1000).toFixed(1) + 'k';
  if (n >= 100) return '$' + n.toFixed(0);
  if (n >= 1) return '$' + n.toFixed(2);
  return '$' + n.toFixed(4);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

// Strip the encoded home prefix from a project key so "-Users-rico-projects-foo" -> "foo".
const HOME_PREFIX_ESC = (DATA.summary.homePrefix || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HOME_REGEX = HOME_PREFIX_ESC ? new RegExp('^' + HOME_PREFIX_ESC + '-') : /^-(Users|home)-[^-]+-/;
function niceProjectName(raw) { return String(raw).replace(HOME_REGEX, '').replace(/^projects-/, ''); }

function usageCost(model, u) {
  const p = PRICING.models[model];
  if (!p) return 0;
  return (
    u.input * p.input +
    u.output * p.output +
    u.cacheRead * p.cache_read +
    u.cacheCreate5m * p.cache_5m +
    u.cacheCreate1h * p.cache_1h
  ) / 1e6;
}
function tokensOfUsage(u) { return u.input + u.output + u.cacheRead + u.cacheCreate5m + u.cacheCreate1h; }
function dayCost(d) { let c = 0; for (const u of d.byModel) c += usageCost(u.model, u); return c; }
function dayTokens(d) { let t = 0; for (const u of d.byModel) t += tokensOfUsage(u); return t; }

const isoDay = d => d.toISOString().slice(0, 10);

// Every range except "all time" is a fixed-length window that can be stepped
// backwards with the pager: `offset` counts whole windows away from the most
// recent one (0 = current, -1 = the one before it, …). Windows are closed at
// both ends so the heatmap can draw the whole span even where there is no
// data — "nothing here" is the answer to "was I using this last year?", and
// clipping the grid to the days that happen to have activity can't express it.
function getRange(val, offset) {
  offset = offset || 0;
  const anchor = DATA.summary.lastDay ? new Date(DATA.summary.lastDay + 'T00:00:00Z') : new Date();
  const today = new Date();
  if (val === 'all') return { from: null, to: null, label: 'All time', pageable: false };
  if (val === 'this-month') {
    const start = new Date(Date.UTC(today.getFullYear(), today.getMonth() + offset, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    return {
      from: isoDay(start),
      to: isoDay(end),
      label: start.toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      pageable: true,
    };
  }
  if (val === 'this-year') {
    const year = today.getFullYear() + offset;
    return { from: year + '-01-01', to: year + '-12-31', label: String(year), pageable: true };
  }
  // Rolling N-day window. At offset 0 it ends on the last day with data, which
  // is what "last 30 days" meant before the pager existed.
  const days = parseInt(val, 10);
  const end = new Date(anchor); end.setUTCDate(end.getUTCDate() + offset * days);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - days + 1);
  return { from: isoDay(start), to: isoDay(end), label: isoDay(start) + ' → ' + isoDay(end), pageable: true };
}
function inRange(day, range) {
  if (range.from && day < range.from) return false;
  if (range.to && day > range.to) return false;
  return true;
}

function computeFiltered(range) {
  const days = DATA.heatmap.filter(d => inRange(d.day, range));
  const dayKeys = new Set(days.map(d => d.day));
  let messages = 0, sessions = 0, tokens = 0, cost = 0;
  let locAdditions = 0, locDeletions = 0;
  const byModel = new Map();
  for (const d of days) {
    messages += d.messages;
    sessions += d.sessions;
    tokens += dayTokens(d);
    cost += dayCost(d);
    locAdditions += d.locAdditions || 0;
    locDeletions += d.locDeletions || 0;
    for (const u of d.byModel) {
      const key = (u.tool || '?') + ':' + u.model;
      let m = byModel.get(key);
      if (!m) { m = { tool: u.tool || '?', model: u.model, messages: 0, input: 0, output: 0, cacheRead: 0, cacheCreate5m: 0, cacheCreate1h: 0, cost: 0 }; byModel.set(key, m); }
      m.messages += u.messages;
      m.input += u.input; m.output += u.output; m.cacheRead += u.cacheRead;
      m.cacheCreate5m += u.cacheCreate5m; m.cacheCreate1h += u.cacheCreate1h;
      m.cost += usageCost(u.model, u);
    }
  }
  let longest = 0, run = 0, prev = null;
  const sortedKeys = [...dayKeys].sort();
  for (const k of sortedKeys) {
    if (prev) {
      const gap = (new Date(k) - new Date(prev)) / 86400000;
      run = gap === 1 ? run + 1 : 1;
    } else run = 1;
    if (run > longest) longest = run;
    prev = k;
  }
  let current = 0;
  if (sortedKeys.length) {
    let d = new Date(sortedKeys[sortedKeys.length - 1]);
    while (dayKeys.has(d.toISOString().slice(0, 10))) { current++; d.setUTCDate(d.getUTCDate() - 1); }
  }
  return { days, dayKeys, activeDays: days.length, messages, sessions, tokens, cost, locAdditions, locDeletions, byModel: [...byModel.values()].sort((a, b) => b.cost - a.cost), longest, current };
}

function subscriptionPaidUntil(throughDay) {
  const start = new Date(PRICING.subscription.started + 'T00:00:00Z');
  const end = throughDay ? new Date(throughDay + 'T00:00:00Z') : new Date();
  const months = Math.max(0, (end - start) / (1000 * 60 * 60 * 24 * 30.44));
  return months * PRICING.subscription.monthly_usd;
}

function renderStats(f, rangeVal, range) {
  const grid = document.getElementById('statsGrid');
  // Prorate through the last active day in view; for a window with no activity
  // fall back to the window's own end, not today — a look back at 2024 must not
  // bill every month since then.
  const lastDay = f.days.length ? f.days[f.days.length - 1].day : ((range && range.to) || null);
  const subCost = subscriptionPaidUntil(lastDay);
  const multiple = subCost > 0 ? f.cost / subCost : 0;
  const sessionsSub = rangeVal === 'all'
    ? 'unique IDs: ' + DATA.summary.totalSessionsAllTime.toLocaleString()
    : 'sum per day';
  const adds = f.locAdditions || 0;
  const dels = f.locDeletions || 0;
  const net = adds - dels;
  // Don't render a signed zero ("+0" / "−0") for an empty window.
  const signed = (n, sign) => (n ? sign : '') + Math.abs(n).toLocaleString();
  const netStr = signed(net, net >= 0 ? '+' : '−');
  const cards = [
    { num: f.activeDays, lbl: 'Active days' },
    { num: f.current, lbl: 'Current streak', sub: 'days' },
    { num: f.longest, lbl: 'Longest streak', sub: 'days' },
    { num: f.sessions.toLocaleString(), lbl: 'Sessions', sub: sessionsSub },
    { num: f.messages.toLocaleString(), lbl: 'Messages' },
    { num: signed(adds, '+'), lbl: 'Lines added', sub: 'Edit / Write / MultiEdit' },
    { num: signed(dels, '−'), lbl: 'Lines removed', sub: 'Edit / Write / MultiEdit' },
    { num: netStr, lbl: 'Net lines', sub: 'added − removed' },
    { num: fmtTokens(f.tokens), lbl: 'Tokens' },
    { num: fmtUsd(f.cost), lbl: 'API cost (would-be)', sub: 'pay-as-you-go' },
    { num: fmtUsd(subCost), lbl: 'Subscription paid', sub: PRICING.subscription.tier },
    { num: multiple.toFixed(1) + '×', lbl: 'Value multiple', sub: 'API ÷ subscription', highlight: true },
  ];
  grid.innerHTML = cards.map(c => {
    const sub = c.sub ? '<div class="sub">' + c.sub + '</div>' : '';
    return '<div class="stat' + (c.highlight ? ' highlight' : '') + '">' +
      '<div class="num">' + c.num + '</div>' + sub +
      '<div class="lbl">' + c.lbl + '</div></div>';
  }).join('');
}

function renderHeatmap(f, colorBy, range) {
  const valueOf = d => {
    if (colorBy === 'sessions') return d.sessions;
    if (colorBy === 'messages') return d.messages;
    if (colorBy === 'tokens') return dayTokens(d);
    if (colorBy === 'cost') return dayCost(d);
    return d.sessions;
  };
  const cellsEl = document.getElementById('cells');
  const monthEl = document.getElementById('monthRow');
  cellsEl.innerHTML = '';
  monthEl.innerHTML = '';
  const bounded = !!(range && range.from && range.to);
  if (!f.days.length && !bounded) {
    cellsEl.innerHTML = '<div class="muted" style="padding:24px">No activity in range.</div>';
    document.getElementById('legendNote').textContent = '';
    return;
  }
  const dayMap = new Map(f.days.map(d => [d.day, d]));
  let first, last;
  if (bounded) {
    // A paged window draws its full span — an empty year has to look like an
    // empty year, not like a missing chart.
    first = new Date(range.from + 'T00:00:00Z');
    last = new Date(range.to + 'T00:00:00Z');
  } else {
    const dataFirst = new Date(f.days[0].day + 'T00:00:00Z');
    last = new Date(f.days[f.days.length - 1].day + 'T00:00:00Z');
    // Always show at least MIN_MONTHS of history (empty cells before first activity day).
    // Snap to the 1st of that month so the leading month is rendered in full and its
    // label has columns to sit over (otherwise Nov shrinks to ~1 week and labels collide).
    const MIN_MONTHS = 6;
    const minDisplayFirst = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() - MIN_MONTHS, 1));
    first = dataFirst < minDisplayFirst ? new Date(Date.UTC(dataFirst.getUTCFullYear(), dataFirst.getUTCMonth(), 1)) : minDisplayFirst;
  }
  const monBased = d => { const x = d.getUTCDay(); return x === 0 ? 6 : x - 1; };
  const padStart = new Date(first); padStart.setUTCDate(padStart.getUTCDate() - monBased(padStart));
  const padEnd = new Date(last); padEnd.setUTCDate(padEnd.getUTCDate() + (6 - monBased(padEnd)));

  const values = f.days.map(valueOf).filter(v => v > 0).sort((a, b) => a - b);
  const q = p => values[Math.max(0, Math.floor((values.length - 1) * p))];
  const t1 = q(0.25), t2 = q(0.5), t3 = q(0.75);
  // No positive values (an empty window) → every cell stays at level 0 rather
  // than comparing against undefined thresholds.
  const bucket = v => !values.length || !v ? 0 : v <= t1 ? 1 : v <= t2 ? 2 : v <= t3 ? 3 : 4;

  let col = 0;
  let lastMonth = -1;
  for (let d = new Date(padStart); d <= padEnd; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10);
    const entry = dayMap.get(k);
    const cell = document.createElement('div');
    cell.className = 'cell';
    if (entry) cell.classList.add('l' + bucket(valueOf(entry)));
    cell.dataset.day = k;
    cell.addEventListener('mouseenter', () => showTip(k, entry));
    cell.addEventListener('mousemove', moveTip);
    cell.addEventListener('mouseleave', hideTip);
    cell.addEventListener('click', () => openDay(k, entry));
    cellsEl.appendChild(cell);

    if (monBased(d) === 0) {
      const m = d.getUTCMonth();
      // Only label the first Monday whose date is in the first week of a month.
      // Avoids labeling a column whose Monday spilled back into the previous month
      // (e.g. Mon Oct 27 starts a column mostly covering Nov 1-2 — don't call it Oct).
      if (m !== lastMonth && d.getUTCDate() <= 7) {
        const lbl = document.createElement('div');
        lbl.className = 'month-label';
        lbl.style.left = (col * 26) + 'px';
        lbl.textContent = d.toLocaleString('en', { month: 'short' });
        monthEl.appendChild(lbl);
        lastMonth = m;
      }
      col++;
    }
  }
  monthEl.style.width = (col * 26) + 'px';

  // A wide window (a full year is 53 columns) scrolls; park it at the newest
  // end so the most recent days are the ones on screen.
  const wrap = cellsEl.closest('.heatmap-wrap');
  if (wrap) wrap.scrollLeft = wrap.scrollWidth;

  const note = document.getElementById('legendNote');
  if (!f.days.length) {
    note.textContent = 'no activity in this window';
    return;
  }
  const maxV = Math.max(...f.days.map(valueOf));
  const maxStr = colorBy === 'tokens' ? fmtTokens(maxV) : colorBy === 'cost' ? fmtUsd(maxV) : maxV.toLocaleString();
  note.textContent = 'colored by ' + colorBy + ' · max ' + maxStr + '/day';
}

const tip = document.getElementById('tooltip');
function showTip(k, entry) {
  tip.style.display = 'block';
  const safeK = /^\d{4}-\d{2}-\d{2}$/.test(k) ? k : escapeHtml(k);
  if (entry) {
    const t = dayTokens(entry), c = dayCost(entry);
    tip.innerHTML = '<b>' + safeK + '</b><br>' + entry.sessions + ' sessions · ' + entry.messages.toLocaleString() + ' messages<br>' + fmtTokens(t) + ' tokens · ' + fmtUsd(c) + ' would-be API';
  } else {
    tip.innerHTML = '<b>' + safeK + '</b><br>No activity';
  }
}
function moveTip(e) {
  tip.style.left = (e.pageX + 14) + 'px';
  tip.style.top = (e.pageY + 14) + 'px';
}
function hideTip() { tip.style.display = 'none'; }

// Day-detail panel
const dayBackdrop = document.getElementById('dayBackdrop');
const dayPanel = document.getElementById('dayPanel');
const dayTitle = document.getElementById('dayTitle');
const daySub = document.getElementById('daySub');
const dayStatsEl = document.getElementById('dayStats');
const dayProjectsWrap = document.getElementById('dayProjectsWrap');
const dayModelsWrap = document.getElementById('dayModelsWrap');

function fmtDayHeading(k) {
  const d = new Date(k + 'T00:00:00Z');
  return d.toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function openDay(k, entry) {
  hideTip();
  dayTitle.textContent = fmtDayHeading(k);
  daySub.textContent = k;
  if (!entry) {
    dayStatsEl.innerHTML = '<div class="day-empty">No activity recorded for this day.</div>';
    dayProjectsWrap.innerHTML = '';
    dayModelsWrap.innerHTML = '';
  } else {
    renderDayStats(entry);
    renderDayProjects(k, entry);
    renderDayModels(entry);
  }
  dayBackdrop.classList.add('open');
  dayPanel.classList.add('open');
}

function closeDay() {
  dayBackdrop.classList.remove('open');
  dayPanel.classList.remove('open');
}

function renderDayStats(entry) {
  const tokens = dayTokens(entry);
  const cost = dayCost(entry);
  const adds = entry.locAdditions || 0;
  const dels = entry.locDeletions || 0;
  const cards = [
    { num: entry.sessions, lbl: 'Sessions' },
    { num: entry.messages.toLocaleString(), lbl: 'Messages' },
    { num: fmtTokens(tokens), lbl: 'Tokens' },
    { num: fmtUsd(cost), lbl: 'API cost' },
  ];
  if (adds || dels) {
    cards.push({ num: '+' + adds.toLocaleString(), lbl: 'Lines added' });
    cards.push({ num: '−' + dels.toLocaleString(), lbl: 'Lines removed' });
  }
  dayStatsEl.innerHTML = cards.map(c =>
    '<div class="day-stat"><div class="num">' + c.num + '</div><div class="lbl">' + c.lbl + '</div></div>'
  ).join('');
}

// byProject may not be present in older snapshots — fall back to filtering DATA.projects
// by the day so we still surface project names.
function projectsForDay(k, entry) {
  if (entry && Array.isArray(entry.byProject) && entry.byProject.length) return entry.byProject;
  return DATA.projects
    .filter(p => p.days && p.days.includes(k))
    .map(p => ({ name: p.name, tool: p.tools || '', sessions: null, messages: null, tokens: null }));
}

function renderDayProjects(k, entry) {
  const list = projectsForDay(k, entry);
  if (!list.length) { dayProjectsWrap.innerHTML = '<div class="day-empty">No project attribution available.</div>'; return; }
  const hasMetrics = list.some(p => p.messages != null);
  const showTool = list.some(p => p.tool);
  const rows = list.map(p => {
    const nice = niceProjectName(p.name);
    const toolCell = showTool ? '<td><span class="pill">' + escapeHtml(p.tool || '?') + '</span></td>' : '';
    if (hasMetrics) {
      return '<tr>' +
        '<td>' + escapeHtml(nice) + '</td>' +
        toolCell +
        '<td class="num">' + (p.sessions != null ? p.sessions : '—') + '</td>' +
        '<td class="num">' + (p.messages != null ? p.messages.toLocaleString() : '—') + '</td>' +
        '<td class="num">' + (p.tokens != null ? fmtTokens(p.tokens) : '—') + '</td>' +
        '</tr>';
    }
    return '<tr><td>' + escapeHtml(nice) + '</td>' + toolCell + '</tr>';
  }).join('');
  const head = hasMetrics
    ? '<tr><th>Project</th>' + (showTool ? '<th>Tool</th>' : '') + '<th class="num">Sessions</th><th class="num">Messages</th><th class="num">Tokens</th></tr>'
    : '<tr><th>Project</th>' + (showTool ? '<th>Tool</th>' : '') + '</tr>';
  dayProjectsWrap.innerHTML = '<table><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>';
}

function renderDayModels(entry) {
  if (!entry.byModel || !entry.byModel.length) { dayModelsWrap.innerHTML = '<div class="day-empty">No model usage recorded.</div>'; return; }
  const rows = entry.byModel
    .map(u => ({ ...u, tokens: tokensOfUsage(u), cost: usageCost(u.model, u) }))
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
    .map(u => '<tr>' +
      '<td><span class="pill">' + escapeHtml(u.tool || '?') + '</span></td>' +
      '<td><code>' + escapeHtml(u.model) + '</code></td>' +
      '<td class="num">' + u.messages.toLocaleString() + '</td>' +
      '<td class="num">' + fmtTokens(u.tokens) + '</td>' +
      '<td class="num">' + fmtUsd(u.cost) + '</td>' +
    '</tr>').join('');
  dayModelsWrap.innerHTML = '<table><thead><tr><th>Tool</th><th>Model</th><th class="num">Messages</th><th class="num">Tokens</th><th class="num">Cost</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

document.getElementById('dayCloseBtn').addEventListener('click', closeDay);
dayBackdrop.addEventListener('click', closeDay);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDay(); closeGrouping(); } });

// Refresh button — Tauri invokes the snapshot+build pipeline; otherwise just
// reload (a serve.sh/vite watcher will re-pull dashboard.html from disk).
const refreshBtn = document.getElementById('refreshBtn');
refreshBtn.addEventListener('click', () => doRefresh());

async function doRefresh() {
  refreshBtn.classList.add('is-loading');
  refreshBtn.disabled = true;
  try {
    if (window.__TAURI__ && window.__TAURI__.core) {
      await window.__TAURI__.core.invoke('prepare_dashboard');
    } else if (location.protocol === 'http:' || location.protocol === 'https:') {
      // vite dev preview: ask the dev server for a fresh live build before
      // reloading. 404s harmlessly under serve.sh, which has no such endpoint.
      try { await fetch('/payload.json?rebuild=1', { cache: 'no-store' }); } catch { /* offline/static host */ }
    }
    window.location.reload();
  } catch (e) {
    refreshBtn.classList.remove('is-loading');
    refreshBtn.disabled = false;
    alert('Refresh failed: ' + e);
  }
}

// Grouping editor — read/write ~/.vibestats/project-aliases.json via Tauri,
// or fall back to a copy-paste textarea when running in vite/serve.sh.
const groupingBackdrop = document.getElementById('groupingBackdrop');
const groupingPanel = document.getElementById('groupingPanel');
const groupingTableWrap = document.getElementById('groupingTableWrap');
const groupingFallback = document.getElementById('groupingFallback');
const groupingFallbackText = document.getElementById('groupingFallbackText');
let groupingRows = []; // [{canonical: string, dirs: string, sessions: number, tokens: number}]

document.getElementById('groupingBtn').addEventListener('click', openGrouping);
document.getElementById('groupingCloseBtn').addEventListener('click', closeGrouping);
document.getElementById('groupingCancelBtn').addEventListener('click', closeGrouping);
groupingBackdrop.addEventListener('click', closeGrouping);
document.getElementById('groupingAddRowBtn').addEventListener('click', () => {
  groupingRows.push({ canonical: '', dirs: '', sessions: 0, tokens: 0 });
  renderGroupingTable();
});
document.getElementById('groupingSaveBtn').addEventListener('click', saveGrouping);
document.getElementById('groupingCopyBtn').addEventListener('click', () => {
  groupingFallbackText.select();
  try { navigator.clipboard.writeText(groupingFallbackText.value); } catch (_) { document.execCommand('copy'); }
});

async function openGrouping() {
  hideTip();
  // Seed editor rows from DATA.projects (canonical + mergedFrom array). Merge in
  // anything from project-aliases.json that doesn't appear in the snapshot yet
  // (e.g. aliases added but not snapshotted) so the user sees their full config.
  const seen = new Set();
  groupingRows = DATA.projects
    .filter(p => (p.mergedFrom || []).length > 0)
    .map(p => {
      seen.add(p.name);
      return {
        canonical: p.name,
        dirs: (p.mergedFrom || []).join(', '),
        sessions: p.sessions || 0,
        tokens: p.tokens || 0,
      };
    })
    .sort((a, b) => b.sessions - a.sessions);

  if (window.__TAURI__ && window.__TAURI__.core) {
    try {
      const raw = await window.__TAURI__.core.invoke('read_aliases');
      const parsed = JSON.parse(raw || '{}');
      const aliases = (parsed && parsed.aliases) || {};
      for (const [canonical, dirs] of Object.entries(aliases)) {
        if (seen.has(canonical)) continue;
        groupingRows.push({
          canonical,
          dirs: Array.isArray(dirs) ? dirs.join(', ') : '',
          sessions: 0,
          tokens: 0,
        });
      }
    } catch (e) {
      // Non-fatal — proceed with snapshot-derived rows only.
      console.warn('read_aliases failed:', e);
    }
    groupingFallback.style.display = 'none';
  } else {
    groupingFallback.style.display = 'block';
    groupingFallbackText.value = buildAliasesJson();
  }

  renderGroupingTable();
  groupingBackdrop.classList.add('open');
  groupingPanel.classList.add('open');
}

function closeGrouping() {
  groupingBackdrop.classList.remove('open');
  groupingPanel.classList.remove('open');
}

function renderGroupingTable() {
  if (!groupingRows.length) {
    groupingTableWrap.innerHTML = '<div class="day-empty">No grouped projects yet. Click "+ Add row" to create one.</div>';
    return;
  }
  const head = '<tr><th style="width:30%">Canonical name</th><th style="width:50%">Merged-from dirs (comma-separated)</th><th class="num">Sessions</th><th class="num">Tokens</th><th></th></tr>';
  const rows = groupingRows.map((r, i) =>
    '<tr>' +
      '<td><input type="text" data-i="' + i + '" data-field="canonical" value="' + escapeHtml(r.canonical) + '"></td>' +
      '<td><textarea data-i="' + i + '" data-field="dirs">' + escapeHtml(r.dirs) + '</textarea></td>' +
      '<td class="num">' + (r.sessions || 0).toLocaleString() + '</td>' +
      '<td class="num">' + fmtTokens(r.tokens || 0) + '</td>' +
      '<td><button class="icon-btn" data-rm="' + i + '" title="Remove row">×</button></td>' +
    '</tr>'
  ).join('');
  groupingTableWrap.innerHTML = '<table><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>';

  // Wire up inputs after render.
  groupingTableWrap.querySelectorAll('input, textarea').forEach(el => {
    el.addEventListener('input', () => {
      const i = Number(el.dataset.i);
      const field = el.dataset.field;
      groupingRows[i][field] = el.value;
      if (groupingFallback.style.display === 'block') {
        groupingFallbackText.value = buildAliasesJson();
      }
    });
  });
  groupingTableWrap.querySelectorAll('[data-rm]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.rm);
      groupingRows.splice(i, 1);
      renderGroupingTable();
      if (groupingFallback.style.display === 'block') {
        groupingFallbackText.value = buildAliasesJson();
      }
    });
  });
}

function buildAliasesJson() {
  const aliases = {};
  for (const r of groupingRows) {
    const canonical = (r.canonical || '').trim();
    if (!canonical) continue;
    const dirs = (r.dirs || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (!dirs.length) continue;
    aliases[canonical] = dirs;
  }
  return JSON.stringify({ aliases }, null, 2) + '\n';
}

async function saveGrouping() {
  const json = buildAliasesJson();
  if (window.__TAURI__ && window.__TAURI__.core) {
    try {
      await window.__TAURI__.core.invoke('write_aliases', { contents: json });
    } catch (e) {
      alert('Save failed: ' + e);
      return;
    }
    closeGrouping();
    if (confirm('Aliases saved. Re-snapshot now so changes apply?')) {
      doRefresh();
    }
  } else {
    // Non-Tauri: surface the JSON for manual copy.
    groupingFallback.style.display = 'block';
    groupingFallbackText.value = json;
  }
}

function renderModels(f) {
  const tbody = document.getElementById('modelsTbody');
  tbody.innerHTML = f.byModel.map(m => {
    return '<tr>' +
      '<td><span class="pill">' + escapeHtml(m.tool || '?') + '</span></td>' +
      '<td><code>' + escapeHtml(m.model) + '</code></td>' +
      '<td class="num">' + m.messages.toLocaleString() + '</td>' +
      '<td class="num">' + fmtTokens(m.input) + '</td>' +
      '<td class="num">' + fmtTokens(m.output) + '</td>' +
      '<td class="num">' + fmtTokens(m.cacheRead) + '</td>' +
      '<td class="num">' + fmtTokens(m.cacheCreate5m) + '</td>' +
      '<td class="num">' + fmtTokens(m.cacheCreate1h) + '</td>' +
      '<td class="num">' + fmtUsd(m.cost) + '</td>' +
      '</tr>';
  }).join('');
}

function renderProjects(range) {
  const tbody = document.getElementById('projectsTbody');
  const projects = DATA.projects.filter(p => {
    if (range.from || range.to) return p.days.some(d => inRange(d, range));
    return true;
  }).map(p => ({
    name: p.name,
    sessions: p.sessions,
    messages: p.messages,
    tokens: p.tokens,
    archived: p.archived,
    activeDays: (range.from || range.to) ? p.days.filter(d => inRange(d, range)).length : p.days.length,
  })).sort((a, b) => b.sessions - a.sessions).slice(0, 40);

  tbody.innerHTML = projects.map(p => {
    const niceName = niceProjectName(p.name);
    const wt = p.worktrees || 0;
    const mergedCount = (p.mergedFrom || []).length;
    const mergedHint = mergedCount > 1 ? ' <span class="muted" title="' + escapeHtml(p.mergedFrom.join(', ')) + '" style="font-size:10px">(' + mergedCount + ' dirs)</span>' : '';
    // Inline a small tools pill next to the name when the project spans more than one tool
    const tools = p.tools && p.tools.includes('+') ? ' <span class="pill" style="font-size:9px">' + escapeHtml(p.tools) + '</span>' : '';
    return '<tr>' +
      '<td>' + escapeHtml(niceName) + tools + mergedHint + '</td>' +
      '<td class="num">' + (wt ? wt : '—') + '</td>' +
      '<td class="num">' + p.sessions + '</td>' +
      '<td class="num">' + p.messages.toLocaleString() + '</td>' +
      '<td class="num">' + p.activeDays + '</td>' +
      '<td class="num">' + fmtTokens(p.tokens) + '</td>' +
      '<td>' + (p.archived ? '<span class="pill">archived</span>' : '<span class="pill live">live</span>') + '</td>' +
      '</tr>';
  }).join('');
}

// Which window we are looking at, in whole windows back from the newest one.
let windowOffset = 0;

const rangeSelect = document.getElementById('rangeSelect');
const pagerEl = document.getElementById('pager');
const prevWindowBtn = document.getElementById('prevWindow');
const nextWindowBtn = document.getElementById('nextWindow');
const windowLabelEl = document.getElementById('windowLabel');

function rerender() {
  const rangeVal = rangeSelect.value;
  const colorBy = document.getElementById('colorBy').value;
  const range = getRange(rangeVal, windowOffset);
  const f = computeFiltered(range);
  renderStats(f, rangeVal, range);
  renderHeatmap(f, colorBy, range);
  renderModels(f);
  renderProjects(range);

  pagerEl.hidden = !range.pageable;
  windowLabelEl.textContent = range.label;
  // Back is always allowed, including past the first day of data. Forward stops
  // at the newest window — there is nothing after it to show.
  prevWindowBtn.disabled = false;
  nextWindowBtn.disabled = windowOffset >= 0;
}

function stepWindow(delta) {
  const range = getRange(rangeSelect.value, windowOffset);
  if (!range.pageable) return;
  const next = Math.min(0, windowOffset + delta);
  if (next === windowOffset) return;
  windowOffset = next;
  rerender();
}

rangeSelect.addEventListener('change', () => { windowOffset = 0; rerender(); });
document.getElementById('colorBy').addEventListener('change', rerender);
prevWindowBtn.addEventListener('click', () => stepWindow(-1));
nextWindowBtn.addEventListener('click', () => stepWindow(1));

// ← / → page the window, as long as focus isn't in a control and no panel is open.
document.addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.target.isContentEditable) return;
  if (dayBackdrop.classList.contains('open') || groupingBackdrop.classList.contains('open')) return;
  e.preventDefault();
  stepWindow(e.key === 'ArrowLeft' ? -1 : 1);
});

rerender();
