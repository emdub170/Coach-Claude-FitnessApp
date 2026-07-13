// app.js — router + screens for Coach Claude. Framework-free.
import {
  loadProgram, getWorkout, getLocation, resolveVariant,
  importProgram, hasRollback, rollbackProgram, resetToBundled, validateProgram
} from './program.js';
import {
  getSessions, getSession, saveSession, deleteSession,
  getMeta, setMeta, newSessionId
} from './store.js';
import { createSession, addRow, removeRow, setEntryLoadType, todayISO, isEntryLogged } from './logger.js';
import { toMarkdown, toJSON, sessionMarkdown, entrySummary, filterSince, isoDaysAgo } from './export.js';
import {
  loadBands, saveBands, resetBands, hasBandOverride,
  bandDisplay, findBandByRank
} from './bands.js';

const appEl = document.getElementById('app');

// In-memory state
let PROG = null;          // { program, source }
let BANDS = [];           // resistance-band ladder (ordered by rank)
let bandDraft = null;     // working copy while editing the ladder
let active = null;        // in-progress session
let pick = { location: null, workoutId: null };

const esc = s => (s == null ? '' : String(s).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));

// ---- boot --------------------------------------------------------------

async function boot() {
  PROG = await loadProgram();
  BANDS = await loadBands(PROG.program); // resistance-band ladder (equipment, survives program import)
  active = await getMeta('active_session'); // resume mid-workout if any
  window.addEventListener('hashchange', render);
  appEl.addEventListener('click', onClick);
  appEl.addEventListener('input', onInput);
  appEl.addEventListener('change', onInput);
  render();
  registerSW();
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  // Only a *replacement* controller means "new version live" — on first install
  // there is no controller yet, so that claim shouldn't trigger the banner.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) updateBanner();
  });
  navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

// Persistent "app updated" banner — cache-first serving means the running page
// is still the old version until it reloads, so tell the user instead of
// waiting for them to remember.
function updateBanner() {
  if (document.getElementById('sw-update-banner')) return;
  const bar = document.createElement('button');
  bar.id = 'sw-update-banner';
  bar.className = 'notice good updatebar';
  bar.textContent = 'App updated — tap to reload';
  bar.addEventListener('click', () => location.reload());
  document.body.appendChild(bar);
}

// ---- router ------------------------------------------------------------

function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, arg] = h.split('/').filter(Boolean).length
    ? [h.split('/').filter(Boolean)[0], h.split('/').filter(Boolean)[1]]
    : ['', null];
  return { path, arg };
}

async function render() {
  const { path, arg } = route();
  if (path !== 'bands') bandDraft = null; // discard unsaved ladder edits on leaving
  appEl.classList.toggle('has-actionbar', path === 'workout' || path === 'pick');
  document.querySelectorAll('.topnav a').forEach(a =>
    a.classList.toggle('active', a.getAttribute('href') === '#/' + path));
  syncTimers(path);
  let html = '';
  switch (path) {
    case '': html = homeScreen(); break;
    case 'pick': html = pickScreen(); break;
    case 'workout': html = await workoutScreen(); break;
    case 'history': html = await historyScreen(); break;
    case 'session': html = await sessionScreen(arg); break;
    case 'export': html = await exportScreen(); break;
    case 'import': html = await importScreen(); break;
    case 'program': html = programScreen(); break;
    case 'bands': html = await bandsScreen(); break;
    default: html = homeScreen();
  }
  appEl.innerHTML = html;
}

// ---- screens -----------------------------------------------------------

function homeScreen() {
  const p = PROG.program;
  const srcNote = PROG.source === 'imported'
    ? `<div class="notice good">Using Coach Claude's imported program (v${esc(p.version || '?')}).</div>`
    : '';
  const resume = active ? `
      <a class="tile resume" href="#/workout">
        <div class="big">▶ Resume workout</div>
        <div class="sub">${esc(active.workoutName)} · ${esc(active.locationName)} · ${esc(active.date)}</div>
      </a>` : '';
  return `
    <h1>Coach Claude</h1>
    <p class="lead">${esc(p.goal || 'Training')}</p>
    ${srcNote}
    <div class="tiles">
      ${resume}
      <a class="tile" href="#/pick">
        <div class="big">${active ? 'Start a different workout' : '▶ Start a workout'}</div>
        <div class="sub">Pick where you are and what you're training</div>
      </a>
      <a class="tile" href="#/history">
        <div class="big">History</div>
        <div class="sub">Review and edit past sessions</div>
      </a>
      <a class="tile" href="#/export">
        <div class="big">Export for weekly check-in</div>
        <div class="sub">Hand Coach Claude a clean log</div>
      </a>
      <a class="tile" href="#/import">
        <div class="big">Import updated program</div>
        <div class="sub">Load the plan Claude sends back</div>
      </a>
      <a class="tile" href="#/program">
        <div class="big">View program &amp; rules</div>
        <div class="sub">${esc((p.workouts || []).map(w => w.name).join(' · '))}</div>
      </a>
      <a class="tile" href="#/bands">
        <div class="big">Resistance bands</div>
        <div class="sub">${esc(BANDS.map(bandDisplay).join(' · ') || 'Set up your band ladder')}</div>
      </a>
    </div>`;
}

