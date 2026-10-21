/* Quiz-Deck · logic tests. Run with: node tests/logic_test.cjs */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const core = require('../src/core.js');

const ROOT = path.join(__dirname, '..');
const bankFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/bank/items.json'), 'utf8'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let checks = 0;
function ok(condition, label) {
  checks += 1;
  assert.ok(condition, label);
}
function eq(actual, expected, label) {
  checks += 1;
  assert.deepStrictEqual(actual, expected, label);
}

const AUTHORED = ['en', 'ro', 'sr-latn'];
const LOCALES = ['en', 'ro', 'sr-latn', 'sr-cyrl'];
const TOPICS = ['math', 'logic', 'geo', 'sci', 'words', 'history', 'culture'];

/* ---------- the bank ---------- */

eq(bankFile.items.length, 72, 'the bank holds 72 questions');
eq(new Set(bankFile.items.map((item) => item.id)).size, bankFile.items.length, 'ids are unique');
ok(/^\d{4}-\d{2}-\d{2}$/.test(bankFile.checked), 'the bank carries a checked date');

bankFile.items.forEach((item) => {
  ok(TOPICS.includes(item.topic), `${item.id}: known topic`);
  eq(item.options.length, 4, `${item.id}: four options`);
  ok(Number.isInteger(item.correct) && item.correct >= 0 && item.correct < 4, `${item.id}: correct in range`);
  ok(typeof item.source === 'string' || typeof item.source === 'object', `${item.id}: a source is written`);
  if (typeof item.source === 'string') {
    ok(item.source.trim().length > 0, `${item.id}: the source is not empty`);
  } else {
    AUTHORED.forEach((locale) => ok(item.source[locale] && item.source[locale].trim(), `${item.id}: the source in ${locale}`));
  }
  AUTHORED.forEach((locale) => {
    ok(item.q[locale] && item.q[locale].trim(), `${item.id}: question in ${locale}`);
    ok(item.why[locale] && item.why[locale].trim(), `${item.id}: explanation in ${locale}`);
    const texts = item.options.map((option) => option[locale]);
    texts.forEach((text) => ok(text && text.trim(), `${item.id}: option in ${locale}`));
    eq(new Set(texts.map((text) => text.trim().toLowerCase())).size, 4, `${item.id}: options differ in ${locale}`);
  });
});

eq(new Set(bankFile.items.map((item) => item.q.en.toLowerCase())).size, bankFile.items.length,
  'no two questions ask the same thing');

/* ---------- what a round looks like ---------- */

const seed = 'daily:2026-10-21';
const first = core.pickRound(bankFile.items, 12, seed);
const again = core.pickRound(bankFile.items, 12, seed);
eq(first, again, 'the same seed deals the same round');
eq(first.length, 12, 'a round holds twelve questions');
eq(new Set(first).size, 12, 'a round never repeats a question');

const byId = Object.fromEntries(bankFile.items.map((item) => [item.id, item]));
const topicsInRound = new Set(first.map((id) => byId[id].topic));
ok(topicsInRound.size >= 5, `a round touches several subjects (${topicsInRound.size})`);

const other = core.pickRound(bankFile.items, 12, 'daily:2026-10-22');
ok(first.join() !== other.join(), 'the next day deals a different round');

const seen = new Set();
for (let day = 0; day < 120; day += 1) {
  const stamp = core.shiftDay('2026-01-01', day);
  core.pickRound(bankFile.items, 12, 'daily:' + stamp).forEach((id) => seen.add(id));
}
eq(seen.size, bankFile.items.length, 'every question shows up within 120 days');

/* ---------- option order ---------- */

const orders = core.ordersFor(first, seed);
eq(orders.length, 12, 'one order per question');
orders.forEach((order) => {
  eq(order.slice().sort().join(','), '0,1,2,3', 'the order is a shuffle of four positions');
});
eq(core.ordersFor(first, seed), orders, 'the same seed shuffles the options the same way');
const rightPlaces = new Set(orders.map((order, index) => order.indexOf(byId[first[index]].correct)));
ok(rightPlaces.size >= 3, 'the right answer does not always sit in the same place');

/* ---------- dates and clock ---------- */

eq(core.today(), core.ymd(new Date()), 'today follows the local clock');
eq(core.shiftDay('2026-03-01', -1), '2026-02-28', 'a day back crosses the month');
eq(core.shiftDay('2026-01-01', -1), '2025-12-31', 'a day back crosses the year');
eq(core.parseYmd('2026-02-30'), null, 'the 30th of February is not a date');
eq(core.parseYmd('21.10.2026'), null, 'a dotted date is refused');
eq(core.formatTime(0), '0:00', 'zero seconds');
eq(core.formatTime(61), '1:01', 'a minute and a second');
eq(core.formatTime(605), '10:05', 'ten minutes');
eq(core.formatTime(3661), '1:01:01', 'past an hour');

/* ---------- the record lives on one machine ---------- */

let progress = core.emptyProgress();
progress = core.recordDay(progress, '2026-10-19', 8, 120, 12);
progress = core.recordDay(progress, '2026-10-20', 10, 95, 12);
progress = core.recordDay(progress, '2026-10-21', 9, 110, 12);
eq(core.streakOf(progress, '2026-10-21', 12), 3, 'three days in a row');
eq(core.streakOf(progress, '2026-10-22', 12), 3, 'the streak still holds before today is played');
eq(core.streakOf(progress, '2026-10-24', 12), 0, 'a gap of two days breaks the streak');
eq(core.bestOf(progress, 12), { s: 10, t: 95 }, 'the best score wins, the faster run breaks a tie');

