"""Make a simple manual-review CSV from the benchmark's raw saved responses.

This does NOT contact AI providers. Manual grades/notes survive re-exporting.
"""
from __future__ import annotations
import csv
import os
from pathlib import Path
import tempfile

REVIEW_COLUMNS = ['model', 'try', 'time_seconds', 'question', 'reply', 'accuracy', 'notes']


def export_plain_summary(responses_path='results/responses.csv',
                         summary_path='results/summary.csv',
                         prompts=None, models=None, preserve_grades=True):
    """Export one row per successful request; keep previously entered grades.

    A matching row has the same model, question and repetition number.
    Raw results are NEVER changed, which keeps the benchmark resumable.
    """
    responses_path = Path(responses_path)
    summary_path = Path(summary_path)
    if not responses_path.is_file():
        raise FileNotFoundError(f'No raw results yet: {responses_path}')

    old_grades = {}
    if preserve_grades and summary_path.is_file():
        with summary_path.open('r', encoding='utf-8-sig', newline='') as file:
            reader = csv.DictReader(file)
            if reader.fieldnames and set(REVIEW_COLUMNS).issubset(reader.fieldnames):
                for row in reader:
                    row_id = (row['model'], row['question'], row['try'])
                    old_grades[row_id] = (row['accuracy'], row['notes'])

    with responses_path.open('r', encoding='utf-8-sig', newline='') as file:
        raw_rows = list(csv.DictReader(file))

    # Group all repeats together so grading and comparing models is easy.
    prompt_order = {p['id']: index for index, p in enumerate(prompts or [])}
    model_order = {m: index for index, m in enumerate(models or [])}
    raw_rows.sort(key=lambda r: (
        prompt_order.get(r['test_id'], 100000),
        model_order.get(r['model'], 100000),
        int(r['repetition']),
        r['model']
    ))

    output_rows = []
    for row in raw_rows:
        if row.get('status') != 'ok':
            continue  # Failed calls have no valid answer; see responses.csv for errors.
        identity = (row['model'], row['prompt'], str(row['repetition']))
        accuracy, notes = old_grades.get(identity, ('', ''))
        output_rows.append({
            'model': row['model'],
            'try': row['repetition'],
            'time_seconds': row['speed_seconds'],
            'question': row['prompt'],
            'reply': row['reply'],
            'accuracy': accuracy,
            'notes': notes,
        })

    summary_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        'w', encoding='utf-8-sig', newline='', dir=summary_path.parent,
        suffix='.tmp', delete=False
    ) as file:
        writer = csv.DictWriter(file, fieldnames=REVIEW_COLUMNS)
        writer.writeheader()
        writer.writerows(output_rows)
        temporary_path = file.name
    os.replace(temporary_path, summary_path)
    return len(output_rows)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Export plain summary from existing responses.csv')
    parser.add_argument('--in-file', default='results/responses.csv')
    parser.add_argument('--out-file', default='results/summary.csv')
    args = parser.parse_args()
    n = export_plain_summary(args.in_file, args.out_file)
    print(f'Wrote {n} replies to {args.out_file}; manual scores remain editable.')
