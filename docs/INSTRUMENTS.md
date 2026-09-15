# ZERO instrument model

The default shared field uses measured NOAA wind for its AC/DC and Fourier
readings; see [LIVE.md](LIVE.md). The synthetic waveform and virtual radar below
remain available in the collapsed **Instrument definitions & controls** section.

The counter updates continuously from a population model. Its last digits are a
clock presentation, not individually measured people. The Census Bureau derives
the world clock from country estimates and projections; revisions can change the
result. ZERO uses the supplied anchors and source rate described in
[MODEL.md](MODEL.md). No births, deaths, physical strain or RF sensors are observed.
[Census world-clock methodology](https://www.census.gov/data/data-tools/population-clock/world-notes.html)

## Population, signed distance and tare

`populationMetrics(model, nowMs, referencePopulation, referenceTimeMs)` returns the
unrounded modeled population `P(t)` and its local net rate in people/second.
The reference defaults to `P(referenceTimeMs)` and the time defaults to `nowMs`.

```text
delta = P(t) − P0                                      people
population strain = (P(t) − P0) / P0 × 1,000,000        ppm
signedDistance(n, P(t)) = n − P(t)                      people
netToday = P(t) − P(UTC midnight)                       people
nextMillion = (floor(P(t) / 1,000,000) + 1) × 1,000,000
targetEtaSeconds = (nextMillion − P(t)) / local net rate
```

Tare saves the current population as `P0` and makes delta and strain zero. Here
strain is a relative population change, borrowing the dimensionless change/reference
structure of a strain gauge. It is not mechanical strain. Real strain gauges measure
relative deformation of a material. [NI strain fundamentals](https://www.ni.com/en/shop/data-acquisition/sensor-fundamentals/measuring-strain-with-strain-gages.html)

The signed distance is one-dimensional on the population-count axis. A ring around
the counter is a visual gauge of that count residual, not an Earth-surface distance
field. Negative values lie below the population reference, positive values above it.
Neither the ring nor the synthetic signal changes the main population number.

`netToday` explicitly uses UTC, including around local daylight-saving transitions.
The next-million ETA assumes the current rate continues. It does not integrate
future anchor changes and is not a long-term population forecast. A zero or negative
net rate returns a `null` ETA. Source revisions may appear as changes relative to a
previously saved tare; the counter does not conceal them by smoothing.

## AC/DC multimeter and Fourier spectrum

`signalStats(samples, sampleRate)` analyzes the supplied trace. With the default
`FourierTrace`, the input is deterministic synthetic animation at 128 samples/s,
not population-event measurements. Amplitude is in illustrative count-residual
units. DC and RMS describe the selected sample window, not the global population.

```text
DC = mean(x)
AC RMS = sqrt(mean((x − DC)^2))
total RMS = sqrt(mean(x^2))
peak-to-peak = max(x) − min(x)
AC crest factor = max(abs(x − DC)) / AC RMS
```

The crest factor is defined as zero for a flat trace. A complete synthetic cycle
has zero DC; a shorter selected window can have a nonzero mean.

The spectrum subtracts the mean, applies a Hann window, and runs the existing
radix-2 FFT. One-sided amplitude bins use coherent-gain correction; DC and Nyquist
are not doubled. The dominant frequency excludes DC and is zero for a flat trace.
For N samples, bin spacing is `sampleRate/N`; this is not a claim that two arbitrary
nearby tones can always be resolved at that separation. The spectrum is amplitude,
not power spectral density. FFT sizes must be powers of two with at least four
finite samples. At 512 points and 128 samples/s, spacing is 0.25 Hz.

## Virtual FMCW and Doppler instrument

This panel models one ideal target with a specified range and radial velocity.
These controls are independent of population. It does not detect nearby people,
motion, electromagnetic emissions or devices.

Defaults are carrier `fc = 77 GHz`, sweep `B = 150 MHz`, upchirp time `Tc = 1 ms`,
range `R = 42 m`, and radial velocity `v = +1.5 m/s`. Positive velocity means
approaching. The model uses `c = 299,792,458 m/s` and a constant-delay, narrowband
Doppler approximation over a chirp.

```text
chirp slope S = B / Tc                    Hz/s
round-trip delay τ = 2R / c               seconds
wavelength λ = c / fc                     metres
range contribution fR = Sτ                Hz
Doppler fD = 2v / λ                       Hz, positive approaching
upchirp signed beat fIF = fR − fD          Hz
ideal full-sweep range resolution = c/2B  metres
```

The sign follows dechirping `Tx × conjugate(Rx)`: an approaching echo has increased
frequency, reducing the Tx-minus-Rx difference. A real cosine alone cannot identify
the sign. The returned complex baseband includes both cosine (`ifSignal`) and sine
(`ifQuadrature`) components. Doppler is calculated from the chosen velocity; the
panel does not estimate independent range and velocity from one beat tone.
[TI FMCW range introduction](https://www.ti.com/lit/SPYY005),
[TI Doppler and range equations](https://www.ti.com/lit/ug/tiduei5/tiduei5.pdf)

`virtualRadar(options)` returns physical parameters plus:

- `tx` / `rx`: normalized **instantaneous-frequency ramps** relative to the carrier,
  divided by sweep bandwidth. They are not sampled 77 GHz wave amplitudes.
- `txFrequencyHz` / `rxFrequencyHz`: the same ramps in absolute Hz.
- `ifSignal` / `ifQuadrature`: unit-amplitude synthetic complex baseband samples.
- `time` / `chirpTime`: sample times beginning at the echo delay, in seconds.
- `aliasRisk`: `abs(fIF) >= sampleRate/2`; this invalidates an unaliased trace reading.
- `validChirp`: all sample times fall inside the Tx/Rx overlap before chirp end.
- `observationSeconds`: `count/sampleRate`; the FFT observation duration, if the
  returned signal is passed into a transform.

The normalized ramps use `Tx = St/B` and `Rx = (S(t−τ)+fD)/B`. The baseband phase is
`2π[(Sτ−fD)t + fcτ − Sτ²/2]`. The optional `startTime` adds a phase shift for smooth
display animation; it does not move the target or extend the physical chirp.
Default 512 samples at 512 ksample/s cover approximately one chirp. Invalid custom
sampling choices remain labeled via the validity flags rather than being silently
presented as a valid radar observation.

The displayed `c/(2B)` is an ideal full-bandwidth resolution. A shorter observation,
window function, noise, multiple targets and real hardware can worsen practical
resolution. This ideal single-target panel includes none of those effects.

## Selected formulas from the supplied frameworks

ZERO borrows the following specific equations from the two included reference
documents. It does not implement their complete formalizations, satellite
navigation kernel, control theory or physical sensor systems.

### Quarter-bridge population analogy

[WANTWOMBAN Operator I v1.1](../references/WANTWOMBAN_Operator_I_v1.1.pdf), page 9,
section 7, equation 7.2, declares a bridge with three equal resistors and active
arm `R4 = R(1+x)`, measuring `Vo = VL − VR`. Its exact relation is:

```text
epsilon = (P(t) − P0) / P0       dimensionless population change
x = gaugeFactor × epsilon
Vo / Vex = −x / (4 + 2x)        x > −1
```

`quarterBridge(strain, {gaugeFactor: 2, excitationV: 5})` applies that exact
nonlinear relation, using `strainPPM/1,000,000` as `strain`. It returns the ratio
and output in volts (`outputV`), millivolts (`outputMv`) and microvolts (`outputUv`).
The gauge factor and excitation voltage are virtual calibration choices. The
output is an electrical analogy of modeled population change, not measured
voltage, physical resistance or mechanical strain. Positive population change
produces a negative output with these explicitly declared bridge leads. Tare
makes the output zero. Inputs with nonpositive active-arm resistance are rejected.

### Phase and winding

[aTOMos v3.6.1.5 UGTS Conjoined Satnav](../references/aTOMos_v3_6_1_5_UGTS_Conjoined_Satnav_Tom_Klootwijk.pdf),
page 16, section 12, equation 31, retains absolute time while deriving a phase:

```text
u = (time − referenceTime) / period
winding = floor(u)
phase = u − winding              0 ≤ phase < 1
```

`phaseClock(time, referenceTime, period)` preserves all three input values as well
as elapsed time, phase and integer winding. Inputs use a common time unit; ZERO
can use Unix milliseconds without treating a wrapped phase as a replacement for
the full timestamp. The source example `(1920, 1135, 256)` produces winding `3`
and phase `0.06640625`. Before the reference, floor division gives negative winding
with nonnegative phase: `(900, 1000, 400)` gives winding `−1`, phase `0.75`.
Unrepresentable cycle counts are rejected rather than losing integer history.

### Bayer ordered-threshold display

The live matrix uses a separate recursive 8 × 8 ordered-dither construction:

```text
B1 = [0]
B(2n) = [4Bn + 0, 4Bn + 2; 4Bn + 3, 4Bn + 1]
threshold(x,y) = (B8[y mod 8][x mod 8] + 0.5) / 64
```

`BAYER8` contains each rank `0..63` exactly once. `bayerThreshold(x,y)` wraps both
positive and negative pixel coordinates. Drawing pixels whose threshold is below
a normalized metric `q` creates ordered fill. Each step of `1/64` adds exactly one
pixel per tile, and increasing the metric never turns an already-filled pixel off.
The matrix is a visual encoding of its selected metric; it adds no new measurements
or information to the source. Values of zero and one give empty and full tiles.
