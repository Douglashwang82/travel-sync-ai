# Japan Ski Trip — National resorts index

Shallow nationwide index of 33 Japanese ski destinations, sourced from
Naruwan's [skiresort listing](https://www.naruwan.com/skiresort/) (Traditional
Chinese) and enriched via per-resort web search.

## How this differs from `../niseko/`

| | `niseko/` | `national/` |
|---|---|---|
| Granularity | One region, deep | One country, shallow |
| Files | 5 (resorts, hotels, transport, restaurants, activities) | 1 (resorts) |
| Per-resort detail | Full POI bundle | Resort facts only |
| Niseko coverage | Five sub-resorts + pass info | Omitted (would duplicate) |

This file is meant as a breadth layer that downstream tooling can use to
recognise a destination by name and surface basic facts. Detailed POI seed
data for an individual destination should live in its own per-region folder
following the `niseko/` shape.

## Schema additions over `niseko/resorts.json`

Each resort record adds two fields because the curating source is Chinese:

- `name_zh` — Traditional-Chinese display name (as it appears on naruwan)
- `description_zh` — Original Chinese marketing text

And one convenience flag:

- `wifi`, `onsen` — booleans surfacing icons shown on the naruwan listing
- `difficulty_levels` — array drawn from the Chinese "建議等級" tags

## Provenance and confidence

- **Names + Chinese descriptions**: from naruwan.com (user-supplied, since the
  domain returns HTTP 403 to programmatic fetch).
- **Stats** (lifts, courses, vertical, elevations, longest run, website):
  cross-referenced via web search against Snow Japan, japan-guide.com,
  Wikipedia, Powderhounds, official resort sites. Where sources conflicted
  the most-cited value was used; where no source agreed, the field is `null`.
- **Coordinates**: explicit search hits where available, otherwise public
  reference points. Treat as ±100 m, not precise.
- **Niseko**: deliberately omitted — see `omitted[]` at the bottom of
  `resorts.json` and the dedicated `../niseko/` bundle.

## Caveats

- Lift / course counts drift season-to-season; verify before any commercial
  use.
- Some resorts have been rebranded (Nekoma Mountain = ex-Alts Bandai +
  Nekoma; Kijimadaira = "Romance no Kamisama"). The current name is used as
  `name`, the legacy / commonly-known name as `name_zh`.
- The Takasu Mountains entry represents a six-resort cluster on a joint
  pass; individual sub-resort detail is not broken out at this level.
