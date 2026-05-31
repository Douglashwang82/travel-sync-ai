/**
 * The error envelope every `/api/app/*` route returns:
 * `{ error: string, code: string, details?: unknown }`. Both web and mobile
 * normalise failures into this single shape.
 */
export interface ApiErrorBody {
  error: string;
  code: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** True for the 401s that should trigger a token refresh / re-auth on mobile. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}
