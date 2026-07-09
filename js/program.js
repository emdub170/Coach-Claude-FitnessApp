// program.js — load the training program and resolve workoutType x location.
// The bundled data/program.json is the default; an imported program (from Coach
// Claude) is stored in IndexedDB and overrides it until reset.

import { getMeta, setMeta } from './store.js';

const META_PROGRAM = 'program';
const META_PROGRAM_PREV = 'program_prev';

let cache = null;

async function fetchBundled() {
  const res = await fetch('./data/program.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load bundled program.json');
  return res.json();
}

// Returns { program, source: 'imported' | 'bundled' }
export async function loadProgram(force = false) {
  if (cache && !force) return cache;
  const imported = await getMeta(META_PROGRAM);
  if (imported) {
    cache = { program: imported, source: 'imported' };
  } else {
    cache = { program: await fetchBundled(), source: 'bundled' };
  }
  return cache;
}

export function getWorkout(program, workoutId) {
  return (program.workouts || []).find(w => w.id === workoutId) || null;
}

export function getLocation(program, locationId) {
  return (program.locations || []).find(l => l.id === locationId) || null;
}

// Returns { warmup: [str], exercises: [obj] } for a workout+location, or null.
export function resolveVariant(program, workoutId, locationId) {
  const w = getWorkout(program, workoutId);
  if (!w) return null;
  const v = (w.variants || {})[locationId];
  if (!v) return null;
  return { warmup: v.warmup || [], exercises: v.exercises || [] };
}

// ---- Import / rollback / reset ----------------------------------------

// Throws a descriptive Error if the shape is invalid.
export function validateProgram(p) {
  if (!p || typeof p !== 'object') throw new Error('Program is not an object.');
  if (!Array.isArray(p.locations) || !p.locations.length)
    throw new Error('Program is missing a non-empty "locations" array.');
  if (!Array.isArray(p.workouts) || !p.workouts.length)
    throw new Error('Program is missing a non-empty "workouts" array.');
  for (const w of p.workouts) {
    if (!w.id || !w.name) throw new Error('Every workout needs an "id" and "name".');
    if (!w.variants || typeof w.variants !== 'object')
      throw new Error(`Workout "${w.id}" is missing "variants".`);
    for (const locId of Object.keys(w.variants)) {
      const v = w.variants[locId];
      if (!v || !Array.isArray(v.exercises))
        throw new Error(`Workout "${w.id}" variant "${locId}" needs an "exercises" array.`);
    }
  }
  return true;
}

// Accepts a JS object or a JSON string. Stores the current program as _prev for
// rollback — a sentinel marks "was the built-in default" so rollback works even
// on the very first import.
const BUNDLED_SENTINEL = { __bundled: true };
export async function importProgram(input) {
  const p = typeof input === 'string' ? JSON.parse(input) : input;
  validateProgram(p);
  const current = await getMeta(META_PROGRAM);
  await setMeta(META_PROGRAM_PREV, current || BUNDLED_SENTINEL);
  await setMeta(META_PROGRAM, p);
  cache = null;
  return p;
}

export async function hasRollback() {
  return !!(await getMeta(META_PROGRAM_PREV));
}

export async function rollbackProgram() {
  const prev = await getMeta(META_PROGRAM_PREV);
  if (!prev) throw new Error('No previous program to roll back to.');
  await setMeta(META_PROGRAM_PREV, null);
  if (prev.__bundled) return resetToBundled(); // restore built-in default
  await setMeta(META_PROGRAM, prev);
  cache = null;
  return prev;
}

// Drop the imported program and return to the bundled default.
export async function resetToBundled() {
  await setMeta(META_PROGRAM, null);
  cache = null;
  return loadProgram(true);
}
