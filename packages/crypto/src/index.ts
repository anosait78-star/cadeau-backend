// Public surface of @cadeau/crypto — self-built security primitives (node:crypto only).

export { hashPassword, verifyPassword } from "./password";
export { encrypt, decrypt } from "./encryption";
export { blindIndex } from "./blind-index";
export { signJwt, verifyJwt } from "./jwt";
export type { JwtClaims, SignOptions, VerifyOptions } from "./jwt";
export {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  generateTotp,
  verifyTotp,
  buildOtpAuthUri,
} from "./totp";
export type { TotpOptions, VerifyTotpOptions, OtpAuthUriInput } from "./totp";
export { signWebhookPayload, verifyWebhookSignature } from "./webhook-signature";
export {
  CryptoError,
  EncryptionError,
  BlindIndexError,
  JwtError,
  TotpError,
  WebhookSignatureError,
} from "./errors";
