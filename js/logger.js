// logger.js — pure helpers for building and mutating an in-progress session.
// No DOM here; app.js owns rendering. Rows are kept mostly as strings so logging
// on a phone stays low-friction; export.js formats them into Coach shorthand.

function todayISO() {
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
    case 'strength':
      return uni
        ? { weight: '', count: defaultCount(ex), repsL: '', repsR: '', rpe: '', note: '' }
        : { weight: '', count: defaultCount(ex), reps: '', rpe: '', note: '' };
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
    date: todayISO(),
    startedAt: new Date().toISOString(),
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
  entry.rows.push(newRow(entry.kind, entry));
  return entry;
}

export function removeRow(entry, idx) {
  entry.rows.splice(idx, 1);
  return entry;
}

// Has the user entered anything worth exporting for this entry?
export function isRowFilled(kind, row) {
  switch (kind) {
    case 'strength': return !!(row.reps || row.repsL || row.repsR || row.weight);
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
