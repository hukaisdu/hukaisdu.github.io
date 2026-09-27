const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const site = process.env.SITE_DIR;
assert.ok(site && fs.existsSync(site), 'Set SITE_DIR to a fresh Jekyll build directory.');
const base = 'https://hukaisdu.github.io';
const readPage = (route) => fs.readFileSync(path.join(site, route, 'index.html'), 'utf8');

function publications(language) {
  const route = language === 'zh' ? 'zh/publications' : 'publications';
  const dom = new JSDOM(readPage(route), { url: `${base}/${route}/`, runScripts: 'outside-only' });
  const { window } = dom;
  const document = window.document;
  let download;
  window.Blob = Blob;
  window.URL.createObjectURL = (blob) => { download = blob; return 'blob:site-test'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {};
  Object.defineProperty(document, 'readyState', { value: 'complete' });
  const script = [...document.scripts].find((node) => node.textContent.includes('setupPublicationFilters'));
  assert.ok(script, 'Publication script must be present in the generated page');
  window.eval(script.textContent);
  const get = (id) => document.getElementById(id);
  const change = (id, value) => {
    get(id).value = value;
    get(id).dispatchEvent(new window.Event(id === 'pub-search' ? 'input' : 'change'));
  };
  const visibleTitles = () => [...document.querySelectorAll('h3')]
    .filter((node) => node.querySelector('.pub-title') && node.style.display !== 'none')
    .map((node) => node.textContent.trim());
  return {
    dom, document, get, change, visibleTitles,
    export: async () => {
      download = undefined;
      get('pub-export-bibtex').click();
      return download ? download.text() : null;
    }
  };
}

function bibEntries(text) {
  return text.split(/(?=@misc\{)/).slice(1).map((entry) => ({
    key: entry.match(/^@misc\{([^,]+),/)[1],
    author: entry.match(/author\s*=\s*\{([^\n]*)\},/)[1],
    title: entry.match(/title\s*=\s*\{\{([^\n]*)\}\},/)[1],
    url: entry.match(/url\s*=\s*\{([^\n]*)\},/)[1],
    raw: entry
  }));
}

for (const language of ['en', 'zh']) {
  const source = fs.readFileSync(path.join(root, '_pages', language === 'zh' ? 'publications-zh.md' : 'publications.md'), 'utf8');
  const total = (source.match(/class="pub-title"/g) || []).length;
  const currentYear = source.split('<h2 id="2026">')[1].split('<h2')[0];
  const currentYearCount = (currentYear.match(/class="pub-title"/g) || []).length;
  test(`${language}: initial data, combined filters, venue buttons and reset`, (t) => {
    const p = publications(language);
    t.after(() => p.dom.window.close());
    assert.equal(p.visibleTitles().length, total);
    assert.ok(p.get('pub-result-count').textContent.includes(String(total)));
    assert.ok(p.get('pub-venue').querySelector('option[value="CRYPTO"]'));
    p.change('pub-year', '2026');
    assert.equal(p.visibleTitles().length, currentYearCount);
    p.change('pub-venue', 'CRYPTO');
    assert.ok(p.visibleTitles().length >= 2);
    assert.ok(p.visibleTitles().includes('Cryptanalytic Properties of Mealy Machines'));
    p.change('pub-search', 'tIm BeYnE');
    assert.deepEqual(p.visibleTitles(), ['Cryptanalytic Properties of Mealy Machines']);
    assert.equal(p.document.querySelector('h2[id="2025"]').style.display, 'none');
    p.get('pub-reset').click();
    assert.equal(p.visibleTitles().length, total);
    const tag = [...p.document.querySelectorAll('.pub-venue-tag')].find((node) => node.textContent.startsWith('EUROCRYPT '));
    tag.click();
    assert.ok(p.visibleTitles().length >= 2 && p.visibleTitles().length < total);
    assert.equal(tag.getAttribute('aria-pressed'), 'true');
    tag.click();
    assert.equal(p.visibleTitles().length, total);
    assert.equal(tag.getAttribute('aria-pressed'), 'false');
  });

  test(`${language}: empty filters never export stale results`, async (t) => {
    const p = publications(language);
    t.after(() => p.dom.window.close());
    p.change('pub-search', 'no-such-publication-0123456789');
    assert.equal(p.visibleTitles().length, 0);
    assert.equal(await p.export(), null);
    assert.ok([...p.document.querySelectorAll('h2[id^="20"]')].every((node) => node.style.display === 'none'));
    p.get('pub-reset').click();
    assert.equal(p.visibleTitles().length, total);
  });

  test(`${language}: BibTeX preserves authors, links, TeX and stable unique keys`, async (t) => {
    const p = publications(language);
    t.after(() => p.dom.window.close());
    const all = bibEntries(await p.export());
    assert.equal(all.length, total);
    assert.equal(new Set(all.map((entry) => entry.key)).size, total);
    for (const entry of all) {
      assert.ok(entry.author.length > 0);
      assert.doesNotMatch(entry.author, /✉|CRYPTO|Cryptology ePrint Archive|IACR Trans/);
      assert.match(entry.url, /^https:\/\/(hukaisdu\.github\.io|eprint\.iacr\.org)\//);
      assert.ok(entry.raw.includes(`howpublished = {\\url{${entry.url}}}`));
    }
    const mealy = all.find((entry) => entry.title === 'Cryptanalytic Properties of Mealy Machines');
    assert.equal(mealy.author, 'Zhongfeng Niu and Tim Beyne and Kai Hu and Meiqin Wang');
    assert.equal(mealy.url, 'https://eprint.iacr.org/2026/1193');
    p.change('pub-search', 'mealy');
    const selected = bibEntries(await p.export());
    assert.equal(selected.length, 1);
    assert.equal(selected[0].key, mealy.key);
    const localPdf = all.find((entry) => entry.title === 'How Small Can S-boxes Be?');
    assert.equal(localPdf.url, `${base}/files/papers/2025-how-small-sboxes.pdf`);
    const math = all.find((entry) => entry.title.includes('Exact Coefficients'));
    assert.ok(math.title.includes('$\\mathbb{F}_{p}$'));
    assert.doesNotMatch(math.title, /textbackslash/);
    assert.equal(p.document.querySelectorAll('.page__content a[href="#"]').length, 0);
  });
}

test('all twelve pages have correct language metadata and working internal resource paths', () => {
  for (const language of ['en', 'zh']) {
    for (const name of ['', 'publications', 'service', 'talks', 'teaching', 'awards']) {
      const route = [language === 'zh' ? 'zh' : '', name].filter(Boolean).join('/');
      const dom = new JSDOM(readPage(route), { url: `${base}/${route}/` });
      const document = dom.window.document;
      assert.equal(document.documentElement.lang, language);
      assert.equal(document.querySelector('meta[property="og:locale"]').content, language === 'zh' ? 'zh_CN' : 'en_US');
      assert.ok(document.querySelector('meta[name="description"]').content.length > 0);
      assert.equal(document.querySelectorAll('link[hreflang]').length, 2);
      for (const node of document.querySelectorAll('[href], [src]')) {
        const ref = node.getAttribute('href') || node.getAttribute('src');
        const url = new URL(ref, document.baseURI);
        if (url.origin !== base) continue;
        const local = path.join(site, decodeURIComponent(url.pathname));
        assert.ok(fs.existsSync(local) || fs.existsSync(`${local}.html`), `${route}: missing ${url.pathname}`);
      }
      if (name === 'talks') {
        assert.match(document.querySelector('.page__content').textContent, /GelreCrypt 2025/);
        assert.doesNotMatch(document.querySelector('.page__content').textContent, /Gelrecrypt 2026/);
      }
      dom.window.close();
    }
  }
});

test('manifest uses real icons; local notes and conflict copies stay out of the build', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(site, 'images/manifest.json'), 'utf8'));
  assert.equal(manifest.name, 'Kai Hu / 胡凯');
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(site, icon.src)));
  const outputFiles = fs.readdirSync(site, { recursive: true }).map(String);
  assert.ok(outputFiles.every((name) => !/sync-conflict|\d{4}-\d{2}-\d{2}-log|^tests[\\/]/.test(name)));
});
