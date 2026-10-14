// One error type for every Studio call. Messages stay short and never contain tokens.
export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'parse' | 'aborted';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly currentRevision?: number;

  constructor(
    kind: ApiErrorKind,
    message: string,
    extra: { status?: number; code?: string; currentRevision?: number } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = extra.status;
    this.code = extra.code;
    this.currentRevision = extra.currentRevision;
  }

  /** The machine did not answer: state unknown, never "stopped". */
  get offline() {
    return this.kind === 'network' || this.kind === 'timeout' || this.code === 'relay_unreachable';
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

export function errorCode(error: unknown): string | undefined {
  return isApiError(error) ? error.code : undefined;
}
