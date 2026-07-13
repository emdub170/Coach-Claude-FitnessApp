// export.js — turn logged sessions into a Claude-friendly Markdown report (in
// Mike's own shorthand) and a clean JSON payload. Also date-filtering helpers.

import { isRowFilled } from './logger.js';

function rpe(v) { return v ? ` -${v}` : ''; }

// Load prefix for a set. Band load reads the color/label in brackets so it can
// never be mistaken for a weight (band color IS the load — "[Grey]x20", never
// "0x20"). Weight load keeps the existing prefix: "50.2", "155" (barbell), or
// "BW" (bodyweight). The band label is denormalized onto the row at log time.
function loadPrefix(row) {
  if (row.loadType === 'band') {
    const label = (row.bandLabel ?? '').toString().trim();
    return label ? `[${label}]` : (row.bandRank != null ? `[Band ${row.bandRank}]` : '[band]');
  }
  const w = (row.weight ?? '').toString().trim();
  if (!w) return 'BW';
  if (row.count === 1 || row.count === 2) return `${w}.${row.count}`;
  return `${w}`;
}

function fmtRow(kind, row) {
  switch (kind) {
    case 'strength': {
      const pre = loadPrefix(row);
      if (row.repsL !== undefined) { // unilateral
        // Effort per side. Old records only have a single `rpe`; treat it as
        // applying to both sides (no migration — we just read both shapes).
        const effL = row.rpeL ?? row.rpe;
        const effR = row.rpeR ?? row.rpe;
        // Collapse to a single trailing RPE when both sides match (or only one
        // value exists); split it onto each side when they differ.
        const perSide = (effL || effR) && effL !== effR;
        const parts = [];
        if (row.repsL) parts.push(`${row.repsL}L${perSide ? rpe(effL) : ''}`);
        if (row.repsR) parts.push(`${row.repsR}R${perSide ? rpe(effR) : ''}`);
        const tail = perSide ? '' : rpe(effL || effR);
        return `${pre}x${parts.join(', ')}${tail}`;
      }
      return `${pre}x${row.reps}${rpe(row.rpe)}`;
    }
    case 'amrap':
      return `${row.reps}${rpe(row.rpe)}`;
    case 'hold': {
      if (row.secondsL !== undefined) {
        const parts = [];
        if (row.secondsL) parts.push(`${row.secondsL} L`);
        if (row.secondsR) parts.push(`${row.secondsR} R`);
        return `${parts.join(', ')}${rpe(row.rpe)}`;
      }
      return `${row.seconds}${rpe(row.rpe)}`;
    }
    case 'carry': {
      const pre = loadPrefix(row);
      return `${pre}x${row.steps} steps${rpe(row.rpe)}`;
    }
    case 'circuit':
      return `${row.time}${rpe(row.rpe)}`;
    case 'interval':
      return `${row.duration} x ${row.speed}`.trim();
    case 'conditioning':
      return `${row.summary}${rpe(row.rpe)}`;
    default:
      return '';
  }
}

// The shorthand value of an entry's logged rows (no name prefix, no notes) —
// e.g. "50.2x10 -8, 50.2x9 -9". Also used for "last time" hints in the logger.
export function entrySummary(entry) {
  const filled = entry.rows.filter(r => isRowFilled(entry.kind, r));
  if (!filled.length) return null;
  const pieces = filled.map(r => fmtRow(entry.kind, r));
  if (entry.kind === 'circuit') return `${filled.length} rounds — ${pieces.join(', ')}`;
  if (entry.kind === 'interval') return pieces.join(' / ');
  return pieces.join(', ');
}

function entryLine(entry) {
  const value = entrySummary(entry);
  if (value == null) return null;
  const filled = entry.rows.filter(r => isRowFilled(entry.kind, r));
  // append any per-row notes
  const notes = filled.map(r => r.note).filter(Boolean);
  const noteStr = notes.length ? `  _(${notes.join('; ')})_` : '';
  return `- ${entry.name}: ${value}${noteStr}`;
}

export function sessionMarkdown(s) {
  const head = `## ${s.date} — ${s.workoutName} (${s.locationName})` +
    (s.durationMin ? ` — ${s.durationMin} min` : '');
  const lines = [head];
  if (s.warmupDone) lines.push('- Warm-up: done');
  for (const e of s.entries) {
    if (e.skipped) continue;
    const line = entryLine(e);
    if (line) lines.push(line);
  }
  if (s.notes) lines.push(`\nNotes: ${s.notes}`);
  return lines.join('\n');
}

export function toMarkdown(sessions) {
  const header = `# Coach Claude — Training log\n_Exported ${new Date().toISOString().slice(0, 10)} · ${sessions.length} session${sessions.length === 1 ? '' : 's'}_\n`;
  const body = sessions.map(sessionMarkdown).join('\n\n');
  return `${header}\n${body}\n`;
}

// Clean JSON — strips empty rows so Claude sees only logged data.
export function toJSON(sessions) {
  const clean = sessions.map(s => ({
    date: s.date,
    workoutId: s.workoutId,
    workoutName: s.workoutName,
    location: s.location,
    durationMin: s.durationMin,
    notes: s.notes || '',
    warmupDone: !!s.warmupDone,
    entries: s.entries
      .filter(e => !e.skipped)
      .map(e => ({
        name: e.name,
        kind: e.kind,
        rows: e.rows.filter(r => isRowFilled(e.kind, r))
      }))
      .filter(e => e.rows.length)
  }));
  return JSON.stringify({ sessions: clean }, null, 2);
}

// ---- date helpers ------------------------------------------------------

export function filterSince(sessions, sinceISO) {
  if (!sinceISO) return sessions;
  return sessions.filter(s => s.date >= sinceISO);
}

export function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
