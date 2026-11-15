import { test, expect } from '@playwright/test';

// The city pages' JSON-LD must say what the page says: every FAQ question and
// answer on screen word for word, the method included, a two-level breadcrumb,
// and the graph's nodes linked by @id.

async function stubUpstreams(page) {
  await page.route(/nominatim|photon|open-meteo|workers\.dev|stadiamaps|openfreemap/, route => route.abort());
}

// frTypo puts no-break spaces in the visible text only.
const norm = text => text.replace(/[\s\u00a0\u202f]+/g, ' ').trim();

for (const [path, name] of [['/lausanne/', 'Lausanne'], ['/geneve/', 'Genève']]) {
  test(`${path} marks up what it shows`, async ({ page }) => {
    await stubUpstreams(page);
    await page.goto(path);
    const graph = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent())['@graph'];
    const byType = type => graph.find(node => node['@type'] === type);
    const url = `https://meridian-way.ch${path}`;

    const webPage = byType('WebPage');
    expect(webPage['@id']).toBe(url);
    expect(webPage.about.name).toBe(name);
    expect(webPage.breadcrumb['@id']).toBe(byType('BreadcrumbList')['@id']);
    expect(webPage.hasPart['@id']).toBe(byType('FAQPage')['@id']);

    expect(byType('BreadcrumbList').itemListElement.map(item => [item.position, item.name, item.item]))
      .toEqual([[1, 'MeridianWay', 'https://meridian-way.ch/'], [2, name, url]]);

    // Each question is a heading, its answer the paragraph right after it.
    const onPage = await page.locator('main :is(h2, h3)').evaluateAll(headings =>
      headings.map(h => [h.textContent, h.nextElementSibling?.textContent ?? '']));
    const shown = new Map(onPage.map(([q, a]) => [norm(q), norm(a)]));
    const questions = byType('FAQPage').mainEntity;
    expect(questions.at(-1).name).toBe('D\'où viennent ces chiffres ?');
    for (const { name: q, acceptedAnswer } of questions) {
      expect(shown.get(norm(q)), q).toBe(norm(acceptedAnswer.text));
    }
  });
}
