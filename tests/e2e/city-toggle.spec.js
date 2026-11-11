import { test, expect } from '@playwright/test';

// The "À l'ombre / Au soleil" toggle, by mouse and by keyboard. Each option is
// its own button, so its visible label is the name assistive tech reads.

test.beforeEach(async ({ page }) => {
  await page.route(/nominatim|photon|open-meteo|workers\.dev|stadiamaps|openfreemap/, route => route.abort());
  await page.goto('/lausanne/');
});

const shade = page => page.getByRole('button', { name: "À l'ombre" });
const sun = page => page.getByRole('button', { name: 'Au soleil' });

test('the page opens on the shade side', async ({ page }) => {
  await expect(page.getByRole('group', { name: 'Ambiance de la page' })).toBeVisible();
  await expect(shade(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(sun(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('body')).not.toHaveClass(/(^|\s)sun(\s|$)/);
});

test('a click changes the mood and both pressed states', async ({ page }) => {
  await sun(page).click();
  await expect(page.locator('body')).toHaveClass(/(^|\s)sun(\s|$)/);
  await expect(sun(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(shade(page)).toHaveAttribute('aria-pressed', 'false');

  await shade(page).click();
  await expect(page.locator('body')).not.toHaveClass(/(^|\s)sun(\s|$)/);
  await expect(shade(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(sun(page)).toHaveAttribute('aria-pressed', 'false');
});

test('a click on the side already selected changes nothing', async ({ page }) => {
  await shade(page).click();
  await expect(page.locator('body')).not.toHaveClass(/(^|\s)sun(\s|$)/);
  await expect(shade(page)).toHaveAttribute('aria-pressed', 'true');
});

for (const key of ['Enter', 'Space']) {
  test(`${key} on the focused option switches the mood`, async ({ page }) => {
    await sun(page).focus();
    await page.keyboard.press(key);
    await expect(page.locator('body')).toHaveClass(/(^|\s)sun(\s|$)/);
    await expect(sun(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(sun(page)).toBeFocused();
  });
}

test('Tab reaches both options in reading order', async ({ page }) => {
  await page.locator('.content-nav .open-app').focus();
  await page.keyboard.press('Tab');
  await expect(shade(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(sun(page)).toBeFocused();
});

test('the side not highlighted keeps its text at full colour, only its frame recedes', async ({ page }) => {
  const style = (side, sel, prop) => page.locator(`.glance-card[data-side=${side}] ${sel}`.trim()).first()
    .evaluate((el, p) => getComputedStyle(el)[p], prop);
  for (const [click, on, off] of [[null, 'shade', 'sun'], [sun, 'sun', 'shade']]) {
    if (click) await click(page).click();
    // Polled: the page fades between moods.
    const same = async (sel, prop) => (await style(off, sel, prop)) === (await style(on, sel, prop));
    for (const sel of ['h3', '.glance-value']) await expect.poll(() => same(sel, 'color')).toBe(true);
    await expect.poll(() => same('', 'borderTopColor')).toBe(false);
  }
});
