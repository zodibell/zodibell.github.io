ZWSP = '\u200B'  # zero width space → 0
ZWNJ = '\u200C'  # zero width non-joiner → 1

raw = '''​‌​​‌​​‌‌​​​​​‌​​​‌‌​​​‌‌​​‌‌‌‌​​‌‌‌​‌‌​​‌​​​​​‌​​​​​​‌​​‌‌​​‌‌​​‌​​‌‌​‌​​​​​​‌​​‌‌​​​​​​‌‌‌​​​​​‌​‌​​‌​​​‌‌​​‌‌‌​​​​​​‌‌​​​‌​​​​​‌‌​​‌‌‌​​‌‌‌‌​​​​​​‌​‌‌​‌‌​​‌​​​‌‌​​‌​​​​​‌​‌‌‌​​​‌​​​‌​​‌​​​​‌‌​‌‌​​‌‌​​‌​​‌‌​‌​​‌‌​​​​​​‌​‌‌'''

print(f"Length of zero-width string: {len(raw)} characters")

# Map characters to bits
binary = ''.join('0' if c == ZWSP else '1' if c == ZWNJ else '' for c in raw)

print(f"Binary length: {len(binary)} bits")

# Ensure binary length multiple of 8
if len(binary) % 8 != 0:
    print("Warning: binary length is not multiple of 8 — truncating extras")
    binary = binary[:len(binary) - (len(binary) % 8)]

# Break into bytes
bytes_list = [binary[i:i+8] for i in range(0, len(binary), 8)]

# Decode bytes to chars
decoded_chars = [chr(int(b, 2)) for b in bytes_list]
decoded_message = ''.join(decoded_chars)

print(f"Decoded message:\n{decoded_message}")
