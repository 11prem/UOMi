export type AppErrorCode =
  | 'network'
  | 'not_on_server'
  | 'invalid_credentials'
  | 'too_many_attempts'
  | 'username_taken'
  | 'phone_taken'
  | 'invalid_code'
  | 'code_expired'
  | 'otp_locked'
  | 'unknown_username'
  | 'session_expired'
  | 'not_found'
  | 'forbidden'
  | 'validation_error'
  | 'simulated'
  | 'unknown';

/** What every service call throws. `message` is user-facing copy; `extra` carries details such as `retry_after_seconds` or `fields`. */
export class AppError extends Error {
  constructor(
    public code: AppErrorCode,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype); // keeps `instanceof` working when classes are down-levelled
  }
}

export const notOnServer = () => new AppError('not_on_server', 'Not available on this server yet');
