export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const AUTH_UNAUTHORIZED_EVENT = 'family-learning:unauthorized';
export const PARENT_LOCKED_EVENT = 'family-learning:parent-locked';
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

function normalizeError(status: number, body: unknown): ApiError {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = (body as { error?: { code?: unknown; message?: unknown } }).error;
    if (error && typeof error === 'object') {
      return new ApiError(
        status,
        typeof error.code === 'string' ? error.code : 'API_ERROR',
        typeof error.message === 'string' ? error.message : '请求未能完成',
      );
    }
  }
  return new ApiError(status, 'HTTP_ERROR', status >= 500 ? '服务暂时不可用，请稍后重试' : '请求未能完成');
}

export async function apiRequest<T = void>(path: string, init: RequestInit = {}): Promise<T> {
  const origin = typeof window === 'undefined' ? null : window.location.origin;
  if (origin) {
    try {
      const target = new URL(path, origin);
      if (target.origin !== origin || !target.pathname.startsWith('/api/')) {
        throw new ApiError(0, 'INVALID_API_URL', '只允许请求本应用的 API');
      }
    } catch (cause) {
      if (cause instanceof ApiError) throw cause;
      throw new ApiError(0, 'INVALID_API_URL', 'API 地址无效');
    }
  }
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('content-type') &&
    !(typeof FormData !== 'undefined' && init.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
    headers.set('x-csrf-token', csrfToken);
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, method, headers, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '无法连接到服务，请检查网络后重试');
  }

  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  let text: string;
  try { text = await response.text(); } catch { text = ''; }
  let body: unknown = text || undefined;
  if (contentType.includes('application/json') || /^[\[{]/u.test(text.trim())) {
    try { body = JSON.parse(text) as unknown; } catch { /* Keep the original response text for a safe generic error. */ }
  }
  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
    }
    if (response.status === 423 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(PARENT_LOCKED_EVENT));
    }
    throw normalizeError(response.status, body);
  }
  return body as T;
}
