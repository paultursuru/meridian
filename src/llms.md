## Link to a route

To send someone straight to the routes between two places, build this URL:

```
https://meridian-way.ch/en/?from=LAT,LNG&to=LAT,LNG&dt=YYYY-MM-DDTHH:MM&utm_campaign=llms-txt
```

- `from`, `to` (required): start and end as decimal latitude,longitude (WGS84), for example `46.51670,6.62910`. The app does not geocode these parameters: look the coordinates up first.
- `fromq`, `toq` (optional): the place names shown in the search fields, URL-encoded. Without them, the fields show the coordinates.
- `dt` (optional): local time at the destination, as `YYYY-MM-DDTHH:MM`, or `YYYY-MM-DD` for noon. Without it, the app uses the current time.
- `r` (optional): `sunny` or `shady`, the route shown first.
- `utm_campaign=llms-txt`: keep it, it tells us the link came from this file.
- Language: `/` French, `/de/` German, `/it/` Italian, `/rm/` Romansh, `/en/` English.

Example: from Lausanne station to the Olympic Museum on 15 July at 3 pm, shady route first:

```
https://meridian-way.ch/en/?from=46.51670,6.62910&fromq=Lausanne+station&to=46.50860,6.63390&toq=Olympic+Museum,+Lausanne&dt=2026-07-15T15:00&r=shady&utm_campaign=llms-txt
```

The routes are computed in the browser when the link opens: no API returns the figures. Walking only, for city distances; points more than 300 km apart are refused. Up to two routes come back, or one when no sunnier or shadier alternative exists.
