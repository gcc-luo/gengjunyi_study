import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, setCsrfToken } from './api-client';

describe('same-origin API client', () => {
  beforeEach(() => {
    setCsrfToken(null);
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends same-origin cookies and the current CSRF token for writes', async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    setCsrfToken('csrf-value');

    await expect(apiRequest('/api/children', { method: 'POST', body: JSON.stringify({ name: 'Mina' }) })).resolves.toEqual({ ok: true });

    const [, request] = fetchMock.mock.calls[0];
    expect(request?.credentials).toBe('same-origin');
    expect(new Headers(request?.headers).get('x-csrf-token')).toBe('csrf-value');
  });

  it('normalizes structured API errors', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: '登录信息不正确' } }), { status: 401, headers: { 'content-type': 'application/json' } }));

    await expect(apiRequest('/api/auth/login', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      name: 'ApiError', status: 401, code: 'INVALID_CREDENTIALS', message: '登录信息不正确',
    });
  });

  it('handles empty 204 responses and non-JSON failures safely', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(apiRequest('/api/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('upstream unavailable', { status: 502 }));
    await expect(apiRequest('/api/overview')).rejects.toBeInstanceOf(ApiError);
  });

  it('never forwards the session CSRF token to an external host', async () => {
    setCsrfToken('secret-csrf');

    await expect(apiRequest('https://evil.example/api/steal', { method: 'POST', body: '{}' })).rejects.toMatchObject({ code: 'INVALID_API_URL' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
