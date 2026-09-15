# Live signal analysis

ZERO's combined visual uses distinct source channels. Putting population,
solar-wind measurements, magnetic measurements, and local weather on one canvas
does not establish a physical or causal relationship between them. A visual
mapping changes the presentation, not the incoming numbers.

## Source timing

- **Population:** the Census Bureau estimate is interpolated between its supplied
  time anchors, with labeled extrapolation outside them. It is a continuously
  displayed model, not an incoming stream of individually counted people.
- **NOAA:** accepted plasma and magnetic records have one-minute observation
  timestamps. ZERO polls for new source data every five minutes. Polling is not
  a new measurement, and the source's observation time is distinct from fetch time.
- **IJburg weather:** Open-Meteo current conditions are model-based, using
  15-minute data. ZERO polls every 15 minutes. The temperature is a reported
  model value, not an on-site thermometer reading.

Sources: [Census world-clock methodology](https://www.census.gov/data/data-tools/population-clock/world-notes.html),
[NOAA solar-wind product](https://www.spaceweather.gov/products/solar-wind),
[NOAA minute wind feed](https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json),
[Open-Meteo current-weather documentation](https://open-meteo.com/en/docs).

## What is transformed

`ZeroLiveSignal.analyze(windRows, magRows)` in `web/live-signal.js` analyzes
**reported NOAA wind speed**, in km/s. It does not use synthetic waveforms,
population change, local temperature, density, or magnetic readings as FFT input.
The latter channels retain their own units and timestamps.

Input timestamps are Unix milliseconds. Records are sorted by timestamp; the last
input occurrence wins when a timestamp is duplicated. Duplicate values are not
averaged. The module retains the newest 120 timestamps and selects the contiguous
suffix ending at the latest wind-speed record. Adjacent samples must differ by
exactly 60,000 ms. It never rounds timestamps, interpolates across a gap, or fills
missing values with zero. A valid timestamp carrying an invalid speed interrupts
the sequence, including when it is the latest record.

The FFT uses the largest available power-of-two window of **16, 32, or 64 samples**
from that suffix. With fewer than 16, the function returns `ready: false`, an
explicit `reason`, available samples, empty spectrum, and null analysis values.
It does not silently replace a short recent suffix with an older complete window.
True zero readings remain valid observations.

## DC, AC, signed residual, and Fourier units

For the selected unwindowed wind-speed samples `x`:

```text
DC = mean(x)                              km/s
AC RMS = sqrt(mean((x - DC)^2))           km/s
peak-to-peak = max(x) - min(x)            km/s
signed residual = latest(x) - DC         km/s
sample rate fs = 1/60                    Hz
FFT bin k frequency = k*fs/N             Hz
display frequency = 1000*k*fs/N          mHz
```

The signed residual is the newest measured speed relative to the selected
window's mean; it is not a population distance or mechanical strain.

The transform uses the existing `ZeroCore.spectrum`: subtract the unwindowed
mean, apply a symmetric Hann window, and run the radix-2 FFT. One-sided amplitudes
are corrected by the sum of window weights. Interior bins are doubled; DC and
Nyquist are not. The result is **amplitude in km/s**, not power spectral density.
The displayed DC statistic comes from the original samples; the zero-frequency
FFT bin is from the demeaned, windowed signal.

The dominant frequency is the largest non-DC amplitude bin, without sub-bin peak
interpolation. A constant trace returns zero dominant frequency. Windowing spreads
energy into adjacent bins; amplitude and frequency readings have finite-window
limits. Source revisions or spacecraft changes can also create jumps in the
reported series, without indicating a persistent physical oscillation.

At 64 samples, bin spacing is approximately **0.2604 mHz**, and Nyquist is
**8.3333 mHz**. The first and last observations span 63 minutes; the FFT duration
`N/fs` is 64 minutes. `windowStart`, `windowEnd`, `sampleCount`, and
`resolutionHz` expose these choices. No zero padding creates extra apparent bins.

`ready` describes sampling coverage, not freshness or a successful current fetch.
The caller must separately show source age and errors. An old but complete sample
window remains historical data and must not be labeled as freshly measured.

## Unified visualization

`web/unified-view.js` places these channels in one elliptical field. They overlap
in screen coordinates while keeping their own values, units and timestamps. The
canvas does not add temperatures to population or interpret magnetic field as
wind speed. Its sweep and contours are display geometry, not physical FMCW radar
measurements.

### Bayer history, waveform and spectrum

Four concentric bands share the ellipse. From inner to outer they encode wind
speed, proton density, plasma temperature and magnetic Bz. Angle advances clockwise
from the top through 120 minute bins, oldest to newest. The latest timestamp across
the wind and magnetic channels sets the window. History timestamps are rounded to
the nearest minute for this display; the FFT uses the exact timestamps described
above. A missing minute leaves its sector blank.

| Band | Color | Intensity scale |
| --- | --- | --- |
| Wind speed | Green | 250–850 km/s, linear |
| Proton density | Cyan | 0–20 cm⁻³, linear |
| Plasma temperature | Amber | 10⁴–10⁶ K, logarithmic |
| Magnetic Bz | Violet | −20 to +20 nT, linear |

Each scale is clamped to zero through one. A fixed 8 × 8 Bayer matrix assigns
thresholds `(rank + 0.5)/64`. Cells below the input intensity are bright; the
remaining cells are faint. Increasing intensity adds ordered bright dots. Saturated
art does not change the numerical readout. See the
[Bayer construction](INSTRUMENTS.md#bayer-ordered-threshold-display).

The **cyan waveform** plots actual samples from the selected contiguous wind-speed
window, with its DC mean subtracted. Time runs left to right. Straight connecting
segments show the sequence; they add no sampled observations. Vertical display
gain is `max(3 × AC RMS, 1 km/s)`, with normalized excursions clipped at ±1.1. The
waveform therefore rescales to its window and must be read alongside the AC value.
It appears only when the sample window is ready for analysis.

The **amber upper arc** uses the FFT of that same wind-speed window. Each tick is
one nonzero frequency bin: lowest frequency at the left, increasing through the
top to Nyquist at the right. Tick length and opacity increase with bin amplitude,
normalized by the largest amplitude in the full spectrum, with a `1e−9` floor.
These amplitudes retain km/s units; frequencies use the actual one-minute sample
interval and are reported in mHz. The arc is not an RF spectrometer or an FFT of
the animation's frame rate.

### Magnetic direction and local weather

The **violet vector** starts at the ellipse centre. Positive Bz points upward and
negative Bz downward. Its extent uses `clamp(Bz / 20 nT, −1, 1)`, reaching 68% of
the ellipse's vertical radius at either limit. The displayed Bz number remains
signed and is not clipped to the drawing scale.

The **central glow** uses the current IJburg model temperature in Celsius:
`warmth = clamp((temperature + 5) / 40, 0, 1)`. This shifts the faint central color
from cool blue-green at −5°C toward warm amber at 35°C, with saturation beyond
those limits. The glow disappears when no usable weather snapshot exists. It is
independent of the plasma temperature band, which uses kelvin. Weather values are
not interpolated between updates; the strip retains their source time and status.

### Population contours and the display clock

The population probe is the fixed count coordinate `n = P0 + probeOffset`, where
`P0` is the population saved at tare. Signed distance is `phi = n − P(t)` in people.
The contour offset is:

```text
d = clamp(0.045 × asinh(phi / 100 people), −0.15, 0.15)
contour radius factors = 0.42+d, 0.66+d, 0.86+d, 1+d
```

These factors scale both ellipse radii. Positive distance expands the contours;
negative distance contracts them. The inverse hyperbolic sine compresses large
changes for display. This construction is a view of count-axis signed distance,
not an Earth-surface distance field.

Contour thickness uses the magnitude of the virtual quarter-bridge output from
[Operator I's declared bridge relation](INSTRUMENTS.md#quarter-bridge-population-analogy):
`0.65 + clamp(0.3 × ln(1 + abs(bridgeUv)), 0, 0.7)` CSS pixels. The bridge is driven
by relative population change since tare; its sign remains available in the
numeric readout even though thickness uses magnitude. It does not measure a wire
voltage or material strain.

The scanning line follows the [UGTS phase clock](INSTRUMENTS.md#phase-and-winding)
with Unix milliseconds, reference zero and a 60,000 ms period. It turns clockwise
once per minute. A dot follows the outer shifted contour at the same phase. Freeze
signal holds this display phase; it does not stop incoming data or turn display
time into a source timestamp. None of these moving marks represents transmitted
radio energy, a detected target or a new observation.
