export const generateECDHKeyPair = async () => {
  try {
    const keyPair = await window.crypto.subtle.generateKey(
      {
        name: "ECDH",
        namedCurve: "P-256",
      },
      true, // extractable
      ["deriveKey", "deriveBits"]
    );
    return keyPair;
  } catch (error) {
    console.error("Key generation error:", error);
    throw error;
  }
};
