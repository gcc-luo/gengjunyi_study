import { describe, expect, it, vi } from 'vitest';
import { makePrisma, parentHeaders, useRouteApp } from './route-test-utils';

describe('family settings API', () => {
  it('returns the default child-catalog preference and persists updates', async () => {
    const { prisma, raw } = makePrisma();
    let setting: { id: string; adminUserId: string; key: string; value: string } | undefined;
    (raw as any).parentSetting = {
      findMany: vi.fn(async () => setting ? [setting] : []),
      upsert: vi.fn(async ({ create, update }: any) => {
        setting = setting ? { ...setting, ...update } : { id: 'setting-1', ...create };
        return setting;
      }),
    };
    const app = useRouteApp(prisma);

    const initial = await app.inject({ method: 'GET', url: '/api/settings', headers: parentHeaders });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toEqual({ freeChoice: true });

    const updated = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: parentHeaders,
      payload: { freeChoice: false },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({ freeChoice: false });
  });
});
