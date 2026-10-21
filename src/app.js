/* Quiz-Deck · the page. Everything runs in this tab. */
(function () {
  'use strict';

  var Core = window.QuizDeck;
  var DICT = window.TD_LOCALES;
  var BANK = window.TD_BANK;
  var N = window.TD_N || 12;
  var TOTAL = BANK.items.length;
  var CHECKED = BANK.checked;

  var LANGS = [
    { code: 'ro', label: 'Română', html: 'ro', intl: 'ro-RO' },
    { code: 'en', label: 'English', html: 'en', intl: 'en-GB' },
    { code: 'sr-latn', label: 'Srpski', html: 'sr-Latn', intl: 'sr-Latn-RS' },
    { code: 'sr-cyrl', label: 'Српски', html: 'sr-Cyrl', intl: 'sr-Cyrl-RS' }
  ];

  var KEY = {
    theme: 'quiz-deck:theme',
    lang: 'quiz-deck:lang',
    progress: 'quiz-deck:progress'
  };

  var shownDay = '';

  var byId = {};
  BANK.items.forEach(function (item) { byId[item.id] = item; });

  var el = {};
  ['lang', 'theme', 'screen-start', 'screen-quiz', 'screen-end', 'h1', 'lede', 'challenge',
   'challenge-title', 'challenge-bad', 'btn-challenge', 'btn-challenge-close',
   'btn-daily', 'btn-practice', 'daily-meta', 'bank-line', 'stat-streak', 'stat-best',
   'btn-export', 'btn-import', 'file-import', 'btn-reset', 'confirm', 'btn-reset-yes',
   'btn-reset-no', 'local-status', 'q-progress', 'btn-quit', 'bar-fill', 'q-topic', 'q-text',
   'q-options', 'q-feedback', 'fb-verdict', 'fb-why', 'fb-source', 'fb-checked', 'btn-next',
   'end-kicker', 'end-score', 'end-time', 'end-note', 'end-challenge', 'btn-share',
   'btn-replay', 'btn-again', 'share-note', 'share-status', 'share-link', 'review-title',
   'review-list', 'btn-home'].forEach(function (id) { el[id] = document.getElementById(id); });

  var state = {
    lang: 'en',
    theme: 'light',
    mode: null,
    date: null,
    seed: null,
    ids: [],
    orders: [],
    i: 0,
    given: [],
    locked: false,
    started: 0,
    ended: 0,
    result: null,
    challenge: null,
    replayIds: []
  };

  function storeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function storeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode, nothing to do */ }
  }

  function storeDrop(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function langMeta(code) {
    for (var i = 0; i < LANGS.length; i += 1) {
      if (LANGS[i].code === code) { return LANGS[i]; }
    }
    return LANGS[1];
  }

  function t(key, params) {
    var dict = DICT[state.lang] || DICT.en;
    var text = dict[key];
    if (text === undefined) { text = DICT.en[key]; }
    if (text === undefined) { return key; }
    return text.replace(/\{(\w+)\}/g, function (match, name) {
      return params && params[name] !== undefined ? String(params[name]) : match;
    });
  }

  function params(extra) {
    var base = { n: N, total: TOTAL };
    if (extra) {
      Object.keys(extra).forEach(function (key) { base[key] = extra[key]; });
    }
    return base;
  }

  function formatDate(day) {
    var date = Core.parseYmd(day) || new Date();
    try {
      return new Intl.DateTimeFormat(langMeta(state.lang).intl, {
        day: 'numeric', month: 'long', year: 'numeric'
      }).format(date);
    } catch (e) {
      return day;
    }
  }

  /* ---------- preferences ---------- */

  function pickLang() {
    var saved = storeGet(KEY.lang);
    if (saved && DICT[saved]) { return saved; }
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
    for (var i = 0; i < list.length; i += 1) {
      var tag = String(list[i] || '').toLowerCase();
      if (tag.indexOf('ro') === 0) { return 'ro'; }
      if (tag.indexOf('sr') === 0) { return tag.indexOf('latn') > -1 ? 'sr-latn' : 'sr-cyrl'; }
      if (tag.indexOf('en') === 0) { return 'en'; }
    }
    return 'en';
  }

  function setTheme(theme, save) {
    state.theme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', state.theme);
    if (save) { storeSet(KEY.theme, state.theme); }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) { meta.setAttribute('content', state.theme === 'dark' ? '#0f1116' : '#f6f7f9'); }
  }

  function setLang(code, save) {
    state.lang = DICT[code] ? code : 'en';
    if (save) { storeSet(KEY.lang, state.lang); }
    var meta = langMeta(state.lang);
    document.documentElement.setAttribute('lang', meta.html);
    el.lang.value = state.lang;
    document.title = t('title');
    var desc = document.querySelector('meta[name="description"]');
    if (desc) { desc.setAttribute('content', t('metaDesc')); }
    applyStatic();
    renderChallenge();
    renderStats();
    renderStart();
    if (!el['screen-quiz'].hidden) { renderQuestion(); }
    if (!el['screen-end'].hidden) { renderEnd(); }
  }

  function applyStatic() {
    var list = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < list.length; i += 1) {
      list[i].textContent = t(list[i].getAttribute('data-i18n'), params());
    }
    var labelled = document.querySelectorAll('[data-i18n-aria-label]');
    for (var j = 0; j < labelled.length; j += 1) {
      labelled[j].setAttribute('aria-label', t(labelled[j].getAttribute('data-i18n-aria-label')));
    }
  }

  /* ---------- progress ---------- */

  function loadProgress() {
    try {
      return Core.sanitizeProgress(JSON.parse(storeGet(KEY.progress) || 'null'), N);
    } catch (e) {
      return Core.emptyProgress();
    }
  }

  function saveProgress(progress) {
    storeSet(KEY.progress, JSON.stringify(progress));
    renderStats();
    renderStart();
  }

  function renderStats() {
    var progress = loadProgress();
    var best = Core.bestOf(progress, N);
    el['stat-streak'].textContent = String(Core.streakOf(progress, Core.today(), N));
    el['stat-best'].textContent = best.s > 0
      ? t('bestValue', params({ s: best.s }))
      : t('bestValue', params({ s: 0 }));
  }

  function renderChallenge() {
    if (!state.challenge) { return; }
    el['challenge-title'].textContent = t('challengeTitle', {
      s: state.challenge.score, n: N, t: Core.formatTime(state.challenge.time)
    });
  }

  function renderStart() {
    var today = Core.today();
    shownDay = today;
    var played = loadProgress().d[today];
    var line = t('dailyOn', params({ date: formatDate(today) }));
    if (played) { line += ' · ' + t('playedToday', params({ s: played.s })); }
    el['daily-meta'].textContent = line;
    el['bank-line'].textContent = t('bankLine', params());
  }

  /* ---------- screens ---------- */

  function show(name) {
    el['screen-start'].hidden = name !== 'start';
    el['screen-quiz'].hidden = name !== 'quiz';
    el['screen-end'].hidden = name !== 'end';
  }

  function toTop() {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try { window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); }
    catch (e) { window.scrollTo(0, 0); }
  }

  /* ---------- the round ---------- */

  function start(mode, extra) {
    var ids = [];
    var seed = '';
    var date = null;

    if (mode === 'daily') {
      date = Core.today();
      seed = 'daily:' + date;
      ids = Core.pickRound(BANK.items, N, seed);
    } else if (mode === 'challenge') {
      date = state.challenge.day;
      seed = 'daily:' + date;
      ids = Core.pickRound(BANK.items, N, seed);
    } else if (mode === 'replay') {
      ids = (extra && extra.ids ? extra.ids : []).filter(function (id) { return byId[id]; });
      seed = 'replay:' + Date.now().toString(36);
    } else {
      seed = 'practice:' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2);
      ids = Core.pickRound(BANK.items, N, seed);
    }

    if (!ids.length) { return; }

    state.mode = mode;
    state.date = date;
    state.seed = seed;
    state.ids = ids;
    state.orders = Core.ordersFor(ids, seed);
    state.i = 0;
    state.given = [];
    state.locked = false;
    state.started = Date.now();
    state.ended = 0;
    state.result = null;

    show('quiz');
    renderQuestion();
    toTop();
  }

  function currentItem() { return byId[state.ids[state.i]]; }

  function sourceText(item) {
    var source = item.source;
    if (source && typeof source === "object") { return source[state.lang] || source.en; }
    return String(source || "");
  }

  function renderQuestion() {
    var item = currentItem();
    var order = state.orders[state.i];
    var total = state.ids.length;

    /* The progress bar is cut in as many segments as the round has questions. */
    el['bar-fill'].parentNode.style.setProperty('--segs', String(total));

    el['q-progress'].textContent = t('counter', { i: state.i + 1, n: total });
    el['screen-quiz'].setAttribute('aria-label', t('progressLabel', { i: state.i + 1, n: total }));
    el['q-topic'].textContent = t('topic.' + item.topic);
    el['q-text'].textContent = item.q[state.lang] || item.q.en;

    var box = el['q-options'];
    box.replaceChildren();
    order.forEach(function (optionIndex, pos) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'option';
      button.setAttribute('data-pos', String(pos));

      var key = document.createElement('span');
      key.className = 'key';
      key.setAttribute('aria-hidden', 'true');
      key.textContent = String(pos + 1);

      var label = document.createElement('span');
      label.className = 'label';
      label.textContent = item.options[optionIndex][state.lang] || item.options[optionIndex].en;

      button.append(key, label);
      button.addEventListener('click', function () { choose(pos); });
      box.appendChild(button);
    });

    var given = state.given[state.i];
    if (given) {
      state.locked = true;
      paintAnswer(given);
      showFeedback(item, given);
    } else {
      state.locked = false;
      el['q-feedback'].hidden = true;
      el['btn-next'].hidden = true;
    }

    var done = given ? state.i + 1 : state.i;
    el['bar-fill'].style.width = Math.round((done / total) * 100) + '%';
  }

  function paintAnswer(given) {
    var item = currentItem();
    var order = state.orders[state.i];
    var buttons = el['q-options'].querySelectorAll('.option');
    for (var i = 0; i < buttons.length; i += 1) {
      var pos = Number(buttons[i].getAttribute('data-pos'));
      var optionIndex = order[pos];
      buttons[i].disabled = true;
      if (optionIndex === item.correct) {
        buttons[i].classList.add('ok');
      } else if (pos === given.pos) {
        buttons[i].classList.add('bad');
      } else {
        buttons[i].classList.add('dim');
      }
      if (pos === given.pos) { buttons[i].setAttribute('aria-current', 'true'); }
    }
  }

  function showFeedback(item, given) {
    var correctText = item.options[item.correct][state.lang] || item.options[item.correct].en;
    el['fb-verdict'].textContent = given.ok ? t('correct') : t('wrong', { a: correctText });
    el['fb-verdict'].className = 'verdict ' + (given.ok ? 'ok' : 'bad');
    el['fb-why'].textContent = item.why[state.lang] || item.why.en;
    el['fb-source'].textContent = t('sourceLine', { s: sourceText(item) });
    el['fb-checked'].textContent = t('checkedLine', { d: formatDate(CHECKED) });
    el['q-feedback'].hidden = false;
    var last = state.i === state.ids.length - 1;
    el['btn-next'].textContent = last ? t('finish') : t('next');
    el['btn-next'].hidden = false;
    el['btn-next'].focus();
  }

  function choose(pos) {
    if (state.locked || !state.ids.length) { return; }
    var item = currentItem();
    var optionIndex = state.orders[state.i][pos];
    var given = { pos: pos, chosen: optionIndex, ok: optionIndex === item.correct };
    state.given[state.i] = given;
    state.locked = true;
    paintAnswer(given);
    showFeedback(item, given);
    if (state.i === state.ids.length - 1 && !state.ended) { state.ended = Date.now(); }
    el['bar-fill'].style.width = Math.round(((state.i + 1) / state.ids.length) * 100) + '%';
  }

  function nextStep() {
    if (!state.locked) { return; }
    if (state.i >= state.ids.length - 1) { finish(); return; }
    state.i += 1;
    renderQuestion();
    toTop();
    el['q-text'].focus();
  }

  function score() {
    return state.given.filter(function (g) { return g && g.ok; }).length;
  }

  function finish() {
    var secs = Math.round(((state.ended || Date.now()) - state.started) / 1000);
    var got = score();
    var wrong = [];
    state.given.forEach(function (given, index) {
      if (given && !given.ok) { wrong.push({ id: state.ids[index], chosen: given.chosen }); }
    });
    state.result = { score: got, total: state.ids.length, secs: secs, wrong: wrong, mode: state.mode, date: state.date };

    if (state.mode === 'daily' && state.date === Core.today()) {
      saveProgress(Core.recordDay(loadProgress(), state.date, got, secs, N));
    }

    show('end');
    renderEnd();
    toTop();
  }

  function renderEnd() {
    var result = state.result;
    if (!result) { return; }
    var wrongItems = result.wrong.map(function (entry) {
      var item = byId[entry.id];
      return item ? { item: item, chosen: entry.chosen } : null;
    }).filter(Boolean);

    var kicker = result.mode === 'daily' ? t('startDaily')
      : result.mode === 'challenge' ? t('challengePlay')
        : result.mode === 'replay' ? t('replayWrong') : t('startPractice');
    el['end-kicker'].textContent = kicker;

    el['end-score'].textContent = t('endScore', { s: result.score, n: result.total });
    el['end-time'].textContent = t('endTime', { t: Core.formatTime(result.secs) });
    el['end-note'].textContent = result.mode === 'daily' ? t('dailySaved') : t('noRecord');

    if (result.mode === 'challenge' && state.challenge) {
      el['end-challenge'].hidden = false;
      el['end-challenge'].replaceChildren();
      var you = document.createElement('span');
      you.textContent = t('challengeYou', { s: result.score, n: result.total });
      var them = document.createElement('span');
      them.textContent = t('challengeThem', {
        s: state.challenge.score, n: N, t: Core.formatTime(state.challenge.time)
      });
      el['end-challenge'].append(you, them);
    } else {
      el['end-challenge'].hidden = true;
      el['end-challenge'].replaceChildren();
    }

    el['btn-share'].hidden = !result.date;
    el['share-note'].hidden = !result.date;
    el['share-link'].hidden = true;
    el['share-status'].textContent = '';

    el['btn-replay'].hidden = wrongItems.length === 0;
    el['btn-again'].hidden = false;
    el['btn-home'].hidden = false;

    var list = el['review-list'];
    list.replaceChildren();
    if (!wrongItems.length) {
      var empty = document.createElement('li');
      empty.className = 'review-empty';
      empty.textContent = t('reviewNone');
      list.appendChild(empty);
      return;
    }
    wrongItems.forEach(function (entry) {
      var item = entry.item;
      var row = document.createElement('li');

      var question = document.createElement('p');
      question.className = 'review-q';
      question.textContent = item.q[state.lang] || item.q.en;

      var mine = document.createElement('p');
      mine.className = 'review-line';
      mine.textContent = t('yourAnswer', { a: item.options[entry.chosen][state.lang] || item.options[entry.chosen].en });

      var right = document.createElement('p');
      right.className = 'review-line review-right';
      right.textContent = t('rightAnswer', { a: item.options[item.correct][state.lang] || item.options[item.correct].en });

      var why = document.createElement('p');
      why.className = 'review-why';
      why.textContent = item.why[state.lang] || item.why.en;

      var src = document.createElement('p');
      src.className = 'review-src';
      src.textContent = t('sourceLine', { s: sourceText(item) }) + ' · ' + t('checkedLine', { d: formatDate(CHECKED) });

      row.append(question, mine, right, why, src);
      list.appendChild(row);
    });
  }

  function share() {
    if (!state.result || !state.result.date) { return; }
    var url = Core.challengeUrl(location.href, state.result.date, state.result.score, state.result.secs);
    el['share-link'].value = url;
    var done = function (ok) {
      if (ok) {
        el['share-status'].textContent = t('copied');
        el['share-link'].hidden = true;
      } else {
        el['share-status'].textContent = t('copyFail');
        el['share-link'].hidden = false;
        el['share-link'].select();
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); });
    } else {
      done(false);
    }
  }

  /* ---------- export, import, reset ---------- */

  function exportProgress() {
    var payload = {
      app: 'Quiz-Deck',
      v: 1,
      exported: Core.today(),
      lang: state.lang,
      theme: state.theme,
      progress: loadProgress()
    };
    var blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'quiz-deck-' + Core.today() + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function importProgress(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data = null;
      try { data = JSON.parse(String(reader.result)); } catch (e) { data = null; }
      var incoming = data && data.progress ? data.progress : data;
      if (!incoming || typeof incoming !== 'object' || !incoming.d || typeof incoming.d !== 'object') {
        el['local-status'].textContent = t('importBad');
        return;
      }
      var merged = Core.mergeProgress(loadProgress(), incoming, N);
      saveProgress(merged);
      el['local-status'].textContent = t('importOk');
    };
    reader.onerror = function () { el['local-status'].textContent = t('importBad'); };
    reader.readAsText(file);
  }

  /* ---------- wiring ---------- */

  function wire() {
    el.lang.replaceChildren();
    LANGS.forEach(function (meta) {
      var option = document.createElement('option');
      option.value = meta.code;
      option.textContent = meta.label;
      el.lang.appendChild(option);
    });

    el.lang.addEventListener('change', function () { setLang(el.lang.value, true); });

    el.theme.addEventListener('click', function () {
      setTheme(state.theme === 'dark' ? 'light' : 'dark', true);
    });

    el['btn-daily'].addEventListener('click', function () { start('daily'); });
    el['btn-practice'].addEventListener('click', function () { start('practice'); });
    el['btn-challenge'].addEventListener('click', function () { start('challenge'); });
    el['btn-challenge-close'].addEventListener('click', function () {
      el.challenge.hidden = true;
      if (history.replaceState) { history.replaceState(null, '', location.pathname + location.hash); }
    });

    el['btn-next'].addEventListener('click', nextStep);
    el['btn-quit'].addEventListener('click', function () {
      show('start');
      renderStats();
      toTop();
    });

    el['btn-share'].addEventListener('click', share);
    el['btn-replay'].addEventListener('click', function () {
      if (state.result && state.result.wrong.length) {
        start('replay', { ids: state.result.wrong.map(function (entry) { return entry.id; }) });
      }
    });
    el['btn-again'].addEventListener('click', function () { start('practice'); });
    el['btn-home'].addEventListener('click', function () { show('start'); renderStats(); toTop(); });

    el['btn-export'].addEventListener('click', exportProgress);
    el['btn-import'].addEventListener('click', function () { el['file-import'].click(); });
    el['file-import'].addEventListener('change', function () {
      var file = el['file-import'].files && el['file-import'].files[0];
      if (file) { importProgress(file); }
      el['file-import'].value = '';
    });

    el['btn-reset'].addEventListener('click', function () { el.confirm.hidden = false; });
    el['btn-reset-no'].addEventListener('click', function () { el.confirm.hidden = true; });
    el['btn-reset-yes'].addEventListener('click', function () {
      storeDrop(KEY.progress);
      el.confirm.hidden = true;
      el['local-status'].textContent = t('resetDone');
      renderStats();
      renderStart();
    });

    document.addEventListener('keydown', function (event) {
      if (event.ctrlKey || event.metaKey || event.altKey) { return; }
      var tag = (event.target && event.target.tagName) || '';
      if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') { return; }
      if (el['screen-quiz'].hidden) { return; }
      if (!state.locked && event.key >= '1' && event.key <= '4') {
        var pos = Number(event.key) - 1;
        if (pos < state.orders[state.i].length) { event.preventDefault(); choose(pos); }
        return;
      }
      if (state.locked && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        nextStep();
      }
    });
  }

  function boot() {
    setTheme(storeGet(KEY.theme) || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'), false);

    var challenge = Core.parseChallenge(location.search || '');
    if (challenge && challenge.score <= N) {
      state.challenge = challenge;
      el.challenge.hidden = false;
    } else if ((location.search || '').indexOf('d=') > -1) {
      el['challenge-bad'].hidden = false;
    }

    wire();
    setLang(pickLang(), false);
    renderStart();
    show('start');
    renderStats();

    /* A tab left open overnight would keep yesterday's date, and the round under
       it. When the page comes back, the day is read again from the clock. */
    function checkDay() {
      if (Core.today() === shownDay) { return; }
      renderStart();
      renderStats();
    }
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { checkDay(); }
    });
    window.addEventListener('focus', checkDay);

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline copy simply stays as it is */ });
    }
  }

  boot();
}());
