/** Base class for every error raised by the crypto package. */
export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Malformed key, ciphertext, or a failed authentication tag on decrypt. */
export class EncryptionError extends CryptoError {}

/** Malformed blind-index key, or an empty value offered for indexing. */
export class BlindIndexError extends CryptoError {}

/** Malformed, unsupported, expired, or invalidly-signed JWT. */
export class JwtError extends CryptoError {}

/** Malformed TOTP secret, or invalid TOTP generation/verification parameters. */
export class TotpError extends CryptoError {}
