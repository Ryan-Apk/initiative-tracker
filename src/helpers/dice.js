// True-random d20 roll via the Web Crypto API instead of Math.random() —
// getRandomValues pulls from the OS's CSPRNG (actual entropy, not a seeded
// pseudo-random sequence), which is as close to a physical die as a browser
// gets without installing anything. Rejection-sampled over a byte so every
// face keeps exactly 1/20 odds instead of a slight low-face bias from % 20.
export function rollD20() {
  const faces = 20;
  const usableRange = 256 - (256 % faces); // 240: largest multiple of 20 under 256
  const byte = new Uint8Array(1);
  let value;
  do {
    crypto.getRandomValues(byte);
    value = byte[0];
  } while (value >= usableRange);
  return (value % faces) + 1;
}
