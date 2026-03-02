export const generateECDHKeyPair = async () => {
  try {
    const keyPair = await window.crypto.subtle.generateKey(
      {
        name: "ECDH",
        namedCurve: "P-256",
      },
      true,
      ["deriveKey", "deriveBits"]
    );
    return keyPair;
  } catch (error) {
    console.error("Key generation error:", error);
    throw error;
  }
};

export const exportPublicKey = async (publicKey) => {
  const jwk = await window.crypto.subtle.exportKey("jwk", publicKey);
  return jwk;
};

export const importPublicKey = async (jwk) => {
  return await window.crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    []
  );
};

export const deriveSessionKey = async (privateKey, publicKey) => {
  return await window.crypto.subtle.deriveKey(
    {
      name: "ECDH",
      public: publicKey,
    },
    privateKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"]
  );
};

export const encryptChunk = async (chunkBuffer, sessionKey) => {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encryptedBuffer = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    sessionKey,
    chunkBuffer
  );

  // Prepend IV to the encrypted data so receiver can extract it
  const combined = new Uint8Array(iv.length + encryptedBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encryptedBuffer), iv.length);
  return combined.buffer;
};

export const decryptChunk = async (encryptedCombinedBuffer, sessionKey) => {
  const combined = new Uint8Array(encryptedCombinedBuffer);
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    sessionKey,
    data
  );
  return decryptedBuffer;
};
