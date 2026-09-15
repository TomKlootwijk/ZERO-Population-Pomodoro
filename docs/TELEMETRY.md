# Live Earth / space telemetry

ZERO reads operational solar-wind plasma and magnetic observations from NOAA's
Space Weather Prediction Center (SWPC). These are spacecraft observations upstream
of Earth, typically near L1. NOAA can change which spacecraft is active for each
channel; the displayed source name comes from each observation. Operational data
can have interruptions. [NOAA solar-wind product and data description](https://www.spaceweather.gov/products/solar-wind)

This panel is independent of the modeled population counter and virtual FMCW
instrument. It does not infer a population-to-space-weather relationship.

## Sources and normalization

Current HTTPS endpoints are:

- [One-minute plasma JSON](https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json)
- [One-minute magnetic JSON](https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json)

`web/telemetry.js` accepts raw records only when `active === true` and
`overall_quality === 0`. It interprets `time_tag` as UTC when no time-zone suffix is
present. Each accepted record retains its observation timestamp and sanitized
spacecraft label.

| Raw field | Normalized field | Unit |
| --- | --- | --- |
| `proton_speed` | `speed` | km/s |
| `proton_density` | `density` | protons/cm³ |
| `proton_temperature` | `temperature` | K |
| `bz_gsm` | `bz` | nT, signed GSM component |
| `bt` | `bt` | nT, total field magnitude |

Values must be finite numbers, with no conversion of strings or nulls to numbers.
ZERO's generous validation envelopes are speed 0–5,000 km/s, density 0–10,000 cm⁻³,
temperature 0–10⁹ K, Bz −1,000–1,000 nT and total field 0–1,000 nT. It also requires
`abs(Bz) <= Bt + 0.02 nT`, allowing rounding. These are rejection bounds, not normal
conditions or display scales. Negative fill sentinels such as −9999 are rejected.

At validation time, observations must be within the previous seven days and no
more than two minutes in the future. Each channel is deduplicated by timestamp,
sorted oldest to newest, and limited to its newest 120 valid observations. Input
arrays larger than 30,000 records are rejected. A valid channel survives when the
other channel is unavailable.

## Derived proton ram pressure

The pressure readout uses the latest accepted plasma record:

```text
pressure = density × proton mass × speed²
pressure_nPa = 1.67262192595e−6 × density_cm⁻³ × (speed_km_per_s)²
```

This converts density to m⁻³, speed to m/s and pascals to nanopascals using proton
mass `1.67262192595e−27 kg`. At 400 km/s and 5 protons/cm³ it gives approximately
1.338 nPa. It is proton-only ram pressure; alpha-particle contributions and thermal
pressure are excluded. The result is derived from reported inputs, not a separate
pressure sensor reading.

## Bayer atlas

Four rings encode up to 120 minute bins, oldest to newest clockwise from the top.
Observation times are rounded to the nearest minute. The newest timestamp across
the two channels sets the shared two-hour window. Missing bins leave blank sectors.

| Ring, inner to outer | Color | Display scale |
| --- | --- | --- |
| Speed | Green | 250–850 km/s, linear |
| Density | Teal | 0–20 protons/cm³, linear |
| Temperature | Amber | 10⁴–10⁶ K, logarithmic |
| Bz | Violet | −20 to +20 nT, linear |

Each scale maps to a clamped intensity between zero and one. A fixed recursive
8 × 8 Bayer matrix provides thresholds `(rank + 0.5)/64`, with every rank 0–63
present once. A cell becomes bright when intensity exceeds its threshold; remaining
cells are faint. Higher intensity increases the ordered bright-dot density.
[Bayer construction and tests](INSTRUMENTS.md#bayer-ordered-threshold-display)

Values outside these display scales saturate the art while retaining their
validated numerical readouts. Brightness is a visual encoding, not a severity
forecast. The 60-second scanner is a clock animation inspired by the supplied
UGTS phase relation; it represents no radar emission. Freeze signal stops the
scanner. Feed polling and timestamped numeric observations continue independently.

## Refresh, cache and readiness

Automatic refresh defaults to every five minutes, with an initial request shortly
after opening. The checkbox stores the preference; manual refresh works when
automatic refresh is disabled. Requests time out after 15 seconds. The desktop
fetcher shares concurrent requests, reuses results for up to 60 seconds and caps
each response at 6 MB. Visible status and scanner rendering update every 200 ms.

Accepted snapshots are saved locally under `zero.noaa.v1`. On startup,
`validateSnapshot()` rechecks types, ranges, timestamps and history limits before
any readout uses saved values. Corrupt channels are discarded; usable observations
from another channel remain available. Fetch time never replaces observation time.
A failed refresh keeps previous readings with their original timestamps and a
cached/unavailable message. No synthetic substitute observations are generated.

The three readiness indicators mean:

- **Plasma fresh:** the latest accepted plasma timestamp is at most 20 minutes old.
- **Magnetic fresh:** the latest accepted magnetic timestamp is at most 20 minutes old.
- **Time aligned:** those two timestamps differ by at most two minutes.

All three must pass for combined readiness. These are ZERO's data-availability
checks, inspired by Operator I. They do not independently verify a physical event.
Cache schema validation is also not authentication of NOAA provenance. The source
timestamps and separate channel states remain visible so stale or partial data
does not become an apparent new observation.
