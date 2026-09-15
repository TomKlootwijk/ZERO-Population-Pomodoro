# Windows desktop guide

ZERO 1.2 is an Electron desktop app with an editable HTML/CSS/JavaScript interface.
The Windows package includes its runtime; installed users do not need Node.js.

## Build and install

Use Node.js 22.12+ on Windows x64. From the repository root, run:

```powershell
npm ci
npm run package:windows
powershell -NoProfile -File scripts/install-windows.ps1
```

`INSTALL-Windows.cmd` runs the same first-install steps. Packaging produces
`dist/ZERO-win32-x64`; keep its complete contents together. The installer copies
them into `%LOCALAPPDATA%\Programs\ZERO` and adds Desktop and Start menu shortcuts.
It launches ZERO with always-on-top and Windows startup enabled.

To update a running installation, rebuild and pass `-Update`:

```powershell
npm ci
npm run package:windows
powershell -NoProfile -File scripts/install-windows.ps1 -Update
```

The installer asks the existing app to exit before replacing its files. For an
older version without the graceful update command, it stops that installed ZERO
process after waiting. Timer and preference data are stored separately and kept.
Without `-Update`, quit ZERO from the tray before reinstalling.

## Always on top and Windows startup

The pin button, Settings, and **Always on top** tray item control the same saved
preference. The app opens at its saved position; double-click the header to dock
at the bottom right of its current display.

**Start with Windows** registers ZERO for the current account's Windows sign-in,
after boot. It is available in Settings and the tray menu for packaged Windows
builds. The installer enables it automatically. No administrator service is used.

Startup uses the `ZERO` value under
`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, containing the installed
executable's full path and `--startup`. Other startup entries are preserved.
To stop automatic launch, turn off **Start with Windows**. Pinning and startup
can be changed independently.

The **× button hides the app** while its timer keeps running. Click the tray icon
to bring it back. **Quit ZERO** exits the process. Starting ZERO again shows the
existing window instead of creating duplicate timers.

## Portable package

You can open `ZERO.exe` directly from the complete package directory. Keep all
files together when copying it; moving only the executable will not work.

For a portable build, put the folder in its final location before enabling
**Start with Windows**. If you move it later, toggle that setting off and on from
the new location to refresh its registered path. Builds are unsigned.

## Local data and checks

Settings, timer state, and the saved Census feed live in `%APPDATA%\ZERO`.
`desktop-settings.json` stores the native pin and position preferences. Updating
the application files preserves this profile. A running timer restores its
wall-clock deadline when ZERO relaunches.

`npm run test:desktop` exercises a packaged build with an isolated temporary
profile under `dist`, leaving the installed profile and startup entry untouched.
It writes screenshots and a JSON result report to `dist/qa`. See
[TESTING.md](TESTING.md) for the checks actually performed and their limits.
