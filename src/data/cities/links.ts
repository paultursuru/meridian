// Links to the city pages from the French footers and the app's about drawer.
// The label follows the page's `season`, so switching it updates every link.
import { lausanne } from './lausanne';
import type { Season } from './types';

const IN_SEASON: Record<Season, string> = { hiver: 'en hiver', ete: 'en été' };

export const cityLinks = [lausanne].map(city => ({
  href: `/${city.slug}/`,
  label: `${city.name} ${IN_SEASON[city.season]}`,
}));
