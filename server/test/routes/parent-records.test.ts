import { afterEach, describe, expect, it } from 'vitest';
import { learningVideo, makeLearningHarness, parentHeaders } from './learning-test-utils';

describe('parent records API', () => {
  const apps: Array<ReturnType<typeof makeLearningHarness>['app']> = [];
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

  it('returns paged learning activity with family metadata and progress', async () => {
    const harness = makeLearningHarness({
      activeChildId: null,
      progress: [{ id: 'progress-1', childId: 'child-1', videoId: 'video-1', positionMs: 40_000, maxProgressPercent: 40, completed: false, updatedAt: new Date() }],
      events: [
        { id: 'event-1', childId: 'child-1', videoId: 'video-1', watchedSeconds: 12, occurredAt: new Date('2026-09-16T08:00:00.000Z') },
        { id: 'event-2', childId: 'child-2', videoId: 'video-1', watchedSeconds: 20, occurredAt: new Date('2026-09-16T09:00:00.000Z') },
      ],
    });
    apps.push(harness.app);

    const response = await harness.app.inject({ method: 'GET', url: '/api/records?childId=child-1&limit=10', headers: parentHeaders });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      total: 1,
      items: [{
        id: 'event-1', childId: 'child-1', effectiveWatchSeconds: 12,
        child: { id: 'child-1', name: 'Mina' },
        video: { id: learningVideo.id, title: 'Numbers' },
        course: { id: 'course-1', subjectId: 'math' },
        progress: { maxProgressPercent: 40, completed: false },
      }],
    });
  });

  it('keeps unfiltered parent records family-wide even when a child session is active', async () => {
    const harness = makeLearningHarness({ activeChildId: 'child-1' });
    apps.push(harness.app);

    const response = await harness.app.inject({ method: 'GET', url: '/api/records', headers: parentHeaders });

    expect(response.statusCode).toBe(200);
    expect(response.json().total).toBe(0);
  });

  it('allows a parent to explicitly filter records for another active child', async () => {
    const harness = makeLearningHarness({
      activeChildId: 'child-1',
      events: [{ id: 'event-2', childId: 'child-2', videoId: 'video-1', watchedSeconds: 15, occurredAt: new Date() }],
    });
    apps.push(harness.app);

    const response = await harness.app.inject({ method: 'GET', url: '/api/records?childId=child-2', headers: parentHeaders });

    expect(response.statusCode).toBe(200);
    expect(response.json().total).toBe(1);
  });

  it('rejects malformed date filters', async () => {
    const harness = makeLearningHarness({ activeChildId: null });
    apps.push(harness.app);

    const response = await harness.app.inject({ method: 'GET', url: '/api/records?from=yesterday', headers: parentHeaders });

    expect(response.statusCode).toBe(400);
  });
});
