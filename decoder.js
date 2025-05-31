(() => {
  // Zero-width character mapping
  const ZWSP = '\u200B'; // 0
  const ZWNJ = '\u200C'; // 1

  // Step 1: Locate hidden span
  const hiddenSpan = Array.from(document.querySelectorAll('span'))
    .find(el => el.style.display === 'none' && el.textContent.match(/^[\u200B\u200C]+$/));

  if (!hiddenSpan) {
    console.log('No hidden zero-width message found.');
    return;
  }

  const zwText = hiddenSpan.textContent;

  // Step 2: Convert back to binary
  const binary = zwText
    .split('')
    .map(c => (c === ZWSP ? '0' : c === ZWNJ ? '1' : ''))
    .join('');

  // Step 3: Convert binary to ASCII
  const chars = binary.match(/.{8}/g)?.map(byte => String.fromCharCode(parseInt(byte, 2)));

  const decodedMessage = chars?.join('') || '[Decoding failed]';
  console.log('🕵️ Decoded message:', decodedMessage);
})();
