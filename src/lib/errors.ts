/** Error that carries an HTTP status so route handlers can map it directly. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}
