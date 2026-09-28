/**
 * A failure the caller should see as a clear message: bad input, a broken
 * domain rule, or a missing setting. Anything else is a bug.
 */
export class DomainError extends Error {
  override name = "DomainError";
}
