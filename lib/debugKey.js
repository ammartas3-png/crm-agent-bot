const BEGIN_MARKER = "-----BEGIN PRIVATE KEY-----";
const END_MARKER = "-----END PRIVATE KEY-----";

export function normalizedDebugPrivateKey(env = process.env) {
  return String(env.GOOGLE_PRIVATE_KEY || "")
    .replace(/\\n/g, "\n")
    .trim();
}

export function debugKeyStatus(env = process.env) {
  const privateKey = normalizedDebugPrivateKey(env);

  return {
    hasEmail: Boolean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
    hasKey: Boolean(privateKey),
    startsWithBegin: privateKey.startsWith(BEGIN_MARKER),
    endsWithEnd: privateKey.endsWith(END_MARKER),
    containsRealNewlines: privateKey.includes("\n"),
  };
}
