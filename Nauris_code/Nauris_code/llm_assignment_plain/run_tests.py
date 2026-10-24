"""Run a fully automatic 3-free-model benchmark. Every trial is single-turn.

Windows examples:
  py run_tests.py --dry-run
  py run_tests.py --max-new 3         # small real API smoke test
  py run_tests.py                     # resume and complete 135 trials
  py run_tests.py --model mock:cautious --model mock:eager --reset
"""
import argparse
import csv
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import random
import tempfile
import time

from backends import DEFAULT_MODELS, validate_models, ask
from plain_summary import export_plain_summary

FIELDS = [
    'model', 'test_id', 'category', 'repetition', 'prompt', 'reply',
    'speed_seconds', 'status', 'error', 'expected', 'completed_at_utc'
]


def key(row):
    """Unique ID of a model/question/repetition (for resumable execution)."""
    return row['model'], row['test_id'], str(row['repetition'])


def read_previous(path):
    """Read results from an earlier run, if any."""
    if not path.exists():
        return {}
    with path.open(newline='', encoding='utf-8-sig') as f:
        return {key(row): row for row in csv.DictReader(f)}


def save_csv(path, rows):
    """Save results after each trial, atomically to avoid half-written CSVs."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        'w', delete=False, encoding='utf-8-sig', newline='',
        dir=path.parent, suffix='.tmp'
    ) as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
        temporary = f.name
    os.replace(temporary, path)


def make_trials(items, models, repeats, seed):
    """Shuffle a deterministic complete set; avoid one provider always going first."""
    trials = [
        (model, item, number)
        for model in models for item in items for number in range(1, repeats + 1)
    ]
    #random.Random(seed).shuffle(trials)
    return trials


def is_rate_limit_error(exc):
    """Recognize provider 429s without importing their SDKs at program load."""
    code = getattr(exc, 'status_code', None)
    if code == 429:
        return True
    message = str(exc).lower()
    return any(t in message for t in ('429', 'resource_exhausted', 'rate_limit_exceeded'))


def run(models, items, repeats, out, seed=42, reset=False, pause=4.0,
        dry_run=False, max_new=None, retry_429=2):
    trials = make_trials(items, models, repeats, seed)
    print(f'Plan: {len(items)} prompts × {repeats} repeats × {len(models)} models = {len(trials)} requests')
    for m in models:
        print(f'  {m}')
    if dry_run:
        print('DRY RUN ONLY: no API calls, no measured results.')
        return 0
    problems = validate_models(models)
    if problems:
        raise ValueError('\n'.join(problems) + '\nSee README.md for setup.')

    previous = {} if reset else read_previous(out)
    # On reset discard previous results; otherwise keep only this exact experiment.
    requested = {(m, item['id'], str(n)) for m, item, n in trials}
    previous = {k: v for k, v in previous.items() if k in requested}
    attempts = 0
    stopped_for_quota = False

    for index, (model, item, rep) in enumerate(trials, 1):
        identity = model, item['id'], str(rep)
        if identity in previous and previous[identity]['status'] == 'ok':
            continue
        if max_new is not None and attempts >= max_new:
            break
        attempts += 1
        reply, error, status, elapsed = '', '', 'ok', 0.0
        for retry in range(retry_429 + 1):
            started = time.perf_counter()
            try:
                reply = ask(model, item['prompt'])
                elapsed = time.perf_counter() - started
                if not reply.strip():
                    raise RuntimeError('Model returned an empty text response')
                error = ''
                status = 'ok'
                break
            except Exception as exc:
                elapsed = time.perf_counter() - started
                status = 'error'
                error = f'{type(exc).__name__}: {exc}'
                if is_rate_limit_error(exc) and retry < retry_429:
                    delay = 30 * (retry + 1)
                    print(f'  Rate limit for {model}; sleeping {delay}s before another attempt', flush=True)
                    time.sleep(delay)  # not included in measured request latency
                    continue
                if is_rate_limit_error(exc):
                    stopped_for_quota = True
                break

        previous[identity] = {
            'model': model, 'test_id': item['id'], 'category': item['category'],
            'repetition': rep, 'prompt': item['prompt'], 'reply': reply,
            'speed_seconds': round(elapsed, 3), 'status': status,
            'error': error, 'expected': item.get('expected', ''),
            'completed_at_utc': datetime.now(timezone.utc).isoformat(timespec='seconds')
        }
        ordered = [previous[(m, it['id'], str(n))] for m, it, n in trials
                   if (m, it['id'], str(n)) in previous]
        save_csv(out, ordered)
        print(f'[{index:3}/{len(trials)}] {model:34} {item["id"]:6} #{rep} '
              f'{elapsed:6.2f}s {status.upper()} {error[:120]}', flush=True)
        if stopped_for_quota:
            print('Stopped after repeated rate-limit errors. Saved progress; rerun later to resume.')
            break
        if pause and attempts and attempts != len(trials):
            time.sleep(pause)  # deliberately not timed

    remaining = sum(
        1 for m, it, n in trials
        if (m, it['id'], str(n)) not in previous
        or previous[(m, it['id'], str(n))]['status'] != 'ok'
    )
    print(f'Progress: {len(trials)-remaining}/{len(trials)} successful trials; {remaining} outstanding.')
    return len(previous)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--model', action='append', help='E.g. groq:openai/gpt-oss-20b; repeat for more models')
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--prompts', default='prompts.json')
    parser.add_argument('--out', default='results/responses.csv')
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--pause', type=float, default=4.0,
                        help='Seconds between separate requests; excludes response timing')
    parser.add_argument('--max-new', type=int, default=None,
                        help='Send at most N new requests, preserving all earlier results')
    parser.add_argument('--retry-429', type=int, default=2,
                        help='Number of 429 retries with backoff (default 2)')
    parser.add_argument('--reset', action='store_true', help='Overwrite earlier results')
    parser.add_argument('--dry-run', action='store_true', help='Validate experiment plan without API calls')
    parser.add_argument('--export-only', action='store_true', help='Rebuild plain summary from existing responses without any API calls')
    args = parser.parse_args()
    if args.repeats < 1 or args.pause < 0 or args.retry_429 < 0 or (args.max_new is not None and args.max_new < 1):
        parser.error('--repeats must be >= 1; --pause and --retry-429 >= 0; --max-new >= 1')

    from dotenv import load_dotenv
    load_dotenv()
    with open(args.prompts, encoding='utf-8') as f:
        items = json.load(f)['items']
    models = args.model or DEFAULT_MODELS
    out = Path(args.out)
    simple_summary = out.with_name('summary.csv')
    if args.export_only:
        count = export_plain_summary(out, simple_summary, items, models)
        print(f'Saved {count} replies for manual scoring in {simple_summary}')
        return
    count = run(models, items, args.repeats, out, args.seed,
                args.reset, args.pause, args.dry_run, args.max_new, args.retry_429)
    if args.dry_run:
        return
    reviewed = export_plain_summary(out, simple_summary, items, models, preserve_grades=not args.reset)
    print(f'Saved {count} completed-or-failed unique trials in {out}')
    print(f'Saved {reviewed} successful replies in {simple_summary} (plain, ready for manual accuracy grading)')
    if any(m.startswith('mock:') for m in models):
        print('WARNING: MOCK DATA IS FAKE and must never be used in your university results.')


if __name__ == '__main__':
    main()
