/**
 * The API HTTP layer for the Branch POS.
 *
 * Pure helpers (`joinUrl`, `parseApiError`) are unit-tested; `ApiClient` wraps
 * `fetch` with the base URL, bearer token and the backend's single error
 * envelope, so screens branch on a stable `code`, never a raw message.
 */
export interface ApiErrorShape {
  statusCode: number;
  code: string;
  message: string;
  details?: string[];
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: string[];
  constructor(shape: ApiErrorShape) {
    super(shape.message);
    this.name = "ApiError";
    this.statusCode = shape.statusCode;
    this.code = shape.code;
    this.details = shape.details;
  }
  get isNetwork(): boolean {
    return this.code === "NETWORK";
  }
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function parseApiError(status: number, body: unknown): ApiErrorShape {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.code === "string" && typeof b.message === "string") {
      return {
        statusCode: typeof b.statusCode === "number" ? b.statusCode : status,
        code: b.code,
        message: b.message,
        details: Array.isArray(b.details) ? (b.details as string[]) : undefined,
      };
    }
  }
  return {
    statusCode: status,
    code: status >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED",
    message: "Something went wrong. Please try again.",
  };
}

export interface RequestOptions {
  // PUT is here because the receipt-template override is a replace, not a
  // merge — the backend models it as one, and a client that had to reach for
  // PATCH would be describing a different operation.
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  public?: boolean;
  /**
   * Makes the write safe to retry. The backend runs the work once per key and
   * replays the stored response, so a counter on flaky branch wifi cannot
   * create a second order by sending the same one twice.
   *
   * One value per attempt at the thing, not per HTTP call.
   */
  idempotencyKey?: string;
  /**
   * Return the raw body instead of parsing it.
   *
   * For the one endpoint that is not JSON: the QZ signing certificate, which
   * is a PEM handed to QZ Tray verbatim. Parsed as JSON it comes back
   * `undefined`, and the failure surfaces as printing quietly reverting to
   * prompting.
   */
  text?: boolean;
}

/**
 * How long to wait for the API before giving up.
 *
 * Without a deadline a hung connection — a counter on failing branch wifi, a
 * driver in a lift — leaves the screen spinning for ever with no error and no
 * retry. `fetch` has no default timeout of its own, so the request simply never
 * settles. 15 seconds is longer than any healthy call here and short enough
 * that a person has not yet decided the app is broken.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Runs `fetch` with a deadline, and reports a timeout as the same NETWORK
 * failure every screen already handles — "no connection" is exactly what a
 * request that never answered means to the person waiting.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: init.signal ?? controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null,
    private readonly onUnauthorized: () => void,
  ) {}

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
      Accept: options.text ? "text/plain" : "application/json",
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const token = options.public ? null : this.getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }

    let res: Response;
    try {
      res = await fetchWithTimeout(joinUrl(this.baseUrl, path), {
        method: options.method ?? "GET",
        headers,
        body:
          options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch (e) {
      throw new ApiError({
        statusCode: 0,
        code: "NETWORK",
        message: networkErrorMessage(e),
      });
    }

    if (res.status === 401 && !options.public) {
      this.onUnauthorized();
    }
    if (res.status === 204) {
      return undefined as T;
    }
    const text = await res.text();
    const json: unknown = text ? safeParse(text) : undefined;
    if (!res.ok) {
      throw new ApiError(parseApiError(res.status, json));
    }
    return (options.text ? text : json) as T;
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function networkErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : "";
  if (/network request failed/i.test(raw)) {
    return "Could not reach the server. Check your internet connection and try again.";
  }
  if (
    /cors/i.test(raw) ||
    /access-control/i.test(raw) ||
    /blocked/i.test(raw)
  ) {
    return "The server refused the request (CORS). Please contact support.";
  }
  if (/abort/i.test(raw) || /timeout/i.test(raw)) {
    return "The request timed out. Please try again.";
  }
  return "Could not reach the server. Check your internet connection and try again.";
}
