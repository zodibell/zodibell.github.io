import sys
sys.stdout.reconfigure(encoding='utf-8')
import requests
import yaml
from pathlib import Path

DATA_PATH = Path("_data/vocabulary.yml")

FREEDICTIONARY_API = "https://freedictionaryapi.com/api/v1/entries/en/{}"
WIKIPEDIA_API = "https://en.wikipedia.org/api/rest_v1/page/summary/{}"


def fetch_free_dictionary(term):
    """Fetch definition and etymology from FreeDictionaryAPI (Wiktextract format)."""
    url = FREEDICTIONARY_API.format(term)
    r = requests.get(url)

    # Debugging info (keep for now)
    print(f"[DEBUG FreeDictionary] {term}: {r.status_code} {r.text[:200]}")

    if r.status_code != 200:
        print(f"⚠️ No FreeDictionary data for {term}")
        return {}

    try:
        data = r.json()

        # Handle both list-based and object-based structures
        if isinstance(data, list):
            data = data[0]
        if "entries" not in data:
            return {}

        entries = data.get("entries", [])
        if not entries:
            return {}

        first_entry = entries[0]
        senses = first_entry.get("senses", [])
        first_sense = senses[0] if senses else {}

        definition = first_sense.get("definition")
        part_of_speech = first_entry.get("partOfSpeech")
        etymology = first_entry.get("etymology_text") or None

        return {
            "short_definition": definition,
            "part_of_speech": part_of_speech,
            "etymology": etymology,
            "source": "FreeDictionaryAPI.com",
            "url": f"https://www.thefreedictionary.com/{term.replace(' ', '+')}",
        }

    except Exception as e:
        print(f"⚠️ Error parsing FreeDictionary data for {term}: {e}")
        return {}


def fetch_wikipedia_summary(term):
    """Fetch summary and link from Wikipedia."""
    url = WIKIPEDIA_API.format(term)
    headers = {"User-Agent": "fetch_definitions_script/1.0 (https://example.com)"}  # replace with your site
    r = requests.get(url, headers=headers)

    print(f"[DEBUG Wikipedia] {term}: {r.status_code}")
    if r.status_code == 404:
        print(f"ℹ️ No Wikipedia page found for {term}")
        return {}
    elif r.status_code != 200:
        print(f"⚠️ Wikipedia lookup failed for {term} ({r.status_code})")
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
