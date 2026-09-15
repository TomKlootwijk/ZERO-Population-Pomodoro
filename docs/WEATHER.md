# IJburg temperature

The compact strip displays current modeled air temperature for IJburg, Amsterdam,
using the neighborhood reference point 52.36° N, 4.99° E.

The source is [Open-Meteo](https://open-meteo.com/). Its current conditions use
15-minute weather-model data; `temperature_2m` is air temperature two metres above
ground. The selected model grid cell can differ from the requested neighborhood
point. This is a local model estimate, not a physical sensor at the user's home.
[Official API documentation](https://open-meteo.com/en/docs)

`web/weather.js` defines a fixed HTTPS forecast request with current temperature,
apparent temperature and weather code. The response must declare Celsius and Unix
epoch seconds, with zero UTC offset. ZERO converts seconds to milliseconds exactly
once. Temperature must be a finite number from −100 to 70°C; invalid or missing
optional apparent temperature and weather code remain unavailable. It never turns
null, a string or a fill sentinel into a displayed zero.

ZERO refreshes every 15 minutes. The desktop fetcher coalesces simultaneous requests,
caches successful results for ten minutes, times out after 15 seconds and caps each
response at 1 MB. A stored snapshot is revalidated before display. Model times more
than 24 hours old or two minutes in the future are rejected; readings older than
45 minutes show **Stale**. A failed refresh retains its previous timestamped value
as **Cached** or **Stale**, or displays **Unavailable** when no usable value exists.

Click the 24-pixel strip to see the condition, apparent temperature when available,
UTC model-valid time and refresh control. Escape or the close button dismisses the
details. The source link remains visible beside the temperature.

Weather data are provided by Open-Meteo under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), with provider attribution
beside the readout. ZERO selects fields, validates the response and rounds displayed
temperatures to one decimal place; the source does not endorse this application.
[Open-Meteo data licence](https://open-meteo.com/en/licence)
