import { buildShareQuery } from './share.js';

// The demo the "what do I do?" button opens: a real search, from Lausanne
// station to the Olympic Museum on a summer afternoon, chosen for the gap it
// shows between the two routes (about 71 % sun against 45 %, same duration).
// Fixed date and time so it never lands on a night search. The demo's note
// (i18n onboarding_description) names this date and time, and
// onboarding_from / onboarding_to name the two places: change them together.
export const ONBOARDING = {
  start: { lat: 46.5167, lng: 6.6291, countryCode: 'ch' },
  end: { lat: 46.5086, lng: 6.6339, countryCode: 'ch' },
  date: '2026-07-15',
  time: '15:00',
};

// Query string of the demo link, labels in the page's language.
export function onboardingQuery({ from, to }) {
  return buildShareQuery({
    start: { ...ONBOARDING.start, label: from },
    end: { ...ONBOARDING.end, label: to },
    date: ONBOARDING.date,
    time: ONBOARDING.time,
    onboarding: true,
  });
}
