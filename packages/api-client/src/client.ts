import type { ApiErrorBody, ErrorCode, LoginResponse } from '@bookstall/shared';

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode | 'NETWORK' | 'INTERNAL' | string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ClientOptions {
  /** e.g. "/api/v1" in the browser, "https://books.example.org/api/v1" in the app. */
  baseUrl: string;
  platform: 'web' | 'mobile';
  getAccessToken: () => string | null;
  setAccessToken: (token: string | null) => void;
  /** mobile: the refresh token kept in secure storage (web uses an httpOnly cookie) */
  getRefreshToken?: () => string | null | Promise<string | null>;
  /** called with every successful login/refresh so the host can persist a rotated refresh token */
  onSession?: (res: LoginResponse) => void;
  /** refresh failed or the session was revoked */
  onLogout: () => void;
  fetchImpl?: typeof fetch;
}

export type Query = Record<string, string | number | boolean | null | undefined | Array<string | number>>;

export interface RequestOptions {
  query?: Query;
  /** JSON body, or a FormData for uploads */
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** do not try to refresh and retry on 401 (login, refresh, public pages) */
  anonymous?: boolean;
}

export function buildQuery(query?: Query): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) for (const x of v) p.append(k, String(x));
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export interface ApiClient {
  readonly options: ClientOptions;
  url(path: string, query?: Query): string;
  /** `Authorization` header for the current access token (for downloads done outside this client). */
  authHeaders(): Record<string, string>;
  request<T>(method: string, path: string, opts?: RequestOptions): Promise<T>;
  /** Fetches a file (PDF, XLSX, image) with auth. */
  blob(method: string, path: string, opts?: RequestOptions): Promise<Blob>;
  /** Refreshes the session once (single-flight). Returns the new access token or null. */
  refresh(): Promise<string | null>;
}

export function createApiClient(options: ClientOptions): ApiClient {
  const f = options.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let refreshing: Promise<string | null> | null = null;

  const url = (path: string, query?: Query) => `${options.baseUrl.replace(/\/+$/, '')}${path}${buildQuery(query)}`;
  const authHeaders = (): Record<string, string> => {
    const t = options.getAccessToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  };

  async function send(method: string, path: string, opts: RequestOptions): Promise<Response> {
    const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
    const headers: Record<string, string> = {
      Accept: 'application/json, application/pdf, */*',
      ...(opts.body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.anonymous ? {} : authHeaders()),
      ...opts.headers,
    };
    try {
      return await f(url(path, opts.query), {
        method,
        headers,
        body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
        credentials: options.platform === 'web' ? 'include' : 'omit',
        signal: opts.signal,
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      throw new ApiError('NETWORK', 'Cannot reach the server. Check your internet connection.', 0);
    }
  }

  async function toError(res: Response): Promise<ApiError> {
    let body: Partial<ApiErrorBody> | undefined;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      /* not JSON */
    }
    return new ApiError(body?.error?.code ?? (res.status >= 500 ? 'INTERNAL' : 'UNKNOWN'), body?.error?.message ?? `Request failed (${res.status})`, res.status, body?.error?.details);
  }

  async function refresh(): Promise<string | null> {
    refreshing ??= (async () => {
      try {
        const refreshToken = options.platform === 'mobile' ? await options.getRefreshToken?.() : undefined;
        if (options.platform === 'mobile' && !refreshToken) return null;
        const res = await send('POST', '/auth/refresh', { anonymous: true, body: refreshToken ? { refreshToken } : {} });
        if (!res.ok) return null;
        const data = (await res.json()) as LoginResponse;
        options.setAccessToken(data.accessToken);
        options.onSession?.(data);
        return data.accessToken;
      } catch {
        return null;
      } finally {
        setTimeout(() => (refreshing = null), 0);
      }
    })();
    return refreshing;
  }

  async function execute(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
    let res = await send(method, path, opts);
    if (res.status === 401 && !opts.anonymous) {
      const code = (await res.clone().json().catch(() => null))?.error?.code;
      if (code === 'UNAUTHENTICATED') {
        if (await refresh()) res = await send(method, path, opts);
        if (res.status === 401) {
          options.onLogout();
          throw await toError(res);
        }
      }
    }
    if (!res.ok) throw await toError(res);
    return res;
  }

  return {
    options,
    url,
    authHeaders,
    refresh,
    async request<T>(method: string, path: string, opts?: RequestOptions) {
      const res = await execute(method, path, opts);
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    },
    async blob(method, path, opts) {
      return (await execute(method, path, opts)).blob();
    },
  };
}