const better = core.recordDay(progress, '2026-10-21', 12, 130, 12);
eq(better.d['2026-10-21'], { s: 12, t: 130 }, 'a better score replaces the older one');
const slower = core.recordDay(better, '2026-10-21', 12, 160, 12);
eq(slower.d['2026-10-21'], { s: 12, t: 130 }, 'a slower run with the same score is ignored');
const faster = core.recordDay(better, '2026-10-21', 9, 60, 12);
eq(faster.d['2026-10-21'], { s: 12, t: 130 }, 'a worse score never replaces a better one');

const dirty = core.sanitizeProgress({
  d: {
    '2026-10-21': { s: 7, t: 100 },
    '2026-13-01': { s: 7, t: 100 },
    'yesterday': { s: 7, t: 100 },
    '2026-10-20': { s: 99, t: 100 },
    '2026-10-19': { s: 'x', t: 100 },
    '2026-10-18': { s: 5, t: -4 }
  }
}, 12);
eq(Object.keys(dirty.d), ['2026-10-21'], 'junk entries are dropped');

const imported = core.mergeProgress(
  { d: { '2026-10-21': { s: 9, t: 100 } } },
  { d: { '2026-10-21': { s: 11, t: 140 }, '2026-10-20': { s: 6, t: 90 } } },
  12
);
eq(imported.d['2026-10-21'], { s: 11, t: 140 }, 'the import keeps the better run');
eq(imported.d['2026-10-20'], { s: 6, t: 90 }, 'the import adds the days it brought');
eq(imported.best, { s: 11, t: 140 }, 'the record follows the import');

/* ---------- the challenge link ---------- */

eq(core.parseChallenge('?d=2026-10-21&s=9&t=107'), { day: '2026-10-21', score: 9, time: 107 }, 'a good link is read');
eq(core.parseChallenge('?d=2026-10-21&s=9'), null, 'a link without the time is refused');
eq(core.parseChallenge('?d=2026-02-30&s=9&t=107'), null, 'a link with a fake date is refused');
eq(core.parseChallenge('?d=2026-10-21&s=-1&t=107'), null, 'a negative score is refused');
eq(core.parseChallenge('?d=2026-10-21&s=9&t=999999'), null, 'an absurd time is refused');
eq(core.parseChallenge(''), null, 'no link, no challenge');

eq(
  core.challengeUrl('https://tekideki.github.io/Quiz-Deck/?x=1#top', '2026-10-21', 9, 107.4),
  'https://tekideki.github.io/Quiz-Deck/?d=2026-10-21&s=9&t=107',
  'the challenge link is built from the bare address'
);

/* ---------- the built page ---------- */

ok(html.startsWith('<!DOCTYPE html>'), 'the page starts with the doctype');
ok(html.startsWith('\ufeff') === false, 'no byte order mark');
ok(html.includes('\u2014') === false, 'no em dash');
ok(html.includes('\u2013') === false, 'no en dash');
ok(html.includes('\u00a0') === false, 'no no-break space');
ok(html.includes('<style>'), 'the styles are inlined');
eq(/<script src="(?!https:\/\/)/.test(html), false, 'no script is loaded from a file');
eq(/<link rel="stylesheet"/.test(html), false, 'no stylesheet is loaded from a file');
ok(html.includes('window.TD_BANK'), 'the bank is inlined');
ok(html.includes('window.TD_LOCALES'), 'the strings are inlined');
ok(html.includes('window.TD_N = 12'), 'the round length is inlined');
ok(html.includes('manifest.json'), 'the manifest is named');
ok(html.includes('sw.js') === false || html.includes("register('sw.js')"), 'the worker is registered from code');

const embedded = JSON.parse(html.match(/window\.TD_BANK = (\{.*?\});\nwindow\.TD_N/s)[1]);
eq(embedded.items.length, bankFile.items.length, 'every question reached the page');
eq(embedded.items.map((item) => item.id), bankFile.items.map((item) => item.id), 'the order is stable');
const cyr = embedded.items.every((item) => LOCALES.every((locale) => item.q[locale] && item.why[locale]));
embedded.items.forEach((item) => {
  ok(/[\u0400-\u04ff]/.test(item.q['sr-cyrl']), `${item.id}: the Cyrillic question is written in Cyrillic`);
  eq(/[A-Za-z]/.test(item.q['sr-cyrl'].replace(/aqua|penny-farthing/gi, '')), false, `${item.id}: no stray Latin letters`);
  eq(/[A-Za-z]/.test(item.why['sr-cyrl'].replace(/aqua|penny-farthing/gi, '')), false, `${item.id}: no stray Latin letters in the explanation`);
});
ok(cyr, 'all four locales travel with every question');
ok(embedded.items.every((item) => item.options.every((option) => LOCALES.every((locale) => option[locale]))),
  'all four locales travel with every option');

const embeddedLocales = JSON.parse(html.match(/window\.TD_LOCALES = (\{.*?\});\nwindow\.TD_BANK/s)[1]);
eq(Object.keys(embeddedLocales).sort(), ['en', 'ro', 'sr-cyrl', 'sr-latn'], 'four interface locales');
eq(Object.keys(embeddedLocales['sr-cyrl']).length, Object.keys(embeddedLocales.en).length, 'every string has a Cyrillic twin');
ok(Object.values(embeddedLocales['sr-cyrl']).every((text) => !/[A-Za-z]/.test(
  text.replace(/GitHub|freehtml\.dev|HTML|JSON|localStorage|Quiz-Deck/g, '').replace(/\{\w+\}/g, ''))),
  'the Cyrillic interface holds no Latin letters');

console.log(`logic tests: ${checks} checks passed`);
