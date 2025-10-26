import sys
sys.stdout.reconfigure(encoding='utf-8')
import requests
import yaml
from pathlib import Path

DATA_PATH = Path("_data/vocabulary.yml")

FREEDICTIONARY_API = "https://freedictionaryapi.com/api/v1/entries/en/{}"
WIKIPEDIA_API = "https://en.wikipedia.org/api/rest_v1/page/summary/{}"


def fetch_free_dictionary(term):
    """Fetch definition and etymology from FreeDictionaryAPI."""
    url = FREEDICTIONARY_API.format(term)
    r = requests.get(url)
    if r.status_code != 200:
        print(f"⚠️ No FreeDictionary data for {term}")
        return {}

    try:
        data = r.json()[0]
        meanings = data.get("meanings", [])
        first_meaning = meanings[0] if meanings else {}

        definition = first_meaning.get("definitions", [{}])[0].get("definition")
        part_of_speech = first_meaning.get("partOfSpeech")
        etymology = data.get("origin", None)

        return {
            "short_definition": definition,
            "part_of_speech": part_of_speech,
            "etymology": etymology,
            "source": "FreeDictionaryAPI.com",
            "url": f"https://www.thefreedictionary.com/{term.replace(' ', '+')}",
        }
    except (KeyError, IndexError, TypeError):
        return {}


def fetch_wikipedia_summary(term):
    """Fetch summary and link from Wikipedia."""
    url = WIKIPEDIA_API.format(term)
    r = requests.get(url)
    if r.status_code != 200:
        print(f"⚠️ Wikipedia lookup failed for {term}")
        return {}

    data = r.json()
    return {
        "short_definition": data.get("extract"),
        "url": data.get("content_urls", {}).get("desktop", {}).get("page"),
        "source": "Wikipedia",
    }


def update_vocabulary():
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        vocab = yaml.safe_load(f)

    updated = False
    for entry in vocab:
        term = entry["term"]
        pref = entry.get("source_preference", "dictionary")

        if not entry.get("short_definition"):
            print(f"🔍 Fetching data for {term} ({pref})...")

            if pref == "wikipedia":
                data = fetch_wikipedia_summary(term)
            else:
                data = fetch_free_dictionary(term)
                # If dictionary fails, fallback to Wikipedia
                if not data:
                    data = fetch_wikipedia_summary(term)

            if data:
                entry.update({k: v for k, v in data.items() if v})
                updated = True

    if updated:
        with open(DATA_PATH, "w", encoding="utf-8") as f:
            yaml.dump(vocab, f, sort_keys=False, allow_unicode=True)
        print("✅ Vocabulary file updated successfully.")
    else:
        print("No updates were necessary.")


if __name__ == "__main__":
    update_vocabulary()
