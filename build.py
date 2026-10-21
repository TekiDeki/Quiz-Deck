#!/usr/bin/env python3
# Quiz-Deck - TekiDeki
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Kristian Mario Miskovic (TekiDeki)
"""Build a single self contained index.html.

Deterministic by design: the same sources always give byte identical output,
with no timestamps, no dictionary ordering surprises and no machine paths.

The fourth locale, Serbian Cyrillic, is never written by hand: it is produced
here by transliterating the Serbian Latin strings. The question bank follows
the same rule, so a fact is authored once and read in four scripts.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
TEMPLATE = SRC / "template.html"
STYLES = SRC / "styles.css"
CORE_JS = SRC / "core.js"
APP_JS = SRC / "app.js"
LOCALES = SRC / "i18n" / "locales.json"
BANK = SRC / "bank" / "items.json"
OUT = ROOT / "index.html"

AUTHORED = ("en", "ro", "sr-latn")
ALL_LOCALES = ("en", "ro", "sr-latn", "sr-cyrl")
QUESTIONS_PER_ROUND = 12

# Terms that stay in Latin script inside the Cyrillic locale.
KEEP_LATIN = ("TekiDeki", "GitHub", "freehtml.dev", "HTML", "JSON", "Quiz-Deck", "localStorage")

NON_SERBIAN = set("qwxy")
DIGRAPHS = {"lj": "љ", "nj": "њ", "dž": "џ"}
LETTERS = {
    "a": "а", "b": "б", "c": "ц", "č": "ч", "ć": "ћ", "d": "д", "đ": "ђ",
    "e": "е", "f": "ф", "g": "г", "h": "х", "i": "и", "j": "ј", "k": "к",
    "l": "л", "m": "м", "n": "н", "o": "о", "p": "п", "r": "р", "s": "с",
    "š": "ш", "t": "т", "u": "у", "v": "в", "z": "з", "ž": "ж",
}

PLACEHOLDER_RE = re.compile(r"\{[a-zA-Z]+\}")
TOKEN_RE = re.compile(r"[A-Za-z\u00c0-\u024f]+(?:[-'\u2019][A-Za-z\u00c0-\u024f]+)*")
FORBIDDEN = {"\u2013": "en dash", "\u2014": "em dash", "\u00a0": "no-break space"}


class BuildError(SystemExit):
    pass


def fail(message: str) -> None:
    raise BuildError("build failed: " + message)


def read(path: Path) -> str:
    data = path.read_bytes()
    if data.startswith(b"\xef\xbb\xbf"):
        fail(f"{path.name} starts with a byte order mark")
    return data.decode("utf-8")


def check_text(name: str, text: str) -> None:
    for char, label in FORBIDDEN.items():
        if char in text:
            line = text[: text.index(char)].count("\n") + 1
            fail(f"{name} contains a {label} on line {line}")
    if "\ufffd" in text:
        fail(f"{name} contains a replacement character")


def transliterate_plain(text: str) -> str:
    out: list[str] = []
    index = 0
    lowered = text.lower()
    while index < len(text):
        pair = lowered[index: index + 2]
        if pair in DIGRAPHS:
            cyr = DIGRAPHS[pair]
            out.append(cyr.upper() if text[index].isupper() else cyr)
            index += 2
            continue
        char = text[index]
        lower = char.lower()
        if lower in LETTERS:
            cyr = LETTERS[lower]
            out.append(cyr.upper() if char.isupper() else cyr)
        else:
            out.append(char)
        index += 1
    return "".join(out)


def transliterate(text: str) -> str:
    """Serbian Latin to Cyrillic, leaving placeholders, kept terms and
    foreign words (the ones carrying q, w, x or y) alone."""
    if not text:
        return text

    protected: list[str] = []

    def keep(value: str) -> str:
        protected.append(value)
        return f"\x00{len(protected) - 1}\x00"

    work = PLACEHOLDER_RE.sub(lambda match: keep(match.group(0)), text)
    for term in sorted(KEEP_LATIN, key=len, reverse=True):
        work = work.replace(term, keep(term))

    pieces: list[str] = []
    position = 0
    for match in TOKEN_RE.finditer(work):
        pieces.append(transliterate_plain(work[position: match.start()]))
        token = match.group(0)
        if set(token.lower()) & NON_SERBIAN:
            pieces.append(token)
        else:
            pieces.append(transliterate_plain(token))
        position = match.end()
    pieces.append(transliterate_plain(work[position:]))

    result = "".join(pieces)
    for index, value in enumerate(protected):
        result = result.replace(f"\x00{index}\x00", value)
    return result


def latin_leftovers(text: str) -> set[str]:
    """Latin letters that survived in a Cyrillic string although no rule allows them."""
    work = PLACEHOLDER_RE.sub(" ", text)
    for term in sorted(KEEP_LATIN, key=len, reverse=True):
        work = work.replace(term, " ")
    for match in TOKEN_RE.finditer(work):
        token = match.group(0)
        if set(token.lower()) & NON_SERBIAN:
            work = work.replace(token, " ")
    return {char for char in work if char.isascii() and char.isalpha()}


def load_locales() -> dict[str, dict[str, str]]:
    try:
        data = json.loads(read(LOCALES))
    except json.JSONDecodeError as error:
        fail(f"locales.json is not valid JSON: {error}")
    for locale in AUTHORED:
        if locale not in data:
            fail(f"locales.json is missing the {locale} block")
    reference = set(data["en"])
    for locale in AUTHORED:
        if set(data[locale]) != reference:
            missing = sorted(reference - set(data[locale]))
            extra = sorted(set(data[locale]) - reference)
            fail(f"locales.json: {locale} key set differs (missing {missing[:6]}, extra {extra[:6]})")

    placeholders = lambda value: frozenset(PLACEHOLDER_RE.findall(value))
    for key in reference:
        expected = placeholders(data["en"][key])
        for locale in AUTHORED:
            if placeholders(data[locale][key]) != expected:
                fail(f"locales.json: placeholder mismatch for {key} in {locale}")

    data["sr-cyrl"] = {key: transliterate(data["sr-latn"][key]) for key in data["sr-latn"]}
    for locale in ALL_LOCALES:
        for key, value in data[locale].items():
            if not isinstance(value, str) or not value.strip():
                fail(f"locales.json: empty or non string value for {key} in {locale}")
            check_text(f"locales.json {locale}.{key}", value)
    for key, value in data["sr-cyrl"].items():
        bad = latin_leftovers(value)
        if bad:
            fail(f"locales.json: sr-cyrl.{key} still has Latin letters {sorted(bad)}: {value}")
    return data


def load_bank(locales: dict[str, dict[str, str]]) -> dict:
    try:
        data = json.loads(read(BANK))
    except json.JSONDecodeError as error:
        fail(f"items.json is not valid JSON: {error}")
    items = data.get("items")
    if not isinstance(items, list) or not items:
        fail("items.json has no items")
    checked = data.get("checked", "")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(checked)):
        fail("items.json needs a checked date written as YYYY-MM-DD")

    seen_ids: set[str] = set()
    seen_questions: dict[str, str] = {}
    topics = sorted({key.split(".", 1)[1] for key in locales["en"] if key.startswith("topic.")})

    for item in items:
        qid = item.get("id", "")
        if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", qid):
            fail(f"bad question id: {qid!r}")
        if qid in seen_ids:
            fail(f"duplicate question id: {qid}")
        seen_ids.add(qid)
        if item.get("topic") not in topics:
            fail(f"{qid}: unknown topic {item.get('topic')!r}")
        options = item.get("options")
        if not isinstance(options, list) or len(options) != 4:
            fail(f"{qid}: needs exactly four options")
        correct = item.get("correct")
        if not isinstance(correct, int) or not 0 <= correct < 4:
            fail(f"{qid}: correct must be 0, 1, 2 or 3")
        source = item.get("source", "")
        if isinstance(source, dict):
            for locale in AUTHORED:
                if not isinstance(source.get(locale), str) or not source[locale].strip():
                    fail(f"{qid}: the source is missing in {locale}")
            source["sr-cyrl"] = transliterate(source["sr-latn"])
        elif isinstance(source, str) and source.strip():
            if source.startswith("@"):
                key = source[1:]
                if key not in locales["en"]:
                    fail(f"{qid}: unknown source key {key}")
                source = {locale: locales[locale][key] for locale in ALL_LOCALES}
        else:
            fail(f"{qid}: no source")
        item["source"] = source
        for value in item["source"].values() if isinstance(source, dict) else [source]:
            check_text(f"{qid} source", value)
        if isinstance(source, dict) and latin_leftovers(source["sr-cyrl"]):
            fail(f"{qid}: Latin letters left in the Cyrillic source")

        for locale in AUTHORED:
            question = item.get("q", {}).get(locale, "")
            if not question.strip():
                fail(f"{qid}: empty question in {locale}")
            if not item.get("why", {}).get(locale, "").strip():
                fail(f"{qid}: empty explanation in {locale}")
            texts = [option.get(locale, "") for option in options]
            if any(not text.strip() for text in texts):
                fail(f"{qid}: an option is empty in {locale}")
            if len({text.strip().lower() for text in texts}) != 4:
                fail(f"{qid}: options repeat in {locale}")
            if locale == "en":
                if question.strip().lower() in seen_questions:
                    fail(f"{qid}: same question text as {seen_questions[question.strip().lower()]}")
                seen_questions[question.strip().lower()] = qid

            check_text(f"{qid} {locale} question", question)
            check_text(f"{qid} {locale} explanation", item["why"][locale])
            for text in texts:
                check_text(f"{qid} {locale} option", text)

        item["q"]["sr-cyrl"] = transliterate(item["q"]["sr-latn"])
        item["why"]["sr-cyrl"] = transliterate(item["why"]["sr-latn"])
        for option in options:
            option["sr-cyrl"] = transliterate(option["sr-latn"])

        for text in [item["q"]["sr-cyrl"], item["why"]["sr-cyrl"]] + [o["sr-cyrl"] for o in options]:
            bad = latin_leftovers(text)
            if bad:
                fail(f"{qid}: Latin letters left in the Cyrillic text {sorted(bad)}: {text}")

        item["checked"] = checked

    return {"version": 1, "checked": checked, "items": items}


def bundle() -> str:
    locales = load_locales()
    bank = load_bank(locales)
    compact = lambda value: json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return (
        "/* Generated by build.py. Do not edit. */\n"
        "window.TD_LOCALES = " + compact(locales) + ";\n"
        "window.TD_BANK = " + compact(bank) + ";\n"
        "window.TD_N = " + str(QUESTIONS_PER_ROUND) + ";\n"
    ), locales, bank


def main() -> None:
    template = read(TEMPLATE)
    styles = read(STYLES)
    core_js = read(CORE_JS)
    app_js = read(APP_JS)

    for name, text in (("template.html", template), ("styles.css", styles),
                       ("core.js", core_js), ("app.js", app_js)):
        check_text(name, text)

    for name, text in (("core.js", core_js), ("app.js", app_js)):
        if "</script" in text.lower():
            fail(f"{name} contains a literal closing script tag")

    data_js, locales, bank = bundle()
    if "</script" in data_js.lower():
        fail("the data bundle contains a literal closing script tag")

    used = set(re.findall(r'data-i18n(?:-title|-aria-label|-placeholder)?="([^"]+)"', template))
    used |= set(re.findall(r"\bt\('([A-Za-z0-9_.]+)'", app_js))
    used |= set(re.findall(r'"@([A-Za-z0-9_.]+)"', read(BANK)))
    if "t('topic.' +" in app_js:
        used |= {key for key in locales["en"] if key.startswith("topic.")}
    used = {key for key in used if not key.endswith(".")}
    missing = sorted(key for key in used if key not in locales["en"])
    if missing:
        fail(f"template or app uses unknown keys: {missing}")
    unused = sorted(key for key in locales["en"] if key not in used)
    if unused:
        fail(f"locales.json has strings nothing reads: {unused}")

    html = template
    style_tag = '<link rel="stylesheet" href="styles.css">'
    if style_tag not in html:
        fail("template is missing the stylesheet link")
    html = html.replace(style_tag, "<style>\n" + styles.rstrip() + "\n</style>", 1)

    for src, body in (
        ('<script src="data.js"></script>', data_js),
        ('<script src="core.js"></script>', core_js),
        ('<script src="app.js"></script>', app_js),
    ):
        if src not in html:
            fail(f"template is missing {src}")
        html = html.replace(src, "<script>\n" + body.rstrip() + "\n</script>", 1)

    html = html.replace("</body>", "<!-- Quiz-Deck · single file build · bank checked " + bank["checked"] + " -->\n</body>", 1)

    check_text("index.html", html)

    if '<link rel="stylesheet"' in html or re.search(r'<script src="(?!https://)', html):
        fail("index.html still references a local asset")
    if not html.startswith("<!DOCTYPE html>"):
        fail("index.html must start with the doctype")

    OUT.write_text(html, encoding="utf-8")

    size = len(html.encode("utf-8"))
    topics: dict[str, int] = {}
    for item in bank["items"]:
        topics[item["topic"]] = topics.get(item["topic"], 0) + 1
    print(f"index.html written, {size} bytes, {size / 1024:.1f} KiB")
    print(f"questions: {len(bank['items'])} in {QUESTIONS_PER_ROUND} per round, "
          + ", ".join(f"{name} {count}" for name, count in sorted(topics.items())))
    print(f"interface strings: {len(locales['en'])} keys in {', '.join(ALL_LOCALES)}")
    print(f"bank checked: {bank['checked']}")


if __name__ == "__main__":
    main()
