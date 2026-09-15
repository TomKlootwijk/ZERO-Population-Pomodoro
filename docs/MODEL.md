# ZERO — model and source notes

Base population/signal model: 1.0 · 14 September 2026

The live strain/SDF gauge, AC/DC multimeter, and virtual FMCW/Doppler instruments
added in 1.2 are defined in [INSTRUMENTS.md](INSTRUMENTS.md). The sections below
document the underlying population interpolation, synthetic trace generator,
electrical model, and timer. Instrument display layouts have changed since 1.0.

## 1. Population clock

The data source is the U.S. Census Bureau world population clock. Its public JSON
response is stored verbatim in `data/census-world.json` and wrapped for direct
file opening in `web/seed.js`. The bundle's source timestamp is
2026-09-14T09:58:09Z (`last_updated = 1789379889`). At that timestamp the feed gives
8,210,953,064 people and a net population rate of 1.9952543442415018 people/second.
These are model outputs, not enumerated live events. [1, 2]

The included anchor range runs from 2026-07-01 through 2027-07-01. For timestamps
between neighboring supplied anchors `(t_i, P_i)` and `(t_j, P_j)`, ZERO computes:

```text
g = (P_j − P_i) / ((t_j − t_i) / 1000)           [people/second]
P(t) = P_i + g × (t − t_i) / 1000               [people]
```

Times in the code are UTC Unix milliseconds. Population display is floored to a
whole person; calculations retain floating-point precision. Use of individual
last digits is a clock presentation convention, not a claim of individual-person
measurement accuracy. The source population and the interpolated population at
its reference timestamp agree within integer rounding for this snapshot.

Before/after the anchor range, ZERO extrapolates from the nearest end anchor at the
feed's `population_rate`. This is explicitly labeled **extrapolated**. Sources over
45 days old are labeled **old source**; that UI threshold is a design choice, not a
statistical expiry date. Outside the supplied range, long-term extrapolation should
not be treated as a demographic forecast. Refresh the source rather than relying
on a fixed linear rate for years.

New source revisions may cause a jump in the count. ZERO does not smooth away a
revision to create a false impression of uninterrupted measurement. The Census
world estimate and UN World Population Prospects can disagree because these are
different estimation/projection systems. ZERO does not silently mix them. [1, 3]

The feed is a public clock endpoint, not a versioned API contract guaranteed to
remain unchanged. Network timeout, schema validation, local caching, a bundled
snapshot, and explicit import are provided to keep failures visible and usable.
Only whole-world population and net growth are modeled; there is no country-level
census database or individually observed births/deaths feed in this app.

## 2. A one-dimensional signed-distance construction

Here “SDF 0” is interpreted as the zero of a one-dimensional signed distance:

```text
φ(n,t) = n − P(t)
φ(P(t),t) = 0
|∂φ/∂n| = 1
```

At a fixed time, this is the signed distance, in people, from coordinate `n` to the
single reference `P(t)`. It is not a spatial SDF over Earth's surface and not a
geometric distance in meters. In a time-versus-count plot it is a vertical residual,
not the Euclidean distance to the entire time-varying graph of P(t).

A synthetic excursion `x(t)` defines an illustrative coordinate `n(t)=P(t)+x(t)`.
Thus `φ(n(t),t)=x(t)`, plotted around the zero line. Crucially, the main counter and
electrical model use **P(t) only**. Synthetic excursions never alter them.

## 3. Fourier synthesis and actual spectral analysis

The full cycle contains 2,048 samples at 128 samples/second: a 16-second loop. A
seeded pseudo-random generator constructs complex coefficients whose envelope is
a mixture of Gaussian bands centered at 1.7, 5.2, 10, 20, and 35 Hz, cut off below
0.5 Hz and above 45 Hz. These are artistic choices, not a diagnosis or inferred
brain state.

A conjugate-symmetric spectrum is used so the inverse transform is real-valued.
Its DC coefficient is exactly zero. An in-place radix-2 Cooley–Tukey inverse FFT,
normalized by N, produces the loop. It is scaled to the selected peak excursion:

```text
peak excursion = gain × clamp(abs(net_people_per_second)/2, 0.15, 2.5)
```

The default `gain = 24` illustrative people and scaling constants are design choices,
not confidence intervals, demographic dispersion, or physical conversion factors.
The loop is deterministic and repeats every 16 seconds. The live estimated growth
rate controls only the synthetic amplitude; there is no claim of a biological
relationship between population growth and EEG frequencies.

