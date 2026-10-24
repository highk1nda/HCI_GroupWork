# Simple benchmark — 15 prompts × 3 runs × 3 models

This is the same automatic free-tier model benchmark as before, but it produces a **plain CSV for manual checking**. It sends every question to each model three times, with no previous conversation history, and measures the time to receive the full reply.

## Install / run on Windows in VS Code

```powershell
py -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Put your real API keys into `.env` (never share them):

```ini
GEMINI_API_KEY=your_key
GROQ_API_KEY=your_key
```

Dry run (no calls):

```powershell
py run_tests.py --dry-run
```

Run 3 tests, then the remainder automatically:

```powershell
py run_tests.py --max-new 3
py run_tests.py
```

**Already have `results/responses.csv` from the old project?** Copy it into this project's `results/` directory, then convert those responses without making new API calls:

```powershell
py run_tests.py --export-only
```

The regular `py run_tests.py` command **resumes** previous successful trials; it does not repeat them. Never use `--reset` unless you want to rerun everything.

## Output

- **`results/summary.csv`** — the simple review sheet: `model, try, time_seconds, question, reply, accuracy, notes`. Each row is one completed reply. Accuracy and notes are **blank** for your group to complete manually. Entries are organized by original question, then model and try number.
- **`results/responses.csv`** — unchanged raw output with status/errors, IDs, time and prompt for robust resume. Keep this file; don't grade it or rename columns.

You can open `summary.csv` in Excel or Google Sheets and fill in **accuracy** and **notes**. Your entries will be preserved if you resume running the script or use `--export-only` again. If you edit the file in Excel, save it as a UTF-8 CSV and close Excel before resuming so the script can update it. For a separate long-term grading workbook, make a copy after all results are collected.

Suggested simple manual quality rubric: `2` = accurate/helpful OR requests essential clarification; `1` = partly correct or superficial; `0` = incorrect/misleading or falsely claims to have done an action. An appropriate request for missing data should not be marked wrong.

A row with an API error is **not** a model's answer and is omitted from the plain summary. Its details remain in `responses.csv` and it can be retried.

## What the script measures

Timing is the duration of each single-turn API call using Python's high-resolution timer, including connection and request overhead. The fixed pause between requests is excluded. No chat history or memory is sent; the providers' own infrastructure may have unseen context/settings.

All three models use free-tier API quotas (free tier depends on plan and region). The code does not add billing information. Make sure your accounts are on the free plan and monitor quota usage.

Model defaults: `gemini:gemini-3.5-flash-lite`, `groq:openai/gpt-oss-20b`, `groq:qwen/qwen3.8-27b`. These models are **not** the ChatGPT or Claude consumer websites.

## Important functions to explain in your workshop

- `backends.ask()` sends one prompt to the chosen API model without any prior messages.
- `run_tests.make_trials()` creates and shuffles the 135 tests.
- `run_tests.run()` executes, measures and saves each test so you can resume.
- `plain_summary.export_plain_summary()` makes the human-readable sheet, preserving manual grading and omitting failed API requests.

The plain summary intentionally does not calculate accuracy, because deciding whether ambiguous answers are helpful is part of your group's experiment.
