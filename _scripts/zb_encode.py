def encode_zwsp(message):
    ZWSP = '\u200B'  # zero-width space = 0
    ZWNJ = '\u200C'  # zero-width non-joiner = 1

    binary = ''.join(f'{ord(c):08b}' for c in message)
    zwsp_string = ''.join(ZWSP if bit == '0' else ZWNJ for bit in binary)
    return zwsp_string

message = "ZB - Do not copy or use for AI."
encoded = encode_zwsp(message)

print(f"Encoded length: {len(encoded)} zero-width characters")
print(encoded)
