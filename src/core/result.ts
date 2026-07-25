/**
 * Result — explicit success/failure without exceptions.
 *
 * Policies return decisions, they do not throw. A rejected mess-cut and a
 * denied scan are ordinary business outcomes that the caller must handle, and a
 * type that forces that handling is worth more than a stack trace. Exceptions
 * stay reserved for genuine faults (a database that is unreachable).
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok;

/** Maps the success value, leaving a failure untouched. */
export function mapResult<T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}

/** Chains an operation that can itself fail. */
export function andThen<T, U, E>(r: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> {
  return r.ok ? fn(r.value) : r;
}

/**
 * Extracts the value or throws. Only for call sites that have already proven
 * success (tests, or a branch after `isOk`). Never use it to skip handling.
 */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (!r.ok) {
    throw new Error(`unwrap called on a failed Result: ${JSON.stringify(r.error)}`);
  }
  return r.value;
}