function pickScreen() {
  const p = PROG.program;
  const inProgress = active ? `
    <div class="notice warn">A workout is in progress (${esc(active.workoutName)}) —
      <a href="#/workout">resume it</a>. Beginning a new one replaces it.</div>` : '';
  const locChips = p.locations.map(l => `
    <button class="chip ${pick.location === l.id ? 'selected' : ''}" aria-pressed="${pick.location === l.id}" data-pick-loc="${esc(l.id)}">
      ${esc(l.name)}<span class="hint">${esc(l.hint || '')}</span>
    </button>`).join('');
  const wChips = p.workouts.map(w => `
    <button class="chip ${pick.workoutId === w.id ? 'selected' : ''}" aria-pressed="${pick.workoutId === w.id}" data-pick-workout="${esc(w.id)}">
      ${esc(w.name)}<span class="hint">${esc(w.focus || '')}</span>
    </button>`).join('');

  let preview = '';
  if (pick.location && pick.workoutId) {
    const v = resolveVariant(p, pick.workoutId, pick.location);
    if (v) {
      const items = v.exercises.map(e =>
        `<li>${esc(e.name)} <span class="muted small">${esc(targetText(e))}</span></li>`).join('');
      preview = `<h2>Preview</h2><div class="card"><ul>${items}</ul></div>`;
    }
  }
  const ready = pick.location && pick.workoutId;
  return `
    <h1>Start a workout</h1>
    ${inProgress}
    <h2>Where are you?</h2>
    <div class="chips">${locChips}</div>
    <h2>What are you training?</h2>
    <div class="chips">${wChips}</div>
    ${preview}
    <div class="actionbar">
      <a class="btn ghost" href="#/">Cancel</a>
      <button class="btn primary" data-action="begin" ${ready ? '' : 'disabled'}>Begin →</button>
    </div>`;
}

function targetText(e) {
  if (e.kind === 'circuit') {
    return `${e.rounds || ''} rounds${e.rest ? ', rest ' + e.rest : ''}`;
  }
  const bits = [];
  if (e.sets) bits.push(`${e.sets}×${e.reps || ''}`);
  else if (e.reps) bits.push(e.reps);
  if (e.load) bits.push(e.load);
  return bits.join(' · ');
}

async function workoutScreen() {
  if (!active) return `<div class="empty">No workout in progress.<br><a class="btn primary" href="#/pick" style="margin-top:16px">Start one</a></div>`;
  const s = active;
  const last = await lastSessionOfType(s.workoutId);
  const warmupItems = (s.warmup || []).map(w => `<li>${esc(w)}</li>`).join('');
  const warmup = (s.warmup && s.warmup.length) ? `
    <div class="card warmup">
      <label><input type="checkbox" data-warmup ${s.warmupDone ? 'checked' : ''}/> <strong>Warm-up done</strong></label>
      <ul>${warmupItems}</ul>
    </div>` : '';

  const entries = s.entries.map((e, i) => entryCard(e, i, last)).join('');
  const elapsedSec = Math.max(0, Math.floor((Date.now() - Date.parse(s.startedAt)) / 1000));
  const elapsedMin = Math.max(1, Math.round(elapsedSec / 60));
  const useElapsed = s.date === todayISO()
    ? `<button class="btn sm ghost" data-action="use-elapsed">use elapsed (~${elapsedMin} min)</button>` : '';
  return `
    <h1>${esc(s.workoutName)} <span class="pill">${esc(s.locationName)}</span> <span class="pill timer" id="elapsed-timer">⏱ ${fmtClock(elapsedSec)}</span></h1>
    <div class="card datebox">
      <label class="field" for="session-date">Training date</label>
      <input type="date" id="session-date" data-session-date value="${esc(s.date)}" max="${esc(todayISO())}" />
      <p class="muted small">Defaults to today — set it to the day you actually trained if you're logging late. Tap fields below to log; everything saves on-device.</p>
    </div>
    ${warmup}
    ${entries}
    <div class="card">
      <label class="field">Session notes</label>
      <textarea data-session-notes placeholder="How it felt, pain flags, time crunch, form notes...">${esc(s.notes || '')}</textarea>
      <label class="field">Duration (min)</label>
      <div class="duration-row">
        <input inputmode="numeric" data-session-duration value="${esc(s.durationMin ?? '')}" placeholder="e.g. 58" style="max-width:140px" />
        ${useElapsed}
      </div>
    </div>
    ${restBarHTML()}
    <div class="actionbar">
      <button class="btn ghost" data-action="discard">Discard</button>
      <button class="btn good" data-action="finish">Finish &amp; Save</button>
    </div>`;
}

// Most recent saved session of this workout type, mapped entry-name → shorthand
// ("last session of this type" is what progression targets read from).
async function lastSessionOfType(workoutId) {
  const sessions = await getSessions(); // already sorted newest-first
  const prev = sessions.find(x => x.workoutId === workoutId);
  if (!prev) return null;
  const byName = {};
  for (const e of prev.entries || []) {
    if (e.skipped) continue;
    const summary = entrySummary(e);
    if (summary) byName[e.name] = summary;
  }
  return Object.keys(byName).length ? { date: prev.date, byName } : null;
}

