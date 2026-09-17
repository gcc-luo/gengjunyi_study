import { describe, expect, it } from 'vitest';
import { makePrisma, parentHeaders, useRouteApp, videoRecord } from './route-test-utils';

describe('parent video management', () => {
  it('allows a parent to rename an existing video without changing its storage object', async () => {
    const video = videoRecord();
    const { prisma, state } = makePrisma({ videos: [video] });
    const app = useRouteApp(prisma);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/videos/video-1',
      headers: parentHeaders,
      payload: { title: 'Updated title' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: 'video-1', title: 'Updated title' });
    expect(state.videos[0]?.objectKey).toBe(video.objectKey);
  });

  it('rejects blank titles and unknown video IDs', async () => {
    const { prisma } = makePrisma({ videos: [videoRecord()] });
    const app = useRouteApp(prisma);

    const invalid = await app.inject({ method: 'PATCH', url: '/api/videos/video-1', headers: parentHeaders, payload: { title: '  ' } });
    const missing = await app.inject({ method: 'PATCH', url: '/api/videos/missing', headers: parentHeaders, payload: { title: 'Name' } });

    expect(invalid.statusCode).toBe(400);
    expect(missing.statusCode).toBe(404);
  });
});
