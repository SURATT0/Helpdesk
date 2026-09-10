import bcrypt from "bcryptjs";

/**
 * Work factor for new password hashes.
 *
 * 12, not the 10 the demo seed uses. The seed's job is to write sixteen throwaway
 * accounts quickly; this is what protects a real one if the table is ever stolen,
 * and the two have no reason to agree.
 *
 * Raising it later costs nothing and breaks nothing: bcrypt stores the factor
 * inside the hash, so `verifyPassword` keeps accepting every hash written at any
 * earlier cost, and accounts move up the next time their owner sets a password.
 */
const BCRYPT_COST = 12;

/**
 * The one place a password becomes a hash.
 *
 * Registration, the password reset and the bootstrap script all come through
 * here rather than calling bcrypt themselves — three call sites are three
 * chances for one of them to be written at a different cost, or against a
 * different algorithm, and nothing would fail to make that visible.
 */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * Check a password against a stored hash.
 *
 * `hash` is nullable because `users.password_hash` is: an account created from
 * an inbound email has never had a password. That case answers false rather than
 * throwing, and — importantly — it still spends the time bcrypt would have spent,
 * because an instant "no" for passwordless accounts and a slow "no" for real ones
 * is an oracle telling an attacker which addresses are which.
 */
export async function verifyPassword(
  plain: string,
  hash: string | null,
): Promise<boolean> {
  if (hash == null) {
    await bcrypt.compare(plain, dummyHash());
    return false;
  }
  return bcrypt.compare(plain, hash);
}

/**
 * A real bcrypt hash of a value nobody knows, compared against when there is no
 * stored hash to compare against. Its only job is to take the time a genuine
 * comparison takes.
 *
 * Built on FIRST USE, not at module load. Hashing at cost 12 takes a few hundred
 * milliseconds, and paying that at import would add it to every server boot and
 * to every test file that touches this module — for a value most runs never
 * need. Cached after the first passwordless comparison, so the cost is paid once
 * per process at most.
 */
let cachedDummyHash: string | null = null;
function dummyHash(): string {
  cachedDummyHash ??= bcrypt.hashSync("::no-such-password::", BCRYPT_COST);
  return cachedDummyHash;
}
