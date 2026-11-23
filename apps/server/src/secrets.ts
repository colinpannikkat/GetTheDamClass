import { Effect } from "effect"
import { Digest, SecureRandom } from "effect/crypto"
import { Base64Url } from "effect/encoding"

export const randomCode = SecureRandom.SecureRandom.use((random) => random.intBetween(0, 999_999)).pipe(
  Effect.map((n) => String(n).padStart(6, "0"))
)

export const randomKey = (bytes: number) =>
  SecureRandom.SecureRandom.use((random) => random.randomBytes(bytes)).pipe(Effect.map(Base64Url.encode))

export const hashSecret = (secret: string) =>
  Digest.Digest.use((digest) => digest.digestHex(Digest.sha256, new TextEncoder().encode(secret)))
