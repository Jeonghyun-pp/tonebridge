# Evaluation Scripts

20-song regression set for prompt quality guardrails.

## Files

- `run.ts` (S6) — run full research+adapt pipeline on eval set, score vs expected
- `eval_set.json` — 20 songs + `expected` settings + user gear context

## Scoring

Each song scored 0-5 based on:
- Amp knob deviation ≤ 2 → +0.5 each (4 knobs)
- Pedal category match → +1
- Playing tips present → +0.5
- Confidence appropriately calibrated → +0.5

**CI gate**: average score < 3.5 → block deploy.
**Nightly cron**: average < 3.5 over 5 of last 7 days → auto-halt pipeline (Zero-Human guardrail).

See master plan §12.1 and §6.6.10.
