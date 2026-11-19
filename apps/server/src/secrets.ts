/**
 * Making the server's secrets (sign-in codes, sign-in tokens, unsubscribe
 * keys) and hashing the ones it must not store as they are.
 *
 * Randomness comes from Effect's `SecureRandom` service (the Web Crypto API in
 * the Worker), so a test can supply its own.
 */
import { Effect } from "effect"
import { Digest, SecureRandom } from "effect/crypto"
import { Base64Url } from "effect/encoding"

/** A sign-in code: six random digits, leading zeros included ("042137"). */
export const randomCode = SecureRandom.SecureRandom.use((random) => random.intBetween(0, 999_999)).pipe(
  Effect.map((n) => String(n).padStart(6, "0"))
)

/**
 * A long random string, safe to put in a URL or a header: `bytes` random
 * bytes, written in Base64Url. 16 bytes (128 bits) cannot be guessed; 32 is
 * what sign-in tokens get, to be generous.
 */
export const randomKey = (bytes: number) =>
  SecureRandom.SecureRandom.use((random) => random.randomBytes(bytes)).pipe(Effect.map(Base64Url.encode))

/**
 * The SHA-256 hash of a secret, in hex: what the database keeps instead of the
 * secret. For a sign-in token, which is long and random, the hash is as good
 * as a lock: nobody can work back from it. A six-digit code could be found
 * again by hashing all million of them, but that only matters if someone has
 * the database within the 15 minutes the code works.
 */
export const hashSecret = (secret: string) =>
  Digest.Digest.use((digest) => digest.digestHex(Digest.sha256, new TextEncoder().encode(secret)))
