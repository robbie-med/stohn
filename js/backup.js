// Backup envelope: plain or passphrase-encrypted JSON (PBKDF2 -> AES-GCM),
// entirely in the browser via WebCrypto. The file never leaves the device
// unless the user moves it.

export const FORMAT = 'firststone-backup';
const ITERATIONS = 310000;

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function pack(payload, appVersion, passphrase) {
  const meta = { format: FORMAT, version: 1, app: appVersion, exportedAt: new Date().toISOString() };
  if (!passphrase) return JSON.stringify({ ...meta, encrypted: false, payload }, null, 2);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
  return JSON.stringify(
    {
      ...meta,
      encrypted: true,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: b64(salt) },
      cipher: { name: 'AES-GCM', iv: b64(iv) },
      data: b64(data),
    },
    null,
    2,
  );
}

export function isEncrypted(text) {
  const o = JSON.parse(text);
  if (o.format !== FORMAT) throw new Error('not a backup');
  return o.encrypted === true;
}

// Throws 'wrong-passphrase' when decryption fails.
export async function unpack(text, passphrase) {
  const o = JSON.parse(text);
  if (o.format !== FORMAT) throw new Error('not a backup');
  if (!o.encrypted) return o.payload;
  const key = await deriveKey(passphrase || '', unb64(o.kdf.salt), o.kdf.iterations);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.cipher.iv) }, key, unb64(o.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error('wrong-passphrase');
  }
}
