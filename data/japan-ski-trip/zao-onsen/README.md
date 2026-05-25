# Japan Ski Trip — Zao Onsen dataset

Curated POIs for Yamagata Zao Onsen, Tohoku's largest ski area and a
1,900-year-old sulphurous onsen town. Famed for the winter juhyo (snow
monsters — ice-encrusted firs along the upper ropeway).

## Files

| File | Contents |
|---|---|
| `hotels.json` | Six lodging options across price bands, weighted to traditional ryokan because Zao's identity is the village onsen experience. |
| `restaurants.json` | Six restaurants including Yamagata-gyu yakiniku, local kyodo-ryori, izakaya, ropeway-base canteen, tama-konnyaku street stall and a café. |
| `activities.json` | The Zao Ropeway juhyo experience (mandatory), the Jizo statue at the summit, two free public soto-yu (Shimoyu, Kawarayu), the seasonal Dai-Rotenburo, and Yamadera day trip. |
| `transport.json` | Yamagata Shinkansen gateway, Sendai Airport alternative, Yamako Bus to the village, in-village walking + ropeway. |

Top-level `region` is `"Zao Onsen"`; the seed script combines that with
the country to produce `Zao Onsen, Japan` as the embeddings
`destination_name`.

## Provenance and confidence

- Hotels and restaurants: official sites, Zao Onsen Tourism Association,
  Mabey Ski, Tabelog.
- Ropeway and juhyo info: zaoropeway.co.jp (official).
- Transport: JR East, Yamako Bus, JR Bus Tohoku.
- Coordinates are best-effort to ±100 m (no Google Places API access at
  generation time).

## Caveats

- Dai-Rotenburo is seasonal (mid-April to mid-November) and closed in
  the deep winter peak.
- Juhyo are weather-dependent and best mid-January to early February.
- Only 2 of the 3 free soto-yu are listed; extend `activities.json` if
  the third (Kamiyu) is needed.
- Prices are 2025/26 indicative values and drift.
