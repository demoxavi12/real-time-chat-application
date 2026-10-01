import argon2 from 'argon2'

/**
 * Argon2id with the OWASP Password Storage Cheat Sheet baseline
 * (m=19 MiB, t=2, p=1). Parameters are encoded in each PHC hash string, so
 * they can be raised later without invalidating existing hashes.
 */
export const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
})

export function hashPassword(password) {
  return argon2.hash(password, ARGON2_OPTIONS)
}

/** Constant-time verification (argon2 library). False for malformed hashes. */
export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password)
  } catch {
    return false
  }
}

// Verified against when a login email does not exist, so both failure paths
// spend the same hashing time and response timing does not reveal accounts.
let dummyHashPromise
export function verifyAgainstDummyHash(password) {
  dummyHashPromise ??= hashPassword('dummy-password-for-timing-equalization')
  return dummyHashPromise.then((hash) => verifyPassword(hash, password))
}
