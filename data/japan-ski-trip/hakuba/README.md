# Japan Ski Trip — Hakuba dataset

Curated POIs for a Hakuba Valley trip (Happo-One as the anchor resort,
with valley-wide POIs across Wadano, Echoland, Iwatake and Goryu).

## Files

| File | Contents |
|---|---|
| `hotels.json` | Six lodging options across price bands, including ski-in/ski-out, ryokan and pension. |
| `restaurants.json` | Six restaurants spanning fine dining (Pilar, Mimi's), izakaya, ramen, sushi and tonkatsu. |
| `activities.json` | Three onsen (Mimizuku, Tenjin, Obinata), Hakuba Mountain Harbor sightseeing, snowshoe guide, and a family snow park. |
| `transport.json` | Gateways (Nagano, Matsumoto, Hakuba, Narita, Haneda), Tokyo→Hakuba routes, in-valley shuttles. |

Top-level `region` is `"Hakuba"`; the seed script combines that with the
country to produce `Hakuba, Japan` as the embeddings `destination_name`.

## Provenance and confidence

- Restaurants and hotels: cross-referenced via Japan Ski Experience,
  SamuraiSnow, Powderhounds, Mabey Ski and the official hotel sites.
- Onsen: Hakuba Happo Onsen official site + Tripadvisor.
- Transport: ALPICO Group (visit-nagano.alpico.co.jp), Snow Monkey
  Resorts, JR East timetables.
- Coordinates are best-effort to ±100 m (no Google Places API access at
  generation time). Verify before commercial use.

## Caveats

- Hakuba Valley has 10 lift-linked resorts; this dataset focuses on the
  central Happo / Wadano / Echoland cluster with a few outliers.
- Prices are 2025/26 indicative values and drift.