function entryCard(e, i, last) {
  const badge = e.optional ? '<span class="badge opt">optional</span>' : '';
  const skip = `<button class="btn sm ghost" data-skip="${i}">${e.skipped ? 'Un-skip' : 'Skip'}</button>`;
  const lastLine = (last && last.byName[e.name])
    ? `<div class="lasttime">Last time (${esc(last.date)}): ${esc(last.byName[e.name])}</div>` : '';
  const cues = e.cues ? `<p class="cues">${esc(e.cues)}</p>` : '';
  const movements = e.target.movements
    ? `<ul class="movements">${e.target.movements.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : '';
  const rows = e.skipped ? '' : renderRows(e, i);
  const addBtn = (e.skipped || e.kind === 'interval' || e.kind === 'conditioning') ? '' :
    `<button class="btn sm ghost addrow" data-addrow="${i}">+ ${e.kind === 'circuit' ? 'round' : 'set'}</button>`;
  const addInterval = (!e.skipped && (e.kind === 'interval' || e.kind === 'conditioning'))
    ? `<button class="btn sm ghost addrow" data-addrow="${i}">+ ${e.kind === 'interval' ? 'segment' : 'block'}</button>` : '';
  return `
    <div class="card entry ${e.skipped ? 'skipped' : ''}">
      <div class="entry-head">
        <div>
          <div class="entry-title">${esc(e.name)} ${badge}</div>
          <div class="target">${esc(targetLine(e))}</div>
          ${lastLine}
        </div>
        ${skip}
      </div>
      ${cues}
      ${movements}
      ${rows}
      ${addBtn}${addInterval}
    </div>`;
}

function targetLine(e) {
  const t = e.target;
  if (e.kind === 'circuit') return `${t.rounds || ''} rounds${t.rest ? ' · rest ' + t.rest : ''}`;
  const bits = [];
  if (t.sets) bits.push(`${t.sets}×${t.reps || ''}`);
  else if (t.reps) bits.push(t.reps);
  if (t.load) bits.push(t.load);
  return bits.join('  ·  ');
}

// --- per-kind row rendering ---
const NUM = 'inputmode="numeric"';
const DEC = 'inputmode="decimal"';

function inp(i, r, f, val, ph, mode) {
  return `<input ${mode || ''} data-e="${i}" data-r="${r}" data-f="${f}" value="${esc(val ?? '')}" placeholder="${esc(ph)}" />`;
}
function countSelect(i, r, val) {
  const opt = (v, label) => `<option value="${v}" ${String(val) === v ? 'selected' : ''}>${label}</option>`;
  return `<select data-e="${i}" data-r="${r}" data-f="count">
    ${opt('2', '×2')}${opt('1', '×1')}${opt('', 'bar/bw')}</select>`;
}
// Band picker for a set: ordered by rank (lightest first), shows color/label.
// The chosen rank is stored as the load; the label is denormalized for export.
function bandSelect(i, r, val) {
  const has = BANDS.length > 0;
  const cur = val == null ? '' : String(val);
  const known = BANDS.some(b => String(b.rank) === cur);
  const opts = BANDS.map(b =>
    `<option value="${b.rank}" ${cur === String(b.rank) ? 'selected' : ''}>${esc(bandDisplay(b))}</option>`).join('');
  // A stored band no longer in the ladder still shows, so history stays readable.
  const orphan = (!known && cur !== '')
    ? `<option value="${esc(cur)}" selected>Band ${esc(cur)} (removed)</option>` : '';
  const placeholder = `<option value="" ${cur === '' ? 'selected' : ''}>${has ? 'band…' : 'no bands set'}</option>`;
  return `<select class="bandpick" data-e="${i}" data-r="${r}" data-f="bandRank">${placeholder}${orphan}${opts}</select>`;
}
function del(i, r) { return `<button class="iconbtn" data-delrow="${i}" data-r="${r}" title="remove">×</button>`; }

function renderRows(e, i) {
  const kind = e.kind;
  const uni = e.unilateral;
  // Strength load type is shared across an entry's sets; read it off the first
  // row (rows are kept in lock-step by the load-type toggle / addRow).
  const band = kind === 'strength' && e.rows[0] && e.rows[0].loadType === 'band';

  const labels = ({
    strength: band
      ? (uni ? ['', 'band', 'L reps', 'R reps', 'L RPE', 'R RPE', ''] : ['', 'band', 'reps', 'RPE', ''])
      : (uni ? ['', 'wt', '', 'L reps', 'R reps', 'L RPE', 'R RPE', ''] : ['', 'weight', '', 'reps', 'RPE', '']),
    amrap: ['', 'reps', 'RPE', ''],
    hold: uni ? ['', 'L sec', 'R sec', 'RPE', ''] : ['', 'seconds', 'RPE', ''],
    carry: ['', 'weight', '', 'steps', 'RPE', ''],
    circuit: ['', 'time (mm:ss)', 'RPE', ''],
    interval: ['', 'duration', 'speed/pace', ''],
    conditioning: ['', 'what you did', 'RPE', '']
  })[kind] || ['', ''];

  const cls = ({
    strength: band
      ? (uni ? 'row-strength-band-uni' : 'row-strength-band')
      : (uni ? 'row-strength-uni' : 'row-strength'),
    amrap: 'row-amrap', hold: uni ? 'row-hold-uni' : 'row-hold',
    carry: 'row-carry', circuit: 'row-circuit', interval: 'row-interval',
    conditioning: 'row-conditioning'
  })[kind] || 'row-amrap';

  const loadToggle = kind === 'strength' ? strengthLoadToggle(i, band) : '';
  const labelRow = `<div class="row ${cls} rowlabels">${labels.map(l => `<div>${l}</div>`).join('')}</div>`;
  const rows = e.rows.map((r, ri) => {
    const idx = `<div class="idx">${ri + 1}</div>`;
    let cells = '';
    if (kind === 'strength' && band && uni) {
      cells = idx + bandSelect(i, ri, r.bandRank)
        + inp(i, ri, 'repsL', r.repsL, 'L', NUM) + inp(i, ri, 'repsR', r.repsR, 'R', NUM)
        + inp(i, ri, 'rpeL', r.rpeL, 'L', DEC) + inp(i, ri, 'rpeR', r.rpeR, 'R', DEC) + del(i, ri);
    } else if (kind === 'strength' && band) {
      cells = idx + bandSelect(i, ri, r.bandRank)
        + inp(i, ri, 'reps', r.reps, 'reps', NUM) + inp(i, ri, 'rpe', r.rpe, '', DEC) + del(i, ri);
    } else if (kind === 'strength' && uni) {
      cells = idx + inp(i, ri, 'weight', r.weight, 'lb', DEC) + countSelect(i, ri, r.count)
        + inp(i, ri, 'repsL', r.repsL, 'L', NUM) + inp(i, ri, 'repsR', r.repsR, 'R', NUM)
        + inp(i, ri, 'rpeL', r.rpeL, 'L', DEC) + inp(i, ri, 'rpeR', r.rpeR, 'R', DEC) + del(i, ri);
    } else if (kind === 'strength') {
      cells = idx + inp(i, ri, 'weight', r.weight, 'lb', DEC) + countSelect(i, ri, r.count)
        + inp(i, ri, 'reps', r.reps, 'reps', NUM) + inp(i, ri, 'rpe', r.rpe, '', DEC) + del(i, ri);
    } else if (kind === 'amrap') {
      cells = idx + inp(i, ri, 'reps', r.reps, 'reps', NUM) + inp(i, ri, 'rpe', r.rpe, '', DEC) + del(i, ri);
    } else if (kind === 'hold' && uni) {
      cells = idx + inp(i, ri, 'secondsL', r.secondsL, 'L', '') + inp(i, ri, 'secondsR', r.secondsR, 'R', '')
        + inp(i, ri, 'rpe', r.rpe, '', DEC) + del(i, ri);
    } else if (kind === 'hold') {
      cells = idx + inp(i, ri, 'seconds', r.seconds, '40s or 1:15', '') + inp(i, ri, 'rpe', r.rpe, '', DEC) + del(i, ri);
    } else if (kind === 'carry') {
      cells = idx + inp(i, ri, 'weight', r.weight, 'lb', DEC) + countSelect(i, ri, r.count)
        + inp(i, ri, 'steps', r.steps, 'steps', '') + inp(i, ri, 'rpe', r.rpe, '', DEC) + del(i, ri);
    } else if (kind === 'circuit') {
      cells = idx + inp(i, ri, 'time', r.time, 'mm:ss', '') + inp(i, ri, 'rpe', r.rpe, '', DEC) + del(i, ri);
    } else if (kind === 'interval') {
      cells = idx + inp(i, ri, 'duration', r.duration, '60s', '') + inp(i, ri, 'speed', r.speed, '7.0 mph', '') + del(i, ri);
    } else if (kind === 'conditioning') {
      cells = idx + inp(i, ri, 'summary', r.summary, 'e.g. 15 min, 10% incline, 2.5mph', '') + inp(i, ri, 'rpe', r.rpe, '', DEC) + del(i, ri);
    }
    const note = `<div class="notefield">${inp(i, ri, 'note', r.note, 'note (optional)', '')}</div>`;
    return `<div class="row ${cls}">${cells}</div>${note}`;
  }).join('');
  return `${loadToggle}<div class="rows">${labelRow}${rows}</div>`;
}

// Weight ↔ Band switch for a strength entry. Band is the load for resistance-
// band work (color = load); weight keeps the lb + implement-count behavior.
function strengthLoadToggle(i, band) {
  const btn = (lt, label, on) =>
    `<button class="loadtype-btn ${on ? 'on' : ''}" aria-pressed="${on}" data-loadtype="${i}" data-lt="${lt}">${label}</button>`;
  return `<div class="loadtype" role="group" aria-label="Load type">
    <span class="loadtype-label">Load</span>
    ${btn('weight', 'Weight', !band)}${btn('band', 'Band', band)}
  </div>`;
}

// ---- timers --------------------------------------------------------------
// One 1 Hz interval runs while the workout screen is up; it repaints the
// elapsed clock and rest countdown by textContent only (no re-render, so
// input focus is never disturbed mid-set).

let tickInterval = null;
let restEndsAt = null; // epoch ms when the rest countdown finishes

function syncTimers(path) {
  const on = path === 'workout' && !!active;
  if (on && !tickInterval) tickInterval = setInterval(tickTimers, 1000);
  if (!on && tickInterval) { clearInterval(tickInterval); tickInterval = null; restEndsAt = null; }
}

function fmtClock(totalSec) {
  const m = Math.floor(totalSec / 60), s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function tickTimers() {
  if (!active) return;
  const el = document.getElementById('elapsed-timer');
  if (el) {
    const sec = Math.max(0, Math.floor((Date.now() - Date.parse(active.startedAt)) / 1000));
    el.textContent = '⏱ ' + fmtClock(sec);
  }
  if (restEndsAt != null) {
    const left = Math.ceil((restEndsAt - Date.now()) / 1000);
    if (left <= 0) {
      restEndsAt = null;
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      flash('Rest done — next set');
      render();
    } else {
      const rest = document.getElementById('rest-remaining');
      if (rest) rest.textContent = fmtClock(left);
    }
  }
}

// Rest pill above the actionbar: presets when idle, tap-to-cancel countdown when running.
function restBarHTML() {
  if (restEndsAt != null) {
    const left = Math.max(0, Math.ceil((restEndsAt - Date.now()) / 1000));
    return `<div class="restbar">
      <span class="restbar-label">Rest</span>
      <button class="restbtn on" data-action="rest-cancel" title="cancel rest timer"><span id="rest-remaining">${fmtClock(left)}</span> ✕</button>
    </div>`;
  }
  const btn = s => `<button class="restbtn" data-rest="${s}">${fmtClock(s)}</button>`;
  return `<div class="restbar"><span class="restbar-label">Rest</span>${btn(60)}${btn(90)}${btn(120)}</div>`;
}

async function historyScreen() {
  const sessions = await getSessions();
  if (!sessions.length) {
    return `<h1>History</h1><div class="empty">No sessions logged yet.<br><a class="btn primary" href="#/pick" style="margin-top:16px">Start your first</a></div>`;
  }
  const items = sessions.map(s => `
    <a class="tile hist-item" href="#/session/${esc(s.id)}">
      <div>
        <div class="big">${esc(s.workoutName)}</div>
        <div class="when">${esc(s.date)} · ${esc(s.locationName)}${s.durationMin ? ' · ' + esc(s.durationMin) + ' min' : ''}</div>
      </div>
      <span class="muted">›</span>
    </a>`).join('');
  return `<h1>History</h1><div class="hist">${items}</div>`;
}

async function sessionScreen(id) {
  const s = await getSession(id);
  if (!s) return `<div class="empty">Session not found.</div>`;
  const md = sessionMarkdown(s);
  return `
    <h1>${esc(s.workoutName)}</h1>
    <div class="card datebox">
      <label class="field" for="edit-date">Training date</label>
      <input type="date" id="edit-date" data-edit-date="${esc(s.id)}" value="${esc(s.date)}" max="${esc(todayISO())}" />
      <p class="muted small">${esc(s.locationName)}${s.durationMin ? ' · ' + esc(s.durationMin) + ' min' : ''} · change the date if this was trained on a different day.</p>
    </div>
    <pre class="export">${esc(md)}</pre>
    <div class="btn-row">
      <button class="btn danger" data-del-session="${esc(s.id)}">Delete</button>
      <a class="btn ghost" href="#/history">Back</a>
    </div>`;
}

async function exportScreen() {
  const sessions = await getSessions();
  const lastCheckIn = await getMeta('last_checkin');
  const since = lastCheckIn || isoDaysAgo(7);
  const scoped = filterSince(sessions, since);
  const md = toMarkdown(scoped);
  const note = lastCheckIn
    ? `Showing ${scoped.length} session(s) since your last check-in (${esc(lastCheckIn)}).`
    : `Showing ${scoped.length} session(s) from the last 7 days. (No check-in marked yet.)`;
  return `
    <h1>Export for check-in</h1>
    <div class="notice">${note}</div>
    <p class="muted small">Copy this into your Coach Claude chat and ask for a weekly adjustment. Claude returns an updated <code>program.json</code> you load under Import.</p>
    <pre class="export" id="export-md">${esc(md)}</pre>
    <div class="btn-row">
      <button class="btn primary" data-copy="prompt">Copy with Claude prompt</button>
    </div>
    <div class="btn-row">
      <button class="btn ghost" data-copy="md">Copy Markdown</button>
      <button class="btn ghost" data-copy="json">Copy JSON</button>
    </div>
    <div class="btn-row">
      <button class="btn ghost" data-download="md">Download .md</button>
      <button class="btn ghost" data-download="json">Download .json</button>
    </div>
    <div class="btn-row">
      <button class="btn good" data-action="mark-checkin">Mark check-in done (${esc(new Date().toISOString().slice(0,10))})</button>
    </div>
    <p class="muted small">Marking a check-in sets the "since" date so your next export only shows new work.</p>`;
}

async function importScreen() {
  const canRoll = await hasRollback();
  return `
    <h1>Import program</h1>
    <p class="muted small">Paste the <code>program.json</code> Coach Claude gives you, or load a file. Your current program is kept for one-tap rollback.</p>
    <div class="card">
      <label class="field">Paste program JSON</label>
      <textarea id="import-text" placeholder='{ "version": "...", "locations": [...], "workouts": [...] }'></textarea>
      <div class="btn-row">
        <button class="btn primary" data-action="import-paste">Load pasted JSON</button>
        <label class="btn ghost" style="cursor:pointer">Choose file…
          <input type="file" id="import-file" accept="application/json,.json" hidden />
        </label>
      </div>
      <div id="import-msg"></div>
    </div>
    <div class="btn-row">
      ${canRoll ? '<button class="btn ghost" data-action="rollback">↶ Roll back to previous</button>' : ''}
      <button class="btn ghost" data-action="reset-program">Reset to built-in</button>
    </div>
    <p class="muted small">Current source: <strong>${esc(PROG.source)}</strong>${PROG.program.version ? ' · v' + esc(PROG.program.version) : ''}</p>`;
}

function programScreen() {
  const p = PROG.program;
  const global = (p.globalRules || []).map(r => `<li>${esc(r)}</li>`).join('');
  const workouts = p.workouts.map(w => `
    <div class="card">
      <h3>${esc(w.name)}</h3>
      <p class="muted small">${esc(w.focus || '')}${w.timeCapMin ? ' · ~' + w.timeCapMin + ' min cap' : ''}</p>
      <ul class="rules">${(w.rules || []).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      <p class="small">${Object.keys(w.variants).map(k => `<span class="pill">${esc(loc(k))}</span>`).join('')}</p>
    </div>`).join('');
  return `
    <h1>Program &amp; rules</h1>
    <div class="card"><h3>Global</h3><ul class="rules">${global}</ul></div>
    ${workouts}
    <div class="btn-row"><a class="btn ghost" href="#/import">Manage / import program</a></div>`;
}
function loc(id) { const l = getLocation(PROG.program, id); return l ? l.name : id; }

// ---- bands editor ------------------------------------------------------
// The ladder is the user's real equipment, so it's fully editable: reorder
// (which renumbers rank), rename, recolor, edit lb ranges, add/remove. Edits
// persist to a meta override so a program import/rollback never wipes them.

async function bandsScreen() {
  if (!bandDraft) bandDraft = BANDS.map(b => ({ ...b }));
  const overridden = await hasBandOverride();
  const bfield = (bi, f, val, ph, mode) =>
    `<input ${mode || ''} data-band-field="${f}" data-bi="${bi}" value="${esc(val ?? '')}" placeholder="${esc(ph)}" />`;

  const rows = bandDraft.map((b, bi) => {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(b.colorHex || '') ? b.colorHex : '#888888';
    const up = bi > 0 ? `<button class="iconbtn" data-band-move="${bi}" data-dir="up" title="move up">↑</button>` : '<span class="iconbtn ghosted">↑</span>';
    const down = bi < bandDraft.length - 1 ? `<button class="iconbtn" data-band-move="${bi}" data-dir="down" title="move down">↓</button>` : '<span class="iconbtn ghosted">↓</span>';
    return `
      <div class="card band-edit">
        <div class="band-edit-head">
          <span class="swatch" style="background:${esc(hex)}"></span>
          <span class="rank-pill">rank ${bi + 1}</span>
          <span class="spacer"></span>
          ${up}${down}
          <button class="iconbtn del" data-band-del="${bi}" title="remove band">×</button>
        </div>
        <div class="band-grid">
          <label class="field">Color</label>
          <label class="field">Tension label</label>
          <label class="field">Swatch</label>
          ${bfield(bi, 'color', b.color, 'e.g. Dark Green')}
          ${bfield(bi, 'label', b.label, 'e.g. Heavy')}
          <input type="color" class="hexpick" data-band-field="colorHex" data-bi="${bi}" value="${esc(hex)}" />
          <label class="field">lb range low</label>
          <label class="field">lb range high</label>
          <span></span>
          ${bfield(bi, 'lbRangeLow', b.lbRangeLow, 'low', DEC)}
          ${bfield(bi, 'lbRangeHigh', b.lbRangeHigh, 'high', DEC)}
          <span></span>
        </div>
      </div>`;
  }).join('');

  const srcNote = overridden
    ? '<div class="notice good">Using your edited band ladder (saved on-device).</div>'
    : `<div class="notice">Using the ${PROG.program && Array.isArray(PROG.program.bands) && PROG.program.bands.length ? 'program' : 'built-in'} default ladder. Edits below are saved separately and survive program imports.</div>`;

  return `
    <h1>Resistance bands</h1>
    <p class="muted small">Rank is the load (lightest = rank 1). Reorder to renumber; the lb range just displays alongside — the app never infers rank from it. Bands are your equipment, so this list is yours to edit.</p>
    ${srcNote}
    ${rows || '<div class="empty">No bands yet.</div>'}
    <div class="btn-row">
      <button class="btn ghost" data-action="band-add">+ Add band</button>
    </div>
    <div class="btn-row">
      <button class="btn good" data-action="band-save">Save ladder</button>
      <a class="btn ghost" href="#/">Done</a>
    </div>
    ${overridden ? '<div class="btn-row"><button class="btn ghost" data-action="band-reset">Reset to default ladder</button></div>' : ''}
    <p class="muted small">Config path: bands also live in <code>program.json</code> as a <code>bands</code> array, so an imported program can seed them too.</p>`;
}

function onBandDraftInput(t) {
  if (!bandDraft) return;
  const bi = +t.dataset.bi, f = t.dataset.bandField;
  if (!bandDraft[bi]) return;
  let val = t.value;
  if (f === 'lbRangeLow' || f === 'lbRangeHigh') val = val === '' ? null : Number(val);
  bandDraft[bi][f] = val;
  // No re-render on keystroke (keeps input focus); swatch updates live for the picker.
  if (f === 'colorHex') {
    const head = t.closest('.band-edit');
    const sw = head && head.querySelector('.swatch');
    if (sw) sw.style.background = val;
  }
}

// Reorder renumbers rank to match display position (1-based) — rank is set by
// order here, deliberately, not inferred from lb numbers.
function renumberDraft() { bandDraft.forEach((b, i) => { b.rank = i + 1; }); }

function moveBandDraft(idx, dir) {
  const to = dir === 'up' ? idx - 1 : idx + 1;
  if (to < 0 || to >= bandDraft.length) return;
  const [b] = bandDraft.splice(idx, 1);
  bandDraft.splice(to, 0, b);
  renumberDraft();
  render();
}

function deleteBandDraft(idx) {
  bandDraft.splice(idx, 1);
  renumberDraft();
  render();
}

function addBandDraft() {
  const nextRank = bandDraft.length + 1;
  bandDraft.push({ rank: nextRank, label: '', color: '', colorHex: '#888888', lbRangeLow: null, lbRangeHigh: null });
  render();
}

async function saveBandDraft() {
  renumberDraft();
  BANDS = await saveBands(bandDraft);
  bandDraft = null;
  flash('Band ladder saved');
  location.hash = '#/';
}

async function resetBandDraft() {
  if (!confirm('Reset to the default band ladder? Your edits will be removed.')) return;
  await resetBands();
  BANDS = await loadBands(PROG.program);
  bandDraft = null;
  flash('Reset to default ladder');
  render();
}

// ---- events ------------------------------------------------------------

let saveTimer = null;
function persistActive() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (active) setMeta('active_session', active); }, 300);
}

function onInput(ev) {
  const t = ev.target;
  if (t.dataset.e !== undefined && active) {
    const e = +t.dataset.e, r = +t.dataset.r, f = t.dataset.f;
    const row = active.entries[e].rows[r];
    let val = t.value;
    if (f === 'count') val = val === '' ? null : +val;
    if (f === 'bandRank') {
      // Store the ordinal rank (source of truth for progression) and denormalize
      // the color/label so export + history read without the ladder in hand.
      val = val === '' ? null : +val;
      row.bandRank = val;
      const b = findBandByRank(BANDS, val);
      row.bandLabel = b ? bandDisplay(b) : '';
      persistActive();
      return;
    }
    row[f] = val;
    persistActive();
    return;
  }
  if (t.dataset.bandField !== undefined) { return onBandDraftInput(t); }
  if (t.dataset.sessionDate !== undefined && active) {
    if (t.value) { active.date = t.value; persistActive(); } // ignore a cleared field
    return;
  }
  if (t.dataset.editDate !== undefined) { return editSessionDate(t.dataset.editDate, t.value); }
  if (t.dataset.warmup !== undefined && active) { active.warmupDone = t.checked; persistActive(); return; }
  if (t.dataset.sessionNotes !== undefined && active) { active.notes = t.value; persistActive(); return; }
  if (t.dataset.sessionDuration !== undefined && active) {
    active.durationMin = t.value === '' ? null : +t.value; persistActive(); return;
  }
  if (t.id === 'import-file') { handleFile(t.files && t.files[0]); }
}

async function onClick(ev) {
  const t = ev.target.closest('[data-action],[data-pick-loc],[data-pick-workout],[data-addrow],[data-delrow],[data-skip],[data-del-session],[data-copy],[data-download],[data-loadtype],[data-band-move],[data-band-del],[data-rest]');
  if (!t) return;

  if (t.dataset.rest !== undefined) {
    restEndsAt = Date.now() + (+t.dataset.rest) * 1000;
    return render();
  }

  if (t.dataset.pickLoc) { pick.location = t.dataset.pickLoc; return render(); }
  if (t.dataset.pickWorkout) { pick.workoutId = t.dataset.pickWorkout; return render(); }

  if (t.dataset.loadtype !== undefined && active) {
    const e = +t.dataset.loadtype;
    setEntryLoadType(active.entries[e], t.dataset.lt);
    persistActive();
    return render();
  }
  if (t.dataset.bandMove !== undefined) return moveBandDraft(+t.dataset.bandMove, t.dataset.dir);
  if (t.dataset.bandDel !== undefined) return deleteBandDraft(+t.dataset.bandDel);

  if (t.dataset.addrow !== undefined && active) { addRow(active.entries[+t.dataset.addrow]); persistActive(); return render(); }
  if (t.dataset.delrow !== undefined && active) {
    const e = +t.dataset.delrow, r = +t.dataset.r;
    if (active.entries[e].rows.length > 1) removeRow(active.entries[e], r);
    persistActive(); return render();
  }
  if (t.dataset.skip !== undefined && active) {
    const e = +t.dataset.skip; active.entries[e].skipped = !active.entries[e].skipped;
    persistActive(); return render();
  }

  const action = t.dataset.action;
  if (action === 'begin') return beginWorkout();
  if (action === 'discard') return discardWorkout();
  if (action === 'finish') return finishWorkout();
  if (action === 'rest-cancel') { restEndsAt = null; return render(); }
  if (action === 'use-elapsed' && active) {
    active.durationMin = Math.max(1, Math.round((Date.now() - Date.parse(active.startedAt)) / 60000));
    persistActive();
    return render();
  }
  if (action === 'mark-checkin') { await setMeta('last_checkin', new Date().toISOString().slice(0, 10)); return render(); }
  if (action === 'import-paste') return importPaste();
  if (action === 'rollback') return doRollback();
  if (action === 'reset-program') return doReset();
  if (action === 'band-add') return addBandDraft();
  if (action === 'band-save') return saveBandDraft();
  if (action === 'band-reset') return resetBandDraft();

  if (t.dataset.delSession) {
    if (confirm('Delete this session?')) { await deleteSession(t.dataset.delSession); location.hash = '#/history'; }
    return;
  }
  if (t.dataset.copy) return copyExport(t.dataset.copy);
  if (t.dataset.download) return downloadExport(t.dataset.download);
}

async function beginWorkout() {
  const p = PROG.program;
  const w = getWorkout(p, pick.workoutId);
  const l = getLocation(p, pick.location);
  const v = resolveVariant(p, pick.workoutId, pick.location);
  if (!w || !l || !v) return;
  if (active && !confirm(`A workout is already in progress (${active.workoutName}) — replace it? Its logged sets will be lost.`)) {
    return;
  }
  active = createSession(w, l, v);
  await setMeta('active_session', active);
  location.hash = '#/workout';
}

async function discardWorkout() {
  if (!confirm('Discard this in-progress workout? Logged sets will be lost.')) return;
  active = null;
  await setMeta('active_session', null);
  location.hash = '#/';
}

async function finishWorkout() {
  if (!active) return;
  const anythingLogged = active.entries.some(isEntryLogged) || active.warmupDone;
  if (!anythingLogged && !confirm('Nothing logged yet — save this session anyway?')) return;
  active.id = active.id || newSessionId();
  await saveSession(active);
  await setMeta('active_session', null);
  const id = active.id;
  active = null;
  location.hash = '#/session/' + id;
}

// Persist a training-date edit on an already-saved session, then re-render so the
// exported markdown/JSON header and history ordering reflect the corrected day.
async function editSessionDate(id, value) {
  if (!value) return; // ignore a cleared field; keep the existing date
  const s = await getSession(id);
  if (!s || s.date === value) return;
  s.date = value;
  await saveSession(s);
  render();
}

// ---- export actions ----------------------------------------------------

async function scopedSessions() {
  const sessions = await getSessions();
  const lastCheckIn = await getMeta('last_checkin');
  return filterSince(sessions, lastCheckIn || isoDaysAgo(7));
}
// Prewritten weekly check-in ask, so a coach chat starts from one paste.
const CHECKIN_PROMPT = `Coach Claude — weekly check-in. Below is my training log since the last check-in.

Please:
1. Give a short assessment of the week (adherence, progression, anything trending the wrong way).
2. Flag anything concerning (pain notes, stalled lifts, missed sessions).
3. Reply with an updated program.json I can import into the app (keep the same schema: locations, workouts, variants, bands).

`;

async function copyExport(kind) {
  const scoped = await scopedSessions();
  const md = kind === 'json' ? null : toMarkdown(scoped);
  const text = kind === 'json' ? toJSON(scoped)
    : kind === 'prompt' ? CHECKIN_PROMPT + md
    : md;
  try { await navigator.clipboard.writeText(text); flash('Copied to clipboard'); }
  catch { flash('Copy failed — long-press the text to select', true); }
}
async function downloadExport(kind) {
  const scoped = await scopedSessions();
  const text = kind === 'md' ? toMarkdown(scoped) : toJSON(scoped);
  const blob = new Blob([text], { type: kind === 'md' ? 'text/markdown' : 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `coach-claude-log-${new Date().toISOString().slice(0, 10)}.${kind}`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function flash(msg, warn) {
  const bar = document.createElement('div');
  bar.className = 'notice ' + (warn ? 'warn' : 'good');
  bar.textContent = msg;
  bar.style.position = 'fixed'; bar.style.left = '14px'; bar.style.right = '14px'; bar.style.bottom = '16px'; bar.style.zIndex = 50;
  document.body.appendChild(bar);
  setTimeout(() => bar.remove(), 2200);
}

// ---- import actions ----------------------------------------------------

async function importPaste() {
  const ta = document.getElementById('import-text');
  await tryImport(ta ? ta.value : '');
}
function handleFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => tryImport(String(reader.result));
  reader.readAsText(file);
}
async function tryImport(text) {
  const msg = document.getElementById('import-msg');
  const show = (html) => { if (msg) msg.innerHTML = html; };
  if (!text || !text.trim()) return show('<div class="notice warn">Nothing to import.</div>');
  try {
    const obj = JSON.parse(text);
    validateProgram(obj);
    await importProgram(obj);
    PROG = await loadProgram(true);
    BANDS = await loadBands(PROG.program); // pick up seeded bands if the user has no override yet
    show(`<div class="notice good">Imported v${esc(PROG.program.version || '?')}. Program updated.</div>`);
  } catch (err) {
    show(`<div class="notice warn">Couldn't import: ${esc(err.message)}</div>`);
  }
}
async function doRollback() {
  try {
    await rollbackProgram();
    PROG = await loadProgram(true);
    BANDS = await loadBands(PROG.program);
    flash('Rolled back to previous program');
    render();
  } catch (e) { flash(e.message, true); }
}
async function doReset() {
  if (!confirm('Reset to the built-in program? Your imported program will be removed.')) return;
  PROG = await resetToBundled();
  BANDS = await loadBands(PROG.program);
  flash('Reset to built-in program');
  render();
}

boot();
