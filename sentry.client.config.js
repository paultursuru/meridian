import * as Sentry from "@sentry/astro";

Sentry.init({
  dsn: "https://bf8afd06f49d13d2e136c99d78e88626@o4511568346021888.ingest.de.sentry.io/4511568347856976",
  // To disable sending user data, uncomment the line below. For more info visit:
  // https://docs.sentry.io/platforms/javascript/guides/astro/configuration/options/#dataCollection
  dataCollection: { userInfo: false },
});