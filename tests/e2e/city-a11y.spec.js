import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

// WCAG rules on the city page, in both moods and at both breakpoints. Lighthouse
// only sees the mood the page opens on, so the other one needs its own run.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } };
const MOODS = { shade: "L'ombre", sun: 'Le soleil' };

for (const [device, viewport] of Object.entries(VIEWPORTS)) {
  for (const [mood, label] of Object.entries(MOODS)) {
    test(`/lausanne/ passes the WCAG rules, ${mood} mood on ${device}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.route(/nominatim|photon|open-meteo|workers\.dev|stadiamaps|openfreemap/, route => route.abort());
      await page.goto('/lausanne/');
      // Mid-transition colours would fail for the wrong reason.
      await page.addStyleTag({ content: '*, *::before { transition: none !important; }' });

      const option = page.getByRole('button', { name: label, exact: true });
      await option.click();
      await expect(option).toHaveAttribute('aria-pressed', 'true');

      const { violations, incomplete } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(violations.flatMap(v => v.nodes.map(n => `${v.id}: ${n.target.join(' ')}`))).toEqual([]);
      // A rule that crashes lands in "incomplete", and the line above would pass without it.
      expect(incomplete.filter(rule => rule.error).map(rule => rule.id)).toEqual([]);
    });
  }
}
