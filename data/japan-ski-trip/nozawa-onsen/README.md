# Japan Ski Trip — Nozawa Onsen dataset

Curated POIs for a Nozawa Onsen trip. Nozawa is unusual among Japanese
ski destinations in that the village (a 1,200-year-old onsen town) and
the resort base are stitched together rather than separated — so the
dataset is village-heavy.

## Files

| File | Contents |
|---|---|
| `hotels.json` | Six lodging options: two traditional ryokan (Kawamotoya, Sakaya), modern boutique, mid-range ryokan, European pension, budget lodge. |
| `restaurants.json` | Six restaurants spanning modern Japanese (Stay), fusion, soba, sushi, izakaya and craft beer (Libushi). |
| `activities.json` | Three of the 13 free soto-yu (Oyu, Shinyu, Kuma-no-tearai-yu) + paid community bath (Furusato-no-Yu), the Ogama hot-water source and Kosuge Shrine (Fire Festival site). |
| `transport.json` | Iiyama / Nagano / Narita / Haneda gateways, Hokuriku Shinkansen + Nozawa Onsen Liner combo, and the in-village mountain shuttle. |

Top-level `region` is `"Nozawa Onsen"`; the seed script combines that
with the country to produce `Nozawa Onsen, Japan` as the embeddings
`destination_name`.

## Provenance and confidence

- Hotels and restaurants: official sites, Nozawa Holidays, Stay Nozawa,
  Ryokans of Japan and Mabey Ski.
- Onsen: Nozawa Onsen tourism portal (en.nozawaski.com) and Japan Guide.
- Transport: nozawaonsen.info (Liner), Snow Monkey Resorts, JR East.
- Coordinates are best-effort to ±100 m (no Google Places API access at
  generation time).

## Caveats

- Only 3 of the 13 soto-yu are represented here; extend `activities.json`
  if a more complete onsen tour is needed.
- The Dosojin Fire Festival (15 January) is a once-a-year event;
  Kosuge Shrine is listed as the year-round site.
- Prices are 2025/26 indicative values and drift.