The expanded time trace shows the latest 384 samples (3 seconds). Spectral analysis
uses the latest 512 samples (4 seconds), removes the mean, applies a Hann window,
and computes a **real FFT calculation**, not prepainted spectrum bars:

```text
w[k] = 0.5 × (1 − cos(2πk/(N−1)))
X = FFT((x − mean(x)) × w)
amplitude[f] = 2 × abs(X[f]) / sum(w)
```

DC and Nyquist bins are not doubled. Frequency resolution is 128/512 = 0.25 Hz.
Display bars take maxima within one-Hz buckets over 0–45 Hz and normalize against
the current displayed peak for visibility. Therefore bar height is relative, not
an absolute microvolt scale or a power spectral density. No µV label is used.
The full cycle has zero mean; a short moving window may not, which is why the
analysis separately removes its window mean.

The signal is **EEG-inspired visualization only**. ZERO has no electrode input,
EEG sensor, brain measurement, shared-consciousness model, or medical function.

## 4. Hypothetical power, current, and energy

Let `w` be the user-selected watts/person and `V` the user-selected equivalent
voltage:

```text
Power W(t) = P(t) × w                      [watts = joules/second]
Current I(t) = W(t) / V                    [amperes, DC equivalent]
Energy E = integral W(t) dt                [joules]
```

The unit relations `1 W = 1 J/s` and `1 V = 1 W/A` are documented by NIST. [4, 5]
Population alone determines none of these quantities: both a per-person power
assumption and a voltage assumption are necessary for this illustrative current.
For AC systems, real power, phase, and power factor would need separate treatment;
this app deliberately uses a simple hypothetical DC/unity-power-factor equivalent.

Defaults of 100 W/person and 230 V are **illustrative software settings**, not an
estimate of total human metabolic power, worldwide grid consumption, bioelectric
output, or harvestable power. ZERO does not imply that people form a single circuit.
A slider/default is not empirical evidence.

Energy accumulates only during active time in the current interval, whether that
interval is focus or break. The integral is evaluated exactly for each linear
population segment using trapezoidal integration, split at every crossed anchor:

```text
E_segment = w × (P(a)+P(b))/2 × (b−a)/1000
```

Pauses add no energy. Reset, skip, or a newly selected interval starts its displayed
energy at zero. Completion caps integration at the deadline even after system
sleep. On changing assumptions or source data, pending elapsed time is first
settled using the previous model; future time then uses the new values. Very small
floating-point rounding error is negligible relative to the illustrative inputs.

## 5. Timer, connectivity, and privacy limits

The countdown uses a wall-clock deadline and a persisted state snapshot. Time
between callbacks is not assumed constant. A clock adjustment made by the user or
OS can affect a deadline-based countdown; a correct device clock is important for
both the timer and the population interpolation.

Audio is optional and may be restricted by the browser or OS. No background job
runs after the application is completely closed; on reopening, saved running
state is reconciled with the stored deadline, capped at one interval.

Automatic source requests run at startup and every six hours, when enabled.
The Python host binds to 127.0.0.1 and serves an explicit file allowlist. It verifies
Host/Origin, uses verified HTTPS for the fixed Census endpoint, caps response size,
and returns a failure instead of falsely labeling a fallback as a network result.
The Electron renderer is sandboxed, context-isolated, has no Node integration, and
loads only local assets via an allowlisted custom protocol. Its IPC calls and
external links are restricted. No arbitrary URL proxy, remote JS/CDN, analytics,
account, camera, microphone, or personal records are involved. [6]

## Sources (consulted 14 September 2026)

[1] U.S. Census Bureau, World Population Clock:
https://www.census.gov/popclock/world

[2] U.S. Census Bureau, world-clock JSON endpoint (the bundled data source):
https://www.census.gov/popclock/data/population.php/world

[3] United Nations Population Division, World Population Prospects:
https://population.un.org/wpp/

[4] NIST, SI Units — Electric Current:
https://www.nist.gov/pml/owm/si-units-electric-current

[5] NIST, Joule:
https://www.nist.gov/glossary-term/26261

[6] Electron, Security recommendations:
https://www.electronjs.org/docs/latest/tutorial/security

[7] Electron, BrowserWindow and screen APIs:
https://www.electronjs.org/docs/latest/api/browser-window
https://www.electronjs.org/docs/latest/api/screen

[8] MDN, Document Picture-in-Picture API (limited browser availability):
https://developer.mozilla.org/en-US/docs/Web/API/Document_Picture-in-Picture_API

[9] Electron, stable release listing; the selected package range starts at 44.3.0:
https://releases.electronjs.org/release?channel=stable
