# Coach Claude — Fitness PWA

A phone-first workout app for a 3x/week, travel-heavy ACFT-prep program coached by Claude.
Pick **where you are** and **what you're training**, and it shows the right exercises for the
equipment you actually have. Log sets/reps/weight/RPE (plus circuits and intervals) fast, then
**export a clean, Claude-friendly log** for your weekly check-in so Coach Claude can adjust the plan.

It's an installable **PWA** — no app store, works offline, all data stays on your phone.

---

## Why this exists

The whole program used to live in Google Calendar: three recurring sessions
(**Upper + Core**, **Lower + Hinge**, **Full Body + Conditioning**), each with four location
variants (`Full Gym` / `Home` / `Hotel` / `Bodyweight`) crammed into the event description, and you
logged by hand-editing that text. This app separates the two things that were tangled together:

- **Program** = *what to do* (structured, in `data/program.json`)
- **Log** = *what you did* (structured, stored on-device, exportable)

So logging is fast on a phone, and Claude gets clean data to track progress from.

---

## Using it

1. **Start a workout** → pick your **location**, then the **workout type**. You'll see a preview.
2. **Begin** → each exercise is a card with its target sets/reps/load and coaching cues, plus the
   right logging widget:
   - **Strength** — weight, ×2/×1/bar, reps, RPE (unilateral shows L/R reps **and L/R RPE**)
   - **AMRAP** — reps, RPE
   - **Holds** (plank/side plank) — seconds, RPE
   - **Carries** — weight, steps, RPE
   - **Circuits** — one row per round: time (mm:ss), RPE
   - **Intervals** — segments: duration × speed/pace
   - **+ set / + round / + segment** to add rows; **Skip** to drop an exercise
3. Set the **training date** — it defaults to today, but if you're logging a workout from an
   earlier day, change it here so the session sorts by the day you *trained*, not the day you typed
   it in. (Progressive-overload targets read "last session of this type," so the date has to be
   right.)
4. Add **session notes** and **duration**, then **Finish & Save**. A workout in progress survives
   closing the app — it's saved as you type.
5. **History** lists every session; tap to view (in shorthand), fix the **training date**, or delete.

### Logging shorthand (used in exports)

Matches how you already log, so Claude reads it natively:

| Example | Meaning |
|---|---|
| `50.2x10 -8` | 50 lb, **2** implements (pair), 10 reps, RPE 8 |
| `50.1x10 -6` | 50 lb, **1** implement (goblet/single), 10 reps, RPE 6 |
| `155x5 -9` | barbell (no implement count) 155 lb, 5 reps, RPE 9 |
| `BWx10L, 10R -6` | bodyweight, 10 left / 10 right, RPE 6 (both sides) |
| `BWx10L -8, 10R -7` | 10 left @ RPE 8, 10 right @ RPE 7 (per-side effort) |
| `4 rounds — 3:27 -7, 3:37 -8, …` | circuit rounds with time + RPE |
| `60s x 7.0 / 90s x 2.7` | treadmill interval segments |

---

## Weekly check-in flow

1. Open **Export**. It shows every session since your last check-in (or the last 7 days).
2. **Copy Markdown** (or JSON) and paste it into your Coach Claude chat. Ask for a weekly adjustment.
3. Claude returns an updated `program.json`.
4. Open **Import**, paste it in (or load the file). Your previous program is kept for one-tap
   **rollback**.
5. Tap **Mark check-in done** so your next export only shows new work.

The program is just JSON, so Claude can freely tweak sets, reps, loads, swap exercises per location,
add rules, or introduce a new workout type — and the app picks it up immediately.

---

## Install on Android

1. Open the app's URL in **Chrome** (see GitHub Pages below).
2. Menu (**⋮**) → **Add to Home screen** → **Install**.
3. Launch it from the home screen — it runs full-screen and offline.

---

## Hosting on GitHub Pages (one-time)

The app is plain static files at the repo root — no build step. To get an HTTPS URL (required for
PWA install):

1. Merge this branch into your default branch (`main`).
2. Repo **Settings → Pages**.
3. **Source:** *Deploy from a branch* → **Branch:** `main` → **Folder:** `/ (root)` → **Save**.
4. Wait ~1 minute; your app is at `https://<your-username>.github.io/Coach-Claude-FitnessApp/`.

Any change you push to `main` redeploys automatically. When you change app files, bump the
`CACHE` version in `service-worker.js` so phones pick up the update.

### Run locally

```bash
python3 -m http.server 8137
# open http://localhost:8137/index.html
```

(A local server is needed — service workers and ES modules don't run from `file://`.)

---

## Project layout

```
index.html               app shell
styles.css               mobile-first dark UI
js/
  app.js                 router + screens + logging widgets
  program.js             load program, resolve workout × location, import/rollback
  logger.js              in-progress session state (pure helpers)
  store.js               IndexedDB (sessions + imported program + metadata)
  export.js              Markdown/JSON export in Coach shorthand
data/program.json        the seeded program (3 types × 4 locations)
manifest.webmanifest     PWA metadata
service-worker.js        offline caching
icons/                   app icons
```

### Program data model (`data/program.json`)

```jsonc
{
  "version": "2026-07-09",
  "locations": [ { "id": "HOTEL", "name": "Hotel", "hint": "dumbbells to 50 / travel bands" } ],
  "globalRules": [ "Floor = show up and start. 15 minutes counts as a win." ],
  "workouts": [
    {
      "id": "upper_core", "name": "Upper + Core", "focus": "...", "timeCapMin": 60,
      "rules": [ "TIME CAP ~60 min ...", "Core stays anti-extension / anti-rotation ..." ],
      "variants": {
        "HOTEL": {
          "warmup": [ "Band pull-aparts x20", "Arm circles" ],
          "exercises": [
            { "name": "DB floor or bench press", "kind": "strength", "sets": 3, "reps": "10" },
            { "name": "One-arm DB row", "kind": "strength", "sets": 3, "reps": "10/arm", "unilateral": true },
            { "name": "Circuit", "kind": "circuit", "rounds": 4, "rest": "~60s",
              "movements": [ "KB swing x15", "Goblet squat x12" ] }
          ]
        }
      }
    }
  ]
}
```

`kind` ∈ `strength · amrap · hold · circuit · interval · carry · conditioning` — it selects the
logging widget. Optional per-exercise fields: `load`, `cues`, `unilateral`, `optional`.

---

## Roadmap (next features)

- One-tap "export since last check-in" with a prewritten Claude prompt
- Rest timer + elapsed-session timer
- "Today's workout" auto-suggestion from your schedule
- Show last session's numbers as targets (progressive-overload hints)
- Optional auto-sync (Google Drive / Sheets / Calendar), Garmin import, charts, bodyweight tracking
- July push-up challenge counter (1776)
