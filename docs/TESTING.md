# Verification record

ZERO 1.3.0 · 15 September 2026 · Windows x64 · Electron 44.3.0

## Reproduce

```sh
npm ci
npm run check
npm test
npm run package:windows
npm run test:desktop
```

The 90 Node tests cover population anchors and interpolation, timer recovery and
completion accounting, exact energy integration, FFT calibration, signed distance,
quarter-bridge polarity and inverse, phase/winding, Bayer thresholds, radar
range/Doppler/aliasing, NOAA live/cache validation, weather units and cached
timestamps, and Fourier analysis of contiguous minute-sampled wind data. Gaps,
invalid latest samples, constant readings and actual zero values are covered.
All pass.

The 31 real packaged Electron checks use a separate temporary profile. They cover:

- Sandboxed renderer, native topmost state and recovery, and explicit unpinning.
- Compact 280 × 294 layout and live counting while the timer is paused.
- Unified canvas, actual wind units, IJburg temperature and weather source details.
- Timer progress, energy, tray hiding/pausing, and single-instance activation.
- Expanded unified field with optional controls collapsed; AC/DC coupling, tare
  and signed probe controls in the model-study section.
- Virtual radar range and signed velocity; frozen art with a live population.
- Bayer atlas, observation timestamps, settings and interval controls.
- Saved timer, window position and pin preference after relaunch.
- No renderer exceptions in the exercised paths.

Reports and screenshots are generated in `dist/qa`. Compact, expanded, radar,
Earth/space and settings views were visually reviewed. A separate browser check
also confirmed scrolling without horizontal overflow at a 380 × 540 viewport.
The previous Python renderer harness was removed because it targeted the old UI;
the packaged Electron harness exercises the current application.

## Live sources and Windows installation

The current NOAA wind and magnetic feeds were fetched through the actual desktop
helper and accepted by its validators. Tests use fixed samples so an upstream
outage cannot produce a false model-test failure. The app retains valid partial
channels and labels missing or stale observations. A feed fetch is a network
integration check, not validation of the spacecraft's physical measurements.

The real NOAA history produced a valid 64-sample transform. The weather helper
also retrieved and validated the actual Open-Meteo current temperature for the
IJburg area. Neither successful fetch is treated as independent sensor validation.

The installer verifies that the installed executable remains running and that
unrelated current-user startup entries retain their values. The installed app's
version, native topmost flag and Windows sign-in registration are checked
separately from the isolated desktop tests.

A full Windows reboot, physical monitor unplugging, audible chime playback,
notification delivery, macOS/Linux native behavior and browser Picture-in-Picture
are not claimed as tested. Startup here means the current account signing in
after Windows boots.
