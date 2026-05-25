# Japan Ski Trip — Shiga Kogen dataset

Curated POIs for Shiga Kogen, Japan's largest interconnected ski area
(18 sub-resorts on a single lift pass), plus the lower-valley towns of
Yudanaka and Shibu Onsen and the Snow Monkey Park.

## Files

| File | Contents |
|---|---|
| `hotels.json` | Six lodging options across price bands, including the Prince mountain anchor, mid-mountain hotels and traditional ryokan in Shibu / Yudanaka. |
| `restaurants.json` | Six restaurants from on-mountain canteens to Shiga Kogen Beer's taproom, Shibu sushi and Shinshu soba. |
| `activities.json` | The Snow Monkey Park (mandatory), Shibu Onsen's nine baths, Kanbayashi rotenburo, Zenkō-ji Temple in Nagano, a snowshoe tour and Obuse day-trip. |
| `transport.json` | Nagano gateway, Nagano Dentetsu to Yudanaka, Shiga Kogen Express bus, Snow Monkey shuttle, in-resort sub-resort shuttle. |

Top-level `region` is `"Shiga Kogen"`; the seed script combines that
with the country to produce `Shiga Kogen, Japan` as the embeddings
`destination_name`.

## Provenance and confidence

- Hotels and restaurants: official sites, Snow Monkey Resorts, Prince
  Hotels, Mabey Ski.
- Snow Monkey Park: en.jigokudani-yaenkoen.co.jp (official).
- Transport: Nagaden bus, JR East, Nagano Dentetsu.
- Coordinates are best-effort to ±100 m (no Google Places API access at
  generation time).

## Caveats

- Shiga Kogen sub-resorts span many bases; this dataset uses Ichinose
  / Hasuike / Yakebitaiyama / Sun Valley as the most common entry points.
- Includes lower-valley POIs (Shibu Onsen, Yudanaka, Snow Monkey Park,
  Obuse) because most international trips combine the two.
- Prices are 2025/26 indicative values and drift.
