/**
 * crypto-service.js - Web Crypto API 加解密與備份還原服務
 */

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const baseKey = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  return await window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptData(plaintext, password) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error("此瀏覽器環境不支援 Web Crypto API，無法進行加密備份！");
  }
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  
  const enc = new TextEncoder();
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    enc.encode(plaintext)
  );
  
  return {
    salt: bufToHex(salt),
    iv: bufToHex(iv),
    ciphertext: bufToHex(ciphertext)
  };
}

async function decryptData(ciphertextHex, password, saltHex, ivHex) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error("此瀏覽器環境不支援 Web Crypto API，無法進行解密還原！");
  }
  const salt = hexToBuf(saltHex);
  const iv = hexToBuf(ivHex);
  const ciphertext = hexToBuf(ciphertextHex);
  const key = await deriveKey(password, salt);
  
  const decrypted = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    key,
    ciphertext
  );
  
  const dec = new TextDecoder();
  return dec.decode(decrypted);
}

// Expose functions globally for app.js and sandbox testing
window.bufToHex = bufToHex;
window.hexToBuf = hexToBuf;
window.deriveKey = deriveKey;
window.encryptData = encryptData;
window.decryptData = decryptData;
