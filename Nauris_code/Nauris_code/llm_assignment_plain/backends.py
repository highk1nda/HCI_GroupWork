"""Single-turn API backends for the three free-plan models.

All calls send exactly one user message, without previous history or a system
message. No model responses are carried from one request to the next.
"""
import os

# Model IDs verified against provider documentation on 2026-10-24.
DEFAULT_MODELS = [
    "gemini:gemini-3.5-flash-lite",
    "groq:openai/gpt-oss-20b",
    "groq:qwen/qwen3.8-27b",
]
KEY_NAMES = {"gemini": "GEMINI_API_KEY", "groq": "GROQ_API_KEY"}


def validate_models(specs):
    """Validate model specifications and check necessary environment variables."""
    problems = []
    for spec in specs:
        provider, sep, model = spec.partition(":")
        if not sep or not model:
            problems.append(f"Invalid model '{spec}'. Use gemini:model or groq:model")
        elif provider not in KEY_NAMES and provider != "mock":
            problems.append(f"Unsupported provider '{provider}' in {spec}. Use gemini or groq")
        elif provider in KEY_NAMES:
            keyname = KEY_NAMES[provider]
            value = os.getenv(keyname, "").strip()
            if not value or value.startswith(("http://", "https://")):
                problems.append(f"{keyname} must contain a genuine API key, not a website URL")
    return problems


def ask(spec, prompt):
    """Return completed answer to one prompt (no session / chat history)."""
    provider, sep, model = spec.partition(":")
    if not sep or not model:
        raise ValueError(f"Invalid model spec: {spec}")

    if provider == "groq":
        # Groq uses the OpenAI-compatible API; this is NOT ChatGPT.
        from openai import OpenAI
        client = OpenAI(
            base_url="https://api.groq.com/openai/v1",
            api_key=os.environ["GROQ_API_KEY"],
            timeout=90,
            max_retries=0,    # A retry must never silently distort speed.
        )
        result = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_completion_tokens=1024,
        )
        return result.choices[0].message.content or ""

    if provider == "gemini":
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        try:
            result = client.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(max_output_tokens=1024),
            )
            return result.text or ""
        finally:
            client.close()

    if provider == "mock":
        # Offline pipeline test only. NOT a real AI model.
        # Supports deliberate fake answers for the 15 user prompts.
        if model not in {"cautious", "eager"}:
            raise ValueError("Mock supports mock:cautious or mock:eager")
        if model == "eager":
            return "Sure! Done."
        easy = {
            "how many countries in eu": "27",
            "capital of italy": "Rome",
            "what year latvia got bronze": "2023",
            "berlin wall come down": "1989",
            "is grass green": "Yes",
        }
        for part, answer in easy.items():
            if part in prompt.casefold():
                return answer
        if "brother" in prompt.casefold():
            return "If he lives in Mexico, he is in Mexico; I don't know his exact address."
        if "remind" in prompt.casefold():
            return "I can't schedule a reminder from this interface. What time do you mean?"
        return "Could you clarify what you mean?"

    raise ValueError(f"Unsupported provider: {provider}")
