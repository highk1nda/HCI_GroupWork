"""Offline tests for the core runner, including fresh one-message requests and resume."""
import csv
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from run_tests import make_trials, run


class RunnerTests(unittest.TestCase):
    def test_full_count_and_each_combination_unique(self):
        items = [{'id': f'p{i}', 'prompt': f'Question {i}', 'category':'Easy'} for i in range(15)]
        models = ['gemini:test', 'groq:one', 'groq:two']
        trials = make_trials(items, models, repeats=3, seed=42)
        self.assertEqual(len(trials), 135)
        self.assertEqual(len({(m, p['id'], n) for m, p, n in trials}), 135)

    def test_runner_resume_and_no_context(self):
        items = [
            {'id': 'easy1', 'category': 'Easy', 'prompt': 'Say 27', 'expected': '27'},
            {'id': 'hard1', 'category': 'Harder', 'prompt': 'Where is Latvia?'}
        ]
        messages = []
        def fake_ask(model, prompt):
            messages.append((model, prompt))
            return '27'
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)/'responses.csv'
            with patch('run_tests.validate_models', return_value=[]), patch('run_tests.ask', side_effect=fake_ask):
                run(['mock:cautious'], items, repeats=3, out=out, pause=0, max_new=2)
                with out.open(encoding='utf-8-sig', newline='') as f:
                    self.assertEqual(len(list(csv.DictReader(f))), 2)
                run(['mock:cautious'], items, repeats=3, out=out, pause=0)
                self.assertEqual(len(messages), 6)
                run(['mock:cautious'], items, repeats=3, out=out, pause=0)
                self.assertEqual(len(messages), 6)  # no duplicate successful calls
                with out.open(encoding='utf-8-sig', newline='') as f:
                    rows = list(csv.DictReader(f))
                self.assertEqual(len(rows), 6)
                self.assertTrue(all(r['status']=='ok' for r in rows))
                self.assertEqual({r['prompt'] for r in rows}, {'Say 27', 'Where is Latvia?'})
                self.assertTrue(all(float(r['speed_seconds']) >= 0 for r in rows))


if __name__ == '__main__':
    unittest.main()
