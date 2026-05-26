# Itinerary Generator — Notebook Walkthrough

`itinerary-pipeline.ipynb` lets you step through the trip-template
generation pipeline (`services/trip-generation/`) one phase at a time so you
can inspect — and tweak — the data flowing between phases.

Phases covered:

1. **Route search & composition** (`route-engine.ts`)
2. **POI retrieval, union with route POIs, live-data enrichment** (`poi-engine.ts`)
3. **LLM pick** — Gemini assigns place_ids to days (`orchestrator.ts`)
4. **Solver** — orders stops, enforces opening hours & meal anchors (`solver.ts`)
5. **Persist** (optional, commented out by default)

The notebook calls the real functions from `services/trip-generation/*`. Any
phase output is a normal JS object you can edit in a follow-up cell before
feeding the next phase, which is the whole point.

## Prerequisites

- Node 20.6+ (uses `process.loadEnvFile`) — `node --version`
- Python 3.9+ with Jupyter — `pip install jupyterlab` (or use VS Code's
  notebook UI)
- `.env.local` at the repo root with `NEXT_PUBLIC_SUPABASE_URL`,
  `SUPABASE_SECRET_KEY`, `GEMINI_API_KEY`, and (if you want POI enrichment)
  `GOOGLE_PLACES_API_KEY`. Copy from `.env.example`.

## Install the TypeScript kernel (tslab)

```bash
npm install -g tslab
tslab install --python=python3
```

Confirm the kernel registered:

```bash
jupyter kernelspec list   # should show `tslab` and `jslab`
```

## Run

From the **repo root** (not from `notebooks/`):

```bash
jupyter lab notebooks/itinerary-pipeline.ipynb
```

Pick the **TypeScript** kernel. The first cell loads `.env.local` and
verifies the keys are present.

## Conventions inside the notebook

- Each phase has its own cell (or pair of cells: invoke + display).
- Outputs are stashed in top-level variables (`routes`, `compose`,
  `enriched`, `pick`, `solved`) so later cells can re-use them.
- To re-run a single phase with tweaked input, edit the variable in a new
  cell, then re-run the next phase cell.
- The **persist** cell is commented out — uncomment it only when you want
  to write a real `trip_templates` row.

## Why TypeScript, not Python?

The pipeline is TS. Running it from Python would mean shelling out to `tsx`
and shuffling JSON across process boundaries on every phase. tslab keeps
everything in one process and gives you the real `EnrichedPoi`, `RoutedDay`,
etc. with types intact.

## Troubleshooting

- **`Cannot find module '@/lib/...'`** — make sure Jupyter was started from
  the repo root, not from `notebooks/`. The `paths` alias is resolved
  relative to `..` in `notebooks/tsconfig.json`.
- **`process.loadEnvFile is not a function`** — upgrade Node to 20.6+ (you
  can also fall back to manually populating `process.env` in cell 1).
- **`Gemini unavailable`** — `GEMINI_API_KEY` not set, or circuit breaker
  tripped. Check `lib/gemini.ts` logs.
- **Empty POI candidates** — vector search returned nothing. The function
  falls back to Google Places text search; if you also have no
  `GOOGLE_PLACES_API_KEY` you'll get `[]`. Seed the destination first or
  pick a destination with existing `poi_embeddings`.

## The example trip

Out of the box the notebook plans a **2-day couple's ski + onsen trip to
Niseko**, seeded from the curated `data/japan-ski-trip/niseko/` dataset
(resorts, restaurants, activities). The pre-flight cell upserts two
multi-stop routes — _Hirafu 滑雪一日_ and _Niseko Village 寬鬆滑雪日_ —
each composed as ski → lunch → onsen → dinner. With both days
route-covered Phase 3 (LLM) is skipped and the solver lays out a full
4-stop day per route. Change the destination/duration in Phase 0 if you
want to exercise the LLM path or a cold-start destination.
