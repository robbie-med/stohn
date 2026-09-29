#!/usr/bin/env python3
"""Rebuild the bundled WOFF2 subsets in fonts/ (needs fonttools + brotli).

Sources (SIL OFL 1.1) from github.com/google/fonts:
  ofl/fraunces/Fraunces[SOFT,WONK,opsz,wght].ttf
  ofl/gowunbatang/GowunBatang-{Regular,Bold}.ttf

Usage: scripts/build-fonts.py <dir-with-source-ttfs>

- Fraunces keeps all variable axes, subset to Latin + the punctuation we use.
  It has no Cyrillic: add a Cyrillic-capable face before shipping ru.
- Gowun Batang Regular: the 2,350 common KS X 1001 syllables, so anything a
  user types in Korean usually renders in the same face (~190 KB).
- Gowun Batang Bold: only syllables that appear in locales/ko.json (UI only).
Re-run after changing ko.json so new bold syllables are included.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "fonts")
LATIN = ("U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+2013-2014,"
         "U+2018-201A,U+201C-201E,U+2022,U+2026,U+2032-2033,U+2039-203A,U+2044,U+20AC,"
         "U+2122,U+2190-2193,U+2212,U+2264-2265,U+2713")
JAMO = "".join(chr(c) for c in range(0x3131, 0x318F))


def subset(src, out, text=None, unicodes=None):
    args = [sys.executable, "-m", "fontTools.subset", src, f"--output-file={out}",
            "--flavor=woff2", "--layout-features=*", "--no-hinting", "--desubroutinize"]
    if unicodes:
        args.append(f"--unicodes={unicodes}")
    if text:
        args.append(f"--text={text}")
    subprocess.run(args, check=True)
    print(f"{os.path.relpath(out, ROOT)}: {os.path.getsize(out) // 1024} KB")


def main(src_dir):
    ko = open(os.path.join(ROOT, "locales", "ko.json"), encoding="utf8").read()
    used = "".join(sorted({c for c in ko if 0xAC00 <= ord(c) <= 0xD7A3}))
    common = "".join(chr(c) for c in range(0xAC00, 0xD7A4) if len(chr(c).encode("euc-kr")) == 2)
    subset(os.path.join(src_dir, "Fraunces[SOFT,WONK,opsz,wght].ttf"), os.path.join(OUT, "fraunces-latin.woff2"), unicodes=LATIN)
    subset(os.path.join(src_dir, "GowunBatang-Regular.ttf"), os.path.join(OUT, "gowun-batang-400.woff2"), text=common + used + JAMO)
    subset(os.path.join(src_dir, "GowunBatang-Bold.ttf"), os.path.join(OUT, "gowun-batang-700.woff2"), text=used + JAMO)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
