import csv
import tempfile
import unittest
from pathlib import Path
from plain_summary import export_plain_summary, REVIEW_COLUMNS

class PlainSummaryTests(unittest.TestCase):
    def test_columns_sorting_grades_preserved_and_failures_omitted(self):
        with tempfile.TemporaryDirectory() as directory:
            raw=Path(directory)/'responses.csv'
            summary=Path(directory)/'summary.csv'
            data=[
                dict(model='groq:b', test_id='easy2', repetition='2', speed_seconds='0.234',
                     category='Easy', prompt='What is the capital?', reply='Rome', status='ok'),
                dict(model='gemini:a', test_id='easy1', repetition='1', speed_seconds='1.999',
                     category='Easy', prompt='How many countries?', reply='27', status='ok'),
                dict(model='gemini:a', test_id='easy2', repetition='1', speed_seconds='3.2',
                     category='Easy', prompt='What is the capital?', reply='', status='error'),
            ]
            with raw.open('w', encoding='utf-8', newline='') as f:
                w=csv.DictWriter(f, fieldnames=data[0].keys()); w.writeheader(); w.writerows(data)
            p=[{'id':'easy1'},{'id':'easy2'}]
            m=['gemini:a','groq:b']
            self.assertEqual(export_plain_summary(raw,summary,p,m),2)
            with summary.open(encoding='utf-8-sig', newline='') as f:
                r=csv.DictReader(f)
                self.assertEqual(r.fieldnames,REVIEW_COLUMNS)
                rows=list(r)
            self.assertEqual([row['reply'] for row in rows],['27','Rome'])
            rows[0]['accuracy']='2'
            rows[0]['notes']='Good answer'
            with summary.open('w', encoding='utf-8-sig', newline='') as f:
                w=csv.DictWriter(f,fieldnames=REVIEW_COLUMNS);w.writeheader();w.writerows(rows)
            self.assertEqual(export_plain_summary(raw,summary,p,m),2)
            with summary.open(encoding='utf-8-sig', newline='') as f:
                rows=list(csv.DictReader(f))
            self.assertEqual(rows[0]['accuracy'],'2')
            self.assertEqual(rows[0]['notes'],'Good answer')
            self.assertEqual(rows[0]['time_seconds'],'1.999')

if __name__ == '__main__':
    unittest.main()
