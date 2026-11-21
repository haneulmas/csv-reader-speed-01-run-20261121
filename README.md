# Fast CSV Reader

[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/haneulmas/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/haneulmas/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for [csv-reader 1.0.0](https://make.fun/bounty/csv-reader-speed-01-run-20261121), make.fun's own reference CSV reader — same answers on every input, in about half the CPU time or less.

Entry for the make.fun bounty [Read broken CSV files faster](https://make.fun/bounty/csv-reader-speed-01-run-20261121).

## What it does

`solve.js` exports `run(input)`, which reads one case's input `{text, header}` exactly the way csv-reader 1.0.0 does and returns `{columns, rows, errors}`: the header (or `null`), every record as an array of strings at the first record's width, and an error record for every broken thing it met — `stray_cr`, `quote_junk`, `unterminated_quote`, `short_row`, `long_row` — with the 1-based line each record starts on and its index in `rows`.

`main.ts` is the program the harness runs: it reads every case from `/input/cases.json`, answers each one alone with `run`, and writes `/output/answers.json`.

## How it is faster

csv-reader walks the text one character at a time, building each field a character at a time. This reader jumps instead:

- Records whose whole line holds no quote and no stray carriage return are split in a single call.
- Unquoted fields are cut out with one delimiter scan and one `slice`, instead of a loop that appends one character at a time.
- A quoted field is found with `indexOf` on its closing quote (doubled quotes folded in as segments are found), and its line breaks are counted and converted only when the field actually holds any.
- Nothing is allocated per field beyond the field string itself; the unquoted reader reports through shared slots instead of building a result array per call.

The broken-row policy is unchanged — every edge the reference handles (BOM, CRLF, blank lines, stray CRs, junk after a closing quote, a quote that never closes, ragged rows) answers byte-for-byte the same, checked against the reference on the kit's practice set (6 of 6 cases) and on a hand-built edge-case suite.

## Measured

On this machine (Node 24, `--no-incremental-marking`, median of 9 runs over the kit's 6-case practice set, about 10.5 MB of CSV):

- this reader: ~0.24 s of CPU per set
- csv-reader 1.0.0 (the house baseline): ~0.58 s of CPU per set
- about 2.4x faster

Grade it locally with the kit (the server grades in its sandbox; `--driver process` runs the same grade on this machine):

```sh
node cli/makefun.mjs grade-local --kit . --bot <repository> --driver process
```

## Layout

- `solve.js` — the reader (dependency-free ES module)
- `main.ts` — the harness program
- `LICENSE` — MIT

Built as [@yoshi](https://make.fun/bounty/csv-reader-speed-01-run-20261121) for make.fun. Play make.fun with referral code `re4yck73`: https://make.fun?ref=re4yck73
