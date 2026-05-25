# Japan Ski Trip — Naeba dataset

Curated POIs for a Naeba / Echigo-Yuzawa trip. Naeba is dominated by the
Prince Hotel complex at the base; this dataset also covers the
shinkansen-side town of Echigo-Yuzawa (sake, onsen, food) since most
trips spend at least one meal or evening there.

## Files

| File | Contents |
|---|---|
| `hotels.json` | Six lodging options including the Naeba Prince anchor, NASPA New Otani, station-side modern hotel, historic ryokan (Takahan), Kagura-base pension, budget guesthouse. |
| `restaurants.json` | Six restaurants spanning hegi-soba, kaiseki, sushi, ramen, café and on-mountain pub. |
| `activities.json` | The Dragondola, Ponshukan sake-tasting at the station, two Yuzawa public onsen, Snow Country museum, Yuzawa Kogen ropeway. |
| `transport.json` | Echigo-Yuzawa as the shinkansen gateway, Naeba Prince free shuttle, Yuzawa loop bus, in-resort shuttles. |

Top-level `region` is `"Naeba"`; the seed script combines that with the
country to produce `Naeba, Japan` as the embeddings `destination_name`.

## Provenance and confidence

- Hotels and restaurants: Prince Hotels, NASPA, Tabelog, Snow Monkey Resorts.
- Dragondola + lift info: Prince Hotels ski.naeba official.
- Sake / cultural: ponshukan.com, Yuzawa town tourism.
- Transport: JR East, Naeba Prince Hotel shuttle, Minamiuonuma City.
- Coordinates are best-effort to ±100 m (no Google Places API access at
  generation time).

## Caveats

- Naeba and Kagura share the Mt. Naeba pass; some POIs (Kagura Mitsumata
  lodge, Dragondola end station) sit on the Kagura side.
- GALA Yuzawa, JR-operated and built directly on the shinkansen station,
  is intentionally omitted here — it has its own attached infrastructure
  and would warrant a separate entry.
- Prices are 2025/26 indicative values and drift.
