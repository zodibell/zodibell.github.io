import re
import sys

ZWSP = '\u200B'  # Zero Width Space → 0
ZWNJ = '\u200C'  # Zero Width Non-Joiner → 1

def analyze(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Find all runs of ZWSP/ZWNJ that are at least 8 characters long
    matches = re.findall(r'[\u200B\u200C]{8,}', content)

    if not matches:
        print("❌ No zero-width sequences found.")
        return

    print(f"🔍 Found {len(matches)} zero-width sequence(s):\n")

    for i, seq in enumerate(matches, 1):
        print(f"🔹 Sequence {i}: {len(seq)} characters")

        binary = ''.join('0' if c == ZWSP else '1' for c in seq)
        print(f"🧮 Binary:\n{binary}\n")

        bytes_list = [binary[j:j+8] for j in range(0, len(binary), 8)]

        print("🔍 Byte breakdown:")
        decoded_chars = []
        for byte in bytes_list:
            if len(byte) == 8:
                decimal = int(byte, 2)
                char = chr(decimal)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python analyze_zwsp.py <file>")
    else:
        analyze(sys.argv[1])
