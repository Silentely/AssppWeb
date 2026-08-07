// 加密参数常量：迭代次数、盐与 IV 长度
const ITERATIONS = 100000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

/** 使用 PBKDF2 从口令派生加密密钥 */
async function getPasswordKey(password: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"],
  );
}

/** 使用口令密钥与随机盐派生 AES-GCM 密钥 */
async function deriveKey(
  passwordKey: CryptoKey,
  salt: Uint8Array,
): Promise<CryptoKey> {
  // 复制为独立的 ArrayBuffer，兼容 TS 5.7 收紧后的 BufferSource 类型
  const saltBuffer = salt.slice().buffer;
  return await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

/** 使用口令加密任意可序列化数据，返回含盐、IV 与密文的 Base64 字符串 */
export async function encryptData(
  data: unknown,
  password: string,
): Promise<string> {
  const enc = new TextEncoder();
  const encodedData = enc.encode(JSON.stringify(data));

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const passwordKey = await getPasswordKey(password);
  const aesKey = await deriveKey(passwordKey, salt);

  const encryptedContent = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    aesKey,
    encodedData,
  );

  const encryptedBytes = new Uint8Array(encryptedContent);
  const combined = new Uint8Array(
    salt.length + iv.length + encryptedBytes.length,
  );
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(encryptedBytes, salt.length + iv.length);

  // 将 Uint8Array 转为 Base64
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < combined.length; i += chunkSize) {
    binary += String.fromCharCode(...combined.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** 使用正确口令解密 encryptData 生成的 Base64 字符串，返回解析后的 JSON 数据 */
export async function decryptData(
  encryptedBase64: string,
  password: string,
): Promise<unknown> {
  try {
    const binary = atob(encryptedBase64);
    const combined = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      combined[i] = binary.charCodeAt(i);
    }

    const salt = combined.subarray(0, SALT_LENGTH);
    const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const encryptedBytes = combined.subarray(SALT_LENGTH + IV_LENGTH);

    const passwordKey = await getPasswordKey(password);
    const aesKey = await deriveKey(passwordKey, salt);

    const decryptedContent = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      aesKey,
      encryptedBytes,
    );

    const dec = new TextDecoder();
    const jsonStr = dec.decode(decryptedContent);
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error("Decryption failed. Incorrect password or corrupted data.");
  }
}
