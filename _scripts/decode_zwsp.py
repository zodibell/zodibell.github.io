import re
import sys

# Define zero-width characters
ZWSP = '\u200B'  # 0
ZWNJ = '\u200C'  # 1

def extract_and_decode(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Find all spans or standalone zero-width sequences
    zw_sequences = re.findall(r'[\u200B\u200C]{8,}', content)

    if not zw_sequences:
        print("❌ No zero-width hidden messages found.")
        return

    print(f"🔍 Found {len(zw_sequences)} hidden message(s):\n")

    for i, seq in enumerate(zw_sequences, 1):
        # Convert to binary
        binary = ''.join('0' if c == ZWSP else '1' if c == ZWNJ else '' for c in seq)
        # Group into bytes
        bytes_list = [binary[i:i+8] for i in range(0, len(binary), 8)]
        try:
            message = ''.join(chr(int(b, 2)) for b in bytes_list if len(b) == 8)
            print(f"🔑 Message {i}: {message}")
        except Exception as e:
            print(f"⚠️  Message {i} could not be decoded: {e}")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python decode_zwsp.py <file.md or file.html>")
    else:
        extract_and_decode(sys.argv[1])
