/* Quiz-Deck · pure helpers, no DOM.
   Shared by the page and by the Node tests. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (root) { root.QuizDeck = api; }
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function ymd(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function today() { return ymd(new Date()); }

  function parseYmd(value) {
    var m = DAY_RE.exec(String(value || ''));
    if (!m) { return null; }
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
      return null;
    }
    return d;
  }

  function shiftDay(value, delta) {
    var d = parseYmd(value);
    if (!d) { return value; }
    d.setDate(d.getDate() + delta);
    return ymd(d);
  }

  /* FNV-1a, 32 bit. Small, stable and the same in every browser. */
  function hash(text) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /* xorshift32 driven by a string, so the same seed always deals the same round. */
  function rng(seed) {
    var s = hash(String(seed)) || 0x9e3779b9;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function shuffle(list, random) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i -= 1) {
      var j = Math.floor(random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  /* One question per topic in turn, so a round never leans on a single subject. */
  function pickRound(items, count, seed) {
    var random = rng(seed);
    var byTopic = {};
    items.forEach(function (item) {
      if (!byTopic[item.topic]) { byTopic[item.topic] = []; }
      byTopic[item.topic].push(item.id);
    });
    var topics = shuffle(Object.keys(byTopic).sort(), random);
    var pools = {};
    topics.forEach(function (topic) { pools[topic] = shuffle(byTopic[topic], random); });

    var out = [];
    var step = 0;
    while (out.length < count && step < count * 40) {
      var topic = topics[step % topics.length];
      if (pools[topic].length) { out.push(pools[topic].pop()); }
      step += 1;
    }
    return out;
  }

  /* Four positions, shuffled. The correct answer moves with them. */
  function ordersFor(ids, seed) {
    return ids.map(function (id) {
      return shuffle([0, 1, 2, 3], rng('opts:' + id + ':' + seed));
    });
  }

  function formatTime(seconds) {
    var s = Math.max(0, Math.round(Number(seconds) || 0));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var rest = s % 60;
    if (h > 0) { return h + ':' + pad(m) + ':' + pad(rest); }
    return m + ':' + pad(rest);
  }

  function medal(score, total) {
    if (!total) { return ''; }
    var part = score / total;
    if (part === 1) { return 'gold'; }
    if (part >= 0.75) { return 'silver'; }
    if (part >= 0.5) { return 'bronze'; }
    return 'none';
  }

  function emptyProgress() {
    return { v: 1, d: {}, best: { s: 0, t: 0 } };
  }

  function cleanEntry(entry, total) {
    if (!entry || typeof entry !== 'object') { return null; }
    var s = Math.round(Number(entry.s));
    var t = Math.round(Number(entry.t));
    if (!isFinite(s) || !isFinite(t)) { return null; }
    if (s < 0 || s > total || t < 0 || t > 86400) { return null; }
    return { s: s, t: t };
  }

  function bestOf(progress, total) {
    var best = { s: 0, t: 0 };
    Object.keys(progress.d || {}).forEach(function (day) {
      var e = progress.d[day];
      if (!e) { return; }
      if (e.s > best.s || (e.s === best.s && e.s > 0 && (!best.t || e.t < best.t))) {
        best = { s: e.s, t: e.t };
      }
    });
    if (best.s === 0) { return { s: 0, t: 0 }; }
    return best;
  }

  function streakOf(progress, fromDay, total) {
    var days = progress.d || {};
    var cursor = days[fromDay] ? fromDay : shiftDay(fromDay, -1);
    var count = 0;
    while (days[cursor] && count < 4000) {
      count += 1;
      cursor = shiftDay(cursor, -1);
    }
    return count;
  }

  function sanitizeProgress(raw, total) {
    var out = emptyProgress();
    if (!raw || typeof raw !== 'object' || !raw.d || typeof raw.d !== 'object') { return out; }
    var keys = Object.keys(raw.d).filter(function (day) { return parseYmd(day); }).sort();
    keys.slice(-400).forEach(function (day) {
      var clean = cleanEntry(raw.d[day], total);
      if (clean) { out.d[day] = clean; }
    });
    out.best = bestOf(out, total);
    return out;
  }

  function mergeProgress(local, incoming, total) {
    var a = sanitizeProgress(local, total);
    var b = sanitizeProgress(incoming, total);
    var out = emptyProgress();
    [a.d, b.d].forEach(function (days) {
      Object.keys(days).forEach(function (day) {
        var next = days[day];
        var prev = out.d[day];
        if (!prev || next.s > prev.s || (next.s === prev.s && next.t < prev.t)) {
          out.d[day] = { s: next.s, t: next.t };
        }
      });
    });
    var keys = Object.keys(out.d).sort().slice(-400);
    var trimmed = emptyProgress();
    keys.forEach(function (day) { trimmed.d[day] = out.d[day]; });
    trimmed.best = bestOf(trimmed, total);
    return trimmed;
  }

  function recordDay(progress, day, score, seconds, total) {
    var clean = cleanEntry({ s: score, t: seconds }, total);
    if (!clean || !parseYmd(day)) { return sanitizeProgress(progress, total); }
    var out = sanitizeProgress(progress, total);
    var prev = out.d[day];
    if (!prev || clean.s > prev.s || (clean.s === prev.s && clean.t < prev.t)) {
      out.d[day] = clean;
    }
    out.best = bestOf(out, total);
    return out;
  }

  function parseChallenge(search) {
    var params = new URLSearchParams(search || '');
    var day = params.get('d');
    var score = params.get('s');
    var time = params.get('t');
    if (!parseYmd(day)) { return null; }
    if (!/^\d{1,2}$/.test(score || '') || !/^\d{1,6}$/.test(time || '')) { return null; }
    var s = Number(score);
    var t = Number(time);
    if (s < 0 || s > 99 || t < 0 || t > 86400) { return null; }
    return { day: day, score: s, time: t };
  }

  function challengeUrl(base, day, score, seconds) {
    var head = String(base).split('#')[0].split('?')[0];
    return head + '?d=' + day + '&s=' + score + '&t=' + Math.round(seconds);
  }

  return {
    pad: pad,
    ymd: ymd,
    today: today,
    parseYmd: parseYmd,
    shiftDay: shiftDay,
    hash: hash,
    rng: rng,
    shuffle: shuffle,
    pickRound: pickRound,
    ordersFor: ordersFor,
    formatTime: formatTime,
    medal: medal,
    emptyProgress: emptyProgress,
    bestOf: bestOf,
    streakOf: streakOf,
    sanitizeProgress: sanitizeProgress,
    mergeProgress: mergeProgress,
    recordDay: recordDay,
    parseChallenge: parseChallenge,
    challengeUrl: challengeUrl
  };
}));
