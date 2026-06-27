/**
 * Races a promise against a deadline. Rejects with a TimeoutError if the
 * promise does not settle within `ms` milliseconds.
 */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new TimeoutError(ms)), ms),
    ),
  ]);
}
