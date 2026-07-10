// logger.js — pure helpers for building and mutating an in-progress session.
// No DOM here; app.js owns rendering. Rows are kept mostly as strings so logging
// on a phone stays low-friction; export.js formats them into Coach shorthand.

export function todayISO() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Default count: unilateral single implement = 1, bodyweight = null (bar/none), else pair = 2.
function defaultCount(ex) {
  if (ex.unilateral) return 1;
  if ((ex.load || '').toLowerCase().includes('bodyweight')) return null;
  return 2;
}

export function newRow(kind, ex) {
  const uni = !!(ex && ex.unilateral);
  switch (kind) {
    case 'strength': {
      // loadType picks how this set's load is stored: 'weight' (lbs, the
      // existing behavior) or 'band' (an ordinal tension rank + denormalized
      // label). Defaults to weight; band is chosen per-entry in the logger.
      // Band and per-side reps coexist — band presses are often unilateral.
      // Unilateral strength also tracks effort per side (rpeL/rpeR) — left/right
      // asymmetry is core data for this program. Bilateral keeps a single rpe.
      const base = { loadType: 'weight', weight: '', count: defaultCount(ex), bandRank: null, bandLabel: '' };
      return uni
        ? { ...base, repsL: '', repsR: '', rpeL: '', rpeR: '', note: '' }
        : { ...base, reps: '', rpe: '', note: '' };
    }
    case 'amrap':
      return { reps: '', rpe: '', note: '' };
    case 'hold':
      return uni
        ? { secondsL: '', secondsR: '', rpe: '', note: '' }
        : { seconds: '', rpe: '', note: '' };
    case 'carry':
      return { weight: '', count: defaultCount(ex), steps: '', rpe: '', note: '' };
    case 'circuit':
      return { time: '', rpe: '', note: '' };
    case 'interval':
      return { duration: '', speed: '', note: '' };
    case 'conditioning':
      return { summary: '', rpe: '', note: '' };
    default:
      return { note: '' };
  }
}

function initialRowCount(ex) {
  if (ex.kind === 'circuit') return ex.rounds || 3;
  if (ex.kind === 'interval' || ex.kind === 'conditioning') return 1;
  return ex.sets || 1;
}

export function buildEntry(ex) {
  const rows = [];
  const n = initialRowCount(ex);
  for (let i = 0; i < n; i++) rows.push(newRow(ex.kind, ex));
  return {
    name: ex.name,
    kind: ex.kind,
    cues: ex.cues || '',
    optional: !!ex.optional,
    unilateral: !!ex.unilateral,
    target: {
      sets: ex.sets || null,
      reps: ex.reps || null,
      load: ex.load || null,
      rounds: ex.rounds || null,
      rest: ex.rest || null,
      movements: ex.movements || null
    },
    rows,
    skipped: false
  };
}

export function createSession(workout, location, variant) {
  return {
    id: null, // assigned on save
    // Training date: defaults to today but is user-editable at entry and after.
    // This is the field everything sorts/filters on — NOT startedAt. Back-entered
    // or time-shifted sessions must reflect the day trained, not the day logged.
    date: todayISO(),
    startedAt: new Date().toISOString(), // real entry timestamp, kept for record only
    workoutId: workout.id,
    workoutName: workout.name,
    location: location.id,
    locationName: location.name,
    durationMin: null,
    notes: '',
    warmup: variant.warmup || [],
    warmupDone: false,
    entries: (variant.exercises || []).map(buildEntry)
  };
}

export function addRow(entry) {
  const row = newRow(entry.kind, entry);
  // Inherit the load type (weight vs band) from the previous set so a band
  // exercise keeps showing the band picker on every added set.
  if (entry.kind === 'strength' && entry.rows.length) {
    const prev = entry.rows[entry.rows.length - 1];
    if (prev.loadType) row.loadType = prev.loadType;
  }
  entry.rows.push(row);
  return entry;
}

// Flip an entire strength entry between weight- and band-load logging. Applied
// to every set so the whole exercise shares one load type.
export function setEntryLoadType(entry, loadType) {
  if (entry.kind !== 'strength') return entry;
  entry.rows.forEach(r => { r.loadType = loadType; });
  return entry;
}

export function removeRow(entry, idx) {
  entry.rows.splice(idx, 1);
  return entry;
}

// Has the user entered anything worth exporting for this entry?
export function isRowFilled(kind, row) {
  switch (kind) {
    case 'strength': return !!(row.reps || row.repsL || row.repsR || row.weight || row.bandRank != null && row.bandRank !== '');
    case 'amrap': return !!row.reps;
    case 'hold': return !!(row.seconds || row.secondsL || row.secondsR);
    case 'carry': return !!(row.steps || row.weight);
    case 'circuit': return !!(row.time || row.rpe);
    case 'interval': return !!(row.duration || row.speed);
    case 'conditioning': return !!(row.summary);
    default: return false;
  }
}

export function isEntryLogged(entry) {
  if (entry.skipped) return false;
  return entry.rows.some(r => isRowFilled(entry.kind, r));
}
