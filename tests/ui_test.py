#!/usr/bin/env python3
"""Quiz-Deck · browser tests. Run with: python3 tests/ui_test.py

The page is served from a local folder, so a request that leaves the origin is
a failure, not a curiosity. Every round is played the way a person plays it:
the test looks up the right answer in the bank, clicks that button and then
reads what the page says.
"""

from __future__ import annotations

import functools
import http.server
import json
import socketserver
import sys
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "screenshots"

CHECKS = 0


def check(condition: bool, label: str) -> None:
    global CHECKS
    CHECKS += 1
    if not condition:
        raise AssertionError(label)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):  # noqa: D401 - silence the server
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


def serve() -> tuple[Server, str]:
    handler = functools.partial(Quiet, directory=str(ROOT))
    server = Server(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


FIND_CORRECT = """
() => {
  const map = { 'ro': 'ro', 'en': 'en', 'sr-Latn': 'sr-latn', 'sr-Cyrl': 'sr-cyrl' };
  const lang = map[document.documentElement.lang] || 'en';
  const question = document.getElementById('q-text').textContent.trim();
  const item = window.TD_BANK.items.find((entry) => entry.q[lang] === question);
  if (!item) { return null; }
  return { text: item.options[item.correct][lang], id: item.id, lang: lang };
}
"""


def answer(page, right: bool = True) -> str:
    """Click one option. With right=False the first wrong one is chosen."""
    info = page.evaluate(FIND_CORRECT)
    assert info, "the question on screen exists in the bank"
    labels = page.eval_on_selector_all("#q-options .option .label", "els => els.map((e) => e.textContent)")
    index = labels.index(info["text"])
    if not right:
        index = 0 if index != 0 else 1
    page.locator("#q-options .option").nth(index).click()
    page.wait_for_selector("#q-feedback:not([hidden])")
    return info["text"]


def play_round(page, wrong_first: bool = False) -> None:
    total = page.eval_on_selector_all("#q-options .option", "els => els.length")
    check(total == 4, "four options on screen")
    for step in range(12):
        answer(page, right=not (wrong_first and step == 0))
        if step < 11:
            page.click("#btn-next")
            page.wait_for_selector("#q-feedback[hidden]", state="attached")
    page.click("#btn-next")
    page.wait_for_selector("#screen-end:not([hidden])")


def storage(page, key: str):
    raw = page.evaluate("(key) => localStorage.getItem(key)", key)
    return json.loads(raw) if raw else None


def main() -> int:
    server, base = serve()
    foreign: list[str] = []
    console: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch()

        context = browser.new_context(viewport={"width": 1280, "height": 900}, locale="ro-RO")
        page = context.new_page()
        page.on("console", lambda message: console.append(message.text) if message.type == "error" else None)
        page.on("request", lambda request: foreign.append(request.url) if not request.url.startswith(base) else None)

        page.goto(base + "/index.html", wait_until="networkidle")

        # --- the first screen -------------------------------------------------
        check("Quiz-Deck" in page.title(), "the title names the app")
        check(page.inner_text("h1") == "Întrebări scurte, răspunsuri verificate", "the heading follows the browser language")
        check(page.evaluate("document.documentElement.lang") == "ro", "the page declares Romanian")
        check(page.is_visible("#btn-daily"), "the daily round can be started")
        check(page.is_visible("#btn-practice"), "practice can be started")
        check(page.is_hidden("#screen-quiz"), "the quiz stays hidden until a round starts")
        check("localStorage" in page.inner_text("#screen-start"), "the warning about localStorage is on the page")
        check("se pierd" in page.inner_text("#screen-start"), "the warning says the data can be lost")
        check("12" in page.inner_text("#btn-daily"), "the daily card states the round length")
        check(page.inner_text("#stat-streak") == "0", "a fresh browser starts with no streak")
        check(page.inner_text("#stat-best") == "0 din 12", "a fresh browser starts with no record")
        check(page.locator("#lang option").count() == 4, "four languages in the switch")
        check(page.eval_on_selector_all("#lang option", "els => els.map((e) => e.value)") ==
              ["ro", "en", "sr-latn", "sr-cyrl"], "the four expected locales")

        check(page.locator(".foot .support a").get_attribute("href") == "https://paypal.me/TekiDeki",
              "the footer links to the support page")
        check("gratuite" in page.inner_text(".foot .support"),
              "the support link sits next to the sentence that the tools are free")
        check(page.inner_text(".foot .support a") == "Susține munca", "the support link is in Romanian")

        page.screenshot(path=str(SHOTS / "desktop.png"))

        # --- a full daily round ----------------------------------------------
        page.click("#btn-daily")
        page.wait_for_selector("#q-options .option")
        check("1 din 12" in page.inner_text("#q-progress"), "the counter starts at one")

        question = page.inner_text("#q-text")
        check(len(question) > 10, "the first question arrived")
        check(page.inner_text("#q-topic") != "", "the subject is shown")

        answer(page, right=True)
        check(page.inner_text("#fb-verdict").strip() == "Corect.", "a right answer is called right")
        check("Sursă:" in page.inner_text("#fb-source"), "the source is printed after the answer")
        check("Verificat:" in page.inner_text("#fb-checked"), "the date of the check is printed too")
        check(len(page.inner_text("#fb-why")) > 20, "the explanation is printed")
        check(page.is_visible("#btn-next"), "the next button appears after answering")
        check(page.eval_on_selector_all("#q-options .option[disabled]", "els => els.length") == 4,
              "the options lock once one is picked")

        page.click("#btn-next")
        page.wait_for_selector("#q-feedback[hidden]", state="attached")
        check("2 din 12" in page.inner_text("#q-progress"), "the counter moves on")

        # the rest of the round, by keyboard
        for step in range(1, 12):
            info = page.evaluate(FIND_CORRECT)
            labels = page.eval_on_selector_all("#q-options .option .label", "els => els.map((e) => e.textContent)")
            page.keyboard.press(str(labels.index(info["text"]) + 1))
            page.wait_for_selector("#q-feedback:not([hidden])")
            page.keyboard.press("Enter")
            if step < 11:
                page.wait_for_selector("#q-feedback[hidden]", state="attached")

        page.wait_for_selector("#screen-end:not([hidden])")
        check(page.inner_text("#end-score") == "12 din 12", "a clean round scores twelve")
        check("Timp:" in page.inner_text("#end-time"), "the time is reported")
        check(page.inner_text("#end-note") == "Runda de azi a fost notată.", "the daily round says it was recorded")
        check("Fără greșeli." in page.inner_text("#review-list"), "no mistakes, nothing to review")
        check(page.is_visible("#btn-share"), "the daily round can be shared")
        check(page.is_hidden("#btn-replay"), "no replay of mistakes when there are none")
        gap = page.evaluate("""() => {
          const list = document.getElementById('review-list').getBoundingClientRect();
          const home = document.getElementById('btn-home').getBoundingClientRect();
          return Math.round(home.top - list.bottom);
        }""")
        check(gap >= 16, "the button under the review keeps its distance (gap %d px)" % gap)

        saved = storage(page, "quiz-deck:progress")
        today = page.evaluate("() => window.QuizDeck.today()")
        check(saved is not None and today in saved["d"], "the day landed in localStorage")
        check(saved["d"][today]["s"] == 12, "the stored score is twelve")
        check(saved["best"]["s"] == 12, "the record follows")

        page.click("#btn-home")
        page.wait_for_selector("#screen-start:not([hidden])")
        check(page.inner_text("#stat-streak") == "1", "the streak counts today")
        check(page.inner_text("#stat-best") == "12 din 12", "the record is on the start screen")

        # --- the challenge link ----------------------------------------------
        link = page.evaluate(
            "() => window.QuizDeck.challengeUrl(location.href, window.QuizDeck.shiftDay(window.QuizDeck.today(), -1), 9, 107)"
        )
        page.goto(link, wait_until="networkidle")
        check(page.is_visible("#challenge"), "the challenge banner shows")
        check("9 din 12" in page.inner_text("#challenge-title"), "the banner carries the score")
        check("1:47" in page.inner_text("#challenge-title"), "the banner carries the time")
        page.click("#btn-challenge")
        page.wait_for_selector("#q-options .option")

        info = page.evaluate(FIND_CORRECT)
        labels = page.eval_on_selector_all("#q-options .option .label", "els => els.map((e) => e.textContent)")
        page.locator("#q-options .option").nth(labels.index(info["text"])).click()
        page.wait_for_selector("#q-feedback:not([hidden])")
        check("Nu." in page.inner_text("#fb-verdict") or "Corect." in page.inner_text("#fb-verdict"),
              "an answer is judged")
        page.mouse.move(4, 4)
        page.wait_for_timeout(250)
        page.screenshot(path=str(SHOTS / "round.png"))

        # --- practice, in the dark -------------------------------------------
        context2 = browser.new_context(viewport={"width": 390, "height": 844}, locale="en-US")
        page2 = context2.new_page()
        page2.on("console", lambda message: console.append(message.text) if message.type == "error" else None)
        page2.on("request", lambda request: foreign.append(request.url) if not request.url.startswith(base) else None)
        page2.goto(base + "/index.html", wait_until="networkidle")

        check(page2.evaluate("document.documentElement.lang") == "en", "an English browser gets English")
        check(page2.inner_text("h1") == "Short questions, checked answers", "the English heading")
        check(page2.inner_text(".foot .support a") == "Support the work", "the support link is in English")
        check("stay free" in page2.inner_text(".foot .support"), "the English sentence says the tools stay free")
        check(page2.evaluate("document.documentElement.dataset.theme") == "light", "light by default")

        page2.click("#theme")
        check(page2.evaluate("document.documentElement.dataset.theme") == "dark", "the theme button turns the page dark")
        check(page2.evaluate("() => localStorage.getItem('quiz-deck:theme')") == "dark", "the theme is remembered")
        page2.reload(wait_until="networkidle")
        check(page2.evaluate("document.documentElement.dataset.theme") == "dark", "a reload stays dark")
        page2.screenshot(path=str(SHOTS / "mobile-dark.png"))

        page2.click("#btn-practice")
        page2.wait_for_selector("#q-options .option")
        answer(page2, right=False)
        check(page2.inner_text("#fb-verdict").startswith("Not this one."), "a wrong answer says so and gives the right one")
        for _ in range(11):
            page2.click("#btn-next")
            page2.wait_for_selector("#q-feedback[hidden]", state="attached")
            answer(page2, right=True)
        page2.click("#btn-next")
        page2.wait_for_selector("#screen-end:not([hidden])")
        check(page2.inner_text("#end-score") == "11 of 12", "practice counts the one wrong answer")
        check("does not enter the streak" in page2.inner_text("#end-note"), "practice says it is not recorded")
        check("Where it went wrong" in page2.inner_text(".review"), "the mistakes are listed")
        check(storage(page2, "quiz-deck:progress") is None, "practice writes nothing to the record")

        # --- export, import, reset -------------------------------------------
        page2.click("#btn-home")
        page2.wait_for_selector("#screen-start:not([hidden])")
        check(page2.inner_text("#stat-streak") == "0", "practice left the streak alone")

        with page2.expect_download() as download:
            page2.click("#btn-export")
        exported = json.loads(Path(download.value.path()).read_text(encoding="utf-8"))
        check(exported["app"] == "Quiz-Deck", "the export names the app")
        check("progress" in exported and "d" in exported["progress"], "the export carries the progress")

        sample = Path(tempfile.mkdtemp()) / "sample-progress.json"
        sample.write_text(json.dumps({"app": "Quiz-Deck", "v": 1, "progress": {
            "d": {"2026-10-20": {"s": 8, "t": 140}, "2026-10-19": {"s": 7, "t": 150}},
            "best": {"s": 8, "t": 140}
        }}), encoding="utf-8")
        page2.set_input_files("#file-import", str(sample))
        page2.wait_for_function("() => document.getElementById('local-status').textContent.trim() !== ''")
        check(page2.inner_text("#local-status") == "The progress was read.", "the import answers")
        imported = storage(page2, "quiz-deck:progress")
        check("2026-10-20" in imported["d"], "the imported days are kept")
        check(imported["best"]["s"] == 8, "the imported record is kept")

        page2.click("#btn-reset")
        check(page2.is_visible("#confirm"), "the reset asks first")
        page2.click("#btn-reset-yes")
        check(storage(page2, "quiz-deck:progress") is None, "the reset empties the progress")
        check(page2.inner_text("#stat-best") == "0 of 12", "the start screen follows the reset")

        # --- a friendlier link is refused ------------------------------------
        page2.goto(base + "/index.html?d=2026-02-30&s=9&t=100", wait_until="networkidle")
        check(page2.is_visible("#challenge-bad"), "a broken challenge is called out")

        # --- the fourth script ------------------------------------------------
        page2.select_option("#lang", "sr-cyrl")
        check(page2.evaluate("document.documentElement.lang") == "sr-Cyrl", "the Cyrillic locale is declared")
        check(page2.inner_text("h1") == "Кратка питања, проверени одговори", "the heading is in Cyrillic")
        check(page2.inner_text("#btn-daily").startswith("Данашња рунда"), "the buttons are in Cyrillic")
        check(page2.inner_text(".foot .support a") == "Подржи рад", "the support link is in Cyrillic")
        check("бесплатни" in page2.inner_text(".foot .support"), "the Cyrillic sentence says the tools are free")

        page2.select_option("#lang", "sr-latn")
        page2.click("#btn-practice")
        page2.wait_for_selector("#q-options .option")
        cyrillic = page2.evaluate("""() => {
          const q = document.getElementById('q-text').textContent;
          return { latin: /[A-Za-z]/.test(q), text: q };
        }""")
        check(cyrillic["latin"], "the Latin script is used for Serbian Latin")
        check(page2.inner_text(".foot .support a") == "Podrži rad", "the support link is in Serbian Latin")
        page2.select_option("#lang", "sr-cyrl")
        cyrillic = page2.evaluate("""() => {
          const q = document.getElementById('q-text').textContent;
          return { cyr: /[\\u0400-\\u04ff]/.test(q), latin: /[A-Za-z]/.test(q.replace(/aqua|penny-farthing/gi, '')), text: q };
        }""")
        check(cyrillic["cyr"] and not cyrillic["latin"], "the same question turns to Cyrillic")

        # --- every question, in every language -------------------------------
        report = page2.evaluate("""() => {
          const langs = ['en', 'ro', 'sr-latn', 'sr-cyrl'];
          const bad = [];
          for (const item of window.TD_BANK.items) {
            for (const lang of langs) {
              if (!item.q[lang] || !item.why[lang]) { bad.push(item.id + ' ' + lang); }
              for (const option of item.options) {
                if (!option[lang]) { bad.push(item.id + ' option ' + lang); }
              }
            }
          }
          return { bad: bad.slice(0, 5), total: window.TD_BANK.items.length };
        }""")
        check(report["bad"] == [], "every question is complete in four languages")
        check(report["total"] >= 60, "the bank is deep enough for the daily round")

        # --- offline ----------------------------------------------------------
        page3 = browser.new_context(locale="ro-RO").new_page()
        page3.goto(base + "/index.html", wait_until="networkidle")
        page3.evaluate("() => navigator.serviceWorker.ready.then(() => true)")
        page3.wait_for_timeout(600)
        page3.close()
        offline = browser.new_context(locale="ro-RO")
        page3 = offline.new_page()
        page3.goto(base + "/index.html", wait_until="networkidle")
        page3.evaluate("() => navigator.serviceWorker.ready.then(() => true)")
        offline.set_offline(True)
        page3.reload(wait_until="domcontentloaded")
        check(page3.is_visible("h1"), "the page still opens with the network off")

        browser.close()

    server.shutdown()

    check(console == [], f"no console errors: {console[:3]}")
    check(foreign == [], f"no request left the origin: {foreign[:3]}")

    print(f"ui tests: {CHECKS} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
