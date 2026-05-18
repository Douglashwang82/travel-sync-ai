# Curated route seeds

One JSON file per destination. Each file is consumed by
`scripts/seed-route-templates.ts`:

```bash
npx tsx --env-file=.env.local scripts/seed-route-templates.ts \
  --file seeds/routes/kyoto.json
```

Re-running the seeder is safe: curator-owned fields (`summary`, `vibe_tags`,
`pace`, `place_ids`, `pinned_vibes`, `embedding`) get refreshed; admin-mutated
state (`boost`, `quality_score`, `is_archived`) is preserved.

## File shape

```json
{
  "destination": "Kyoto, Japan",
  "destination_aliases": ["kyoto", "京都", "japan"],
  "routes": [
    {
      "title": "Gion Cultural Morning",
      "summary": "Slow walk through Gion's machiya streets, tea at Kennin-ji, lunch in Nishiki Market.",
      "vibe_tags": ["culture", "foodie"],
      "pace": "balanced",
      "place_ids": ["ChIJ...", "ChIJ...", "ChIJ..."],
      "pinned_vibes": ["culture"]
    }
  ]
}
```

`destination_aliases` (optional) applies to every route in the file. The
seeder normalizes entries (lowercase, trim, dedupe) and combines them with
the canonical `destination` before writing, so a survey answer of
`"Kyoto"`, `"京都"`, or `"japan"` all hit this file's routes via the
alias-aware `search_routes_by_vibe` RPC.

## Constraints

- Every `place_id` must already exist in `poi_embeddings`. Seed POIs first via
  `scripts/seed-poi-embeddings.ts`.
- `place_ids` is an ordered day plan: stop 1 → stop 2 → ... The solver runs
  `simulateOrder` once in this exact order (it does not permute curated routes).
- 1–8 stops per route. Match `pace`: chill ≤3, balanced 3–5, packed 5–6.
- Include at least one restaurant in `place_ids` if you expect the route to
  cover a meal window — the solver still enforces the meal-anchor rule.
- `pinned_vibes` is optional; entries here grant a similarity bonus when the
  request's `vibe` array overlaps.
