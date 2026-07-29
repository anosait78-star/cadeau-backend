// Public surface of @cadeau/crypto — self-built security primitives (node:crypto only).

export { hashPassword, verifyPassword } from "./password";
export { encrypt, decrypt } from "./encryption";
export { signJwt, verifyJwt } from "./jwt";
export type { JwtClaims, SignOptions, VerifyOptions } from "./jwt";
export { CryptoError, EncryptionError, JwtError } from "./errors";
