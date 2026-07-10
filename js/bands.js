// bands.js — the resistance-band "ladder" and pure helpers for it.
//
// Band load is stored on a strength row as an ordinal *tension rank* (integer,
// 1 = lightest, ascending). Rank is the source of truth for progression
// comparison and sorting; the color/label is only what's shown to the user.
// Keeping rank separate from the lb range means a band that isn't in the
// current set (a hotel-gym band, say) can slot into the same 1–N scale later
// without breaking history — the lb numbers just overlap and never define rank.
//
// The ladder lives in program/config data (program.bands) but is *equipment*,
// not program: it survives program import/rollback via a meta override so the
// user's real bands aren't wiped when Claude sends a new plan.

import { getMeta, setMeta } from './store.js';

const META_BANDS = 'bands'; // user-edited override; falls back to program.bands, then DEFAULT_BANDS

// Placeholder ladder — the real one gets set by the user in the Bands editor.
// rank is explicit and is the sort/compare key; lbRange is descriptive only.
export const DEFAULT_BANDS = [
  { rank: 1, label: 'Light',    color: 'Black',       colorHex: '#111318', lbRangeLow: 15, lbRangeHigh: 35 },
  { rank: 2, label: 'Medium',   color: 'Grey',        colorHex: '#9aa3ad', lbRangeLow: 30, lbRangeHigh: 70 },
  { rank: 3, label: 'Heavy',    color: 'Dark Green',  colorHex: '#1e6b3a', lbRangeLow: 50, lbRangeHigh: 124 },
  { rank: 4, label: 'XL Heavy', color: 'Light Green', colorHex: '#6fce8f', lbRangeLow: 65, lbRangeHigh: 175 }
];

// Coerce, sort by rank ascending. Does NOT renumber ranks — rank is set
// explicitly per band (reordering in the editor renumbers deliberately).
export function normalizeBands(list) {
  if (!Array.isArray(list) || !list.length) return DEFAULT_BANDS.map(b => ({ ...b }));
  return list
    .filter(b => b && typeof b === 'object')
    .map(b => ({
      rank: Number(b.rank),
      label: (b.label ?? '').toString(),
      color: (b.color ?? '').toString(),
      colorHex: b.colorHex ? String(b.colorHex) : '',
      lbRangeLow: b.lbRangeLow == null || b.lbRangeLow === '' ? null : Number(b.lbRangeLow),
      lbRangeHigh: b.lbRangeHigh == null || b.lbRangeHigh === '' ? null : Number(b.lbRangeHigh)
    }))
    .filter(b => Number.isFinite(b.rank))
    .sort((a, b) => a.rank - b.rank);
}

// What the user sees: the color is the identity of the band ("the dark green
// band"), so prefer it; fall back to the tension label, then the bare rank.
export function bandDisplay(band) {
  if (!band) return '';
  return band.color || band.label || `Band ${band.rank}`;
}

// Display for a stored row that may only carry a denormalized label (e.g. a
// band no longer in the ladder). Prefer the live band, then the stored label.
export function bandDisplayForRow(row, bands) {
  const b = findBandByRank(bands, row.bandRank);
  if (b) return bandDisplay(b);
  if (row.bandLabel) return row.bandLabel;
  return row.bandRank != null ? `Band ${row.bandRank}` : '';
}

export function findBandByRank(bands, rank) {
  if (rank == null || rank === '') return null;
  const r = Number(rank);
  return (bands || []).find(b => Number(b.rank) === r) || null;
}

// ---- progression comparison -------------------------------------------
// Rank IS the comparison key for band load, exactly like lbs for weight: a
// higher rank = more load = progression. This is the primitive the
// last-session-numbers feature compares with, so band and weight sets rank the
// same way. Weight and band aren't comparable across types (different implement),
// so only same-type comparisons return a sign; mixed types return null.

// Numeric load for ordering within one load type (lbs for weight, rank for band).
export function loadValue(row) {
  if (!row) return null;
  if (row.loadType === 'band') return row.bandRank == null || row.bandRank === '' ? null : Number(row.bandRank);
  const w = row.weight;
  return w == null || w === '' ? null : Number(w);
}

// -1 / 0 / 1 comparing a set to a prior set of the SAME load type; null if the
// types differ or a value is missing (nothing meaningful to compare).
export function compareLoad(row, prevRow) {
  if (!row || !prevRow) return null;
  const ta = row.loadType === 'band' ? 'band' : 'weight';
  const tb = prevRow.loadType === 'band' ? 'band' : 'weight';
  if (ta !== tb) return null;
  const a = loadValue(row), b = loadValue(prevRow);
  if (a == null || b == null) return null;
  return a < b ? -1 : a > b ? 1 : 0;
}

// Human "last time" target for surfacing, e.g. "Grey (rank 2)" or "50 lb".
export function loadSummary(row, bands) {
  if (!row) return '';
  if (row.loadType === 'band') {
    const label = bandDisplayForRow(row, bands);
    const rank = row.bandRank != null && row.bandRank !== '' ? ` (rank ${row.bandRank})` : '';
    return `${label}${rank}`.trim();
  }
  const w = row.weight;
  return w == null || w === '' ? '' : `${w} lb`;
}

export function lbRangeText(band) {
  if (!band) return '';
  if (band.lbRangeLow != null && band.lbRangeHigh != null) return `${band.lbRangeLow}–${band.lbRangeHigh} lb`;
  if (band.lbRangeLow != null) return `${band.lbRangeLow}+ lb`;
  return '';
}

// ---- persistence -------------------------------------------------------
// The editor writes a meta override; the config path is program.bands (seeded
// in program.json). Resolution order: meta override → program.bands → default.

export async function loadBands(program) {
  const override = await getMeta(META_BANDS);
  if (override && Array.isArray(override) && override.length) return normalizeBands(override);
  if (program && Array.isArray(program.bands) && program.bands.length) return normalizeBands(program.bands);
  return DEFAULT_BANDS.map(b => ({ ...b }));
}

export async function saveBands(list) {
  const clean = normalizeBands(list);
  await setMeta(META_BANDS, clean);
  return clean;
}

// Is the current ladder a user override, or still coming from config/default?
export async function hasBandOverride() {
  const override = await getMeta(META_BANDS);
  return !!(override && Array.isArray(override) && override.length);
}

export async function resetBands() {
  await setMeta(META_BANDS, null);
}
