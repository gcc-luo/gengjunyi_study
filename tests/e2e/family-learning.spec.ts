import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Page, type Route } from '@playwright/test';

type ChildRecord = { id: string; name: string; avatar: string; grade: string; status: 'ACTIVE'; createdAt: string };
type CourseRecord = {
  id: string;
  title: string;
  subjectId: string;
  description: string;
  ageRange: string;
  cover: { style: string; colors: string[] };
  status: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED';
  createdAt: string;
  updatedAt: string;
  videos: Array<{ id: string; courseId: string; title: string; fileName: string; durationMs: number; status: string; sortOrder: number; createdAt: string }>;
};

class FamilyApiStub {
  readonly media = readFileSync(path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'valid-h264-aac.mp4'));
  readonly requests: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
  readonly children: ChildRecord[] = [
    { id: 'child-brother', name: '哥哥', avatar: '🧑', grade: '一年级', status: 'ACTIVE', createdAt: '2026-09-01T00:00:00.000Z' },
    { id: 'child-sister', name: '妹妹', avatar: '👧', grade: '大班', status: 'ACTIVE', createdAt: '2026-09-02T00:00:00.000Z' },
  ];
  courses: CourseRecord[] = [];
  activeChildId: string | null = null;
  authenticated = true;
  readonly uploads = new Map<string, { courseId: string; fileName: string; sizeBytes: number; partSizeBytes: number; uploaded: boolean }>();
  readonly progress = new Map<string, { positionMs: number; maxProgressPercent: number; completed: boolean; updatedAt: string }>();
  readonly events: Array<{ id: string; childId: string; videoId: string; effectiveWatchSeconds: number; occurredAt: string }> = [];
  readonly favorites = new Set<string>();

  private readonly origin = 'http://127.0.0.1:5174';

  async install(page: Page) {
    await page.route('**/api/**', async (route) => this.handleApi(route));
    await page.route('http://minio.test/**', async (route) => this.handleMinio(route));
  }

  private session() {
    return this.authenticated
      ? { authenticated: true, admin: { id: 'parent-1', email: 'parent@example.test' }, activeChildId: this.activeChildId, activeChild: this.children.find((child) => child.id === this.activeChildId) ?? null, csrfToken: 'e2e-csrf' }
      : { authenticated: false, activeChildId: null, csrfToken: 'e2e-csrf' };
  }

  private coursePayload(course: CourseRecord) {
    return { ...course, videos: course.videos };
  }

  private recordItems(childId?: string) {
    return this.events.filter((event) => !childId || event.childId === childId).map((event) => {
      const video = this.courses.flatMap((course) => course.videos).find((item) => item.id === event.videoId);
      const course = this.courses.find((item) => item.id === video?.courseId);
      const progress = this.progress.get(`${event.childId}:${event.videoId}`);
      return {
        ...event,
        child: this.children.find((child) => child.id === event.childId),
        video: { id: event.videoId, title: video?.title ?? '视频', durationMs: video?.durationMs ?? null },
        course: course ? { id: course.id, title: course.title, subjectId: course.subjectId, subject: { slug: course.subjectId, name: course.subjectId === 'science' ? '科学' : '数学' } } : null,
        progress: progress ?? null,
      };
    }).reverse();
  }

  private overview() {
    const relevant = this.events.filter((event) => !this.activeChildId || event.childId === this.activeChildId);
    const watchedSeconds = relevant.reduce((sum, event) => sum + event.effectiveWatchSeconds, 0);
    return {
      totals: { children: this.children.length, courses: this.courses.filter((course) => course.status === 'PUBLISHED').length, readyVideos: this.courses.flatMap((course) => course.videos).filter((video) => video.status === 'READY' && this.courses.find((course) => course.id === video.courseId)?.status === 'PUBLISHED').length, watchedSeconds, completedVideos: [...this.progress.values()].filter((item) => item.completed).length },
      today: { watchedSeconds, events: relevant.length },
      week: { watchedSeconds, startsAt: '2026-09-14T00:00:00.000Z' },
      dailyActivity: [], recentActivity: [], continueLearning: [],
    };
  }

  private async handleApi(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    let body: Record<string, unknown> = {};
    try { body = request.postDataJSON() as Record<string, unknown> ?? {}; } catch { /* GET or empty body */ }
    this.requests.push({ path: url.pathname, method, body });
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });

    if (url.pathname === '/api/auth/session' && method === 'GET') return json(this.session());
    if (url.pathname === '/api/auth/active-child' && method === 'PUT') {
      this.activeChildId = String(body.childId);
      const child = this.children.find((item) => item.id === this.activeChildId);
      return json({ activeChildId: this.activeChildId, activeChild: child ? { id: child.id, name: child.name } : null });
    }
    if (url.pathname === '/api/children' && method === 'GET') return json(this.children);
    if (url.pathname === '/api/courses' && method === 'GET') return json(this.courses.map((course) => this.coursePayload(course)));
    if (url.pathname === '/api/courses' && method === 'POST') {
      const now = new Date().toISOString();
      const course: CourseRecord = { id: 'course-e2e', title: String(body.title), subjectId: String(body.subjectId), description: String(body.description ?? ''), ageRange: String(body.ageRange ?? ''), cover: { style: String(body.coverStyle ?? 'sunrise'), colors: ['#37A7E8', '#B5ECFF'] }, status: 'DRAFT', createdAt: now, updatedAt: now, videos: [] };
      this.courses.push(course);
      return json(this.coursePayload(course), 201);
    }
    const courseMatch = url.pathname.match(/^\/api\/courses\/([^/]+)$/u);
    if (courseMatch && method === 'GET') {
      const course = this.courses.find((item) => item.id === courseMatch[1]);
      return course ? json(this.coursePayload(course)) : json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    }
    const uploadCreateMatch = url.pathname.match(/^\/api\/courses\/([^/]+)\/uploads$/u);
    if (uploadCreateMatch && method === 'POST') {
      const uploadId = 'upload-e2e';
      this.uploads.set(uploadId, { courseId: uploadCreateMatch[1], fileName: String(body.fileName), sizeBytes: Number(body.sizeBytes), partSizeBytes: 16 * 1024 * 1024, uploaded: false });
      return json({ uploadId, partCount: 1, partSizeBytes: 16 * 1024 * 1024 }, 201);
    }
    const uploadStatusMatch = url.pathname.match(/^\/api\/uploads\/([^/]+)$/u);
    if (uploadStatusMatch && method === 'GET') {
      const upload = this.uploads.get(uploadStatusMatch[1]);
      return upload ? json({ uploadId: uploadStatusMatch[1], status: 'ACTIVE', partCount: 1, partSizeBytes: upload.partSizeBytes, parts: upload.uploaded ? [{ partNumber: 1, size: upload.sizeBytes }] : [] }) : json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    }
    const partUrlMatch = url.pathname.match(/^\/api\/uploads\/([^/]+)\/parts\/1\/url$/u);
    if (partUrlMatch && method === 'POST') return json({ alreadyUploaded: false, partNumber: 1, url: `http://minio.test/upload/${partUrlMatch[1]}/1?signature=e2e` });
    const completeMatch = url.pathname.match(/^\/api\/uploads\/([^/]+)\/complete$/u);
    if (completeMatch && method === 'POST') {
      const upload = this.uploads.get(completeMatch[1]);
      const course = this.courses.find((item) => item.id === upload?.courseId);
      if (!upload || !course) return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
      const video = { id: 'video-e2e', courseId: course.id, title: upload.fileName.replace(/\.mp4$/iu, ''), fileName: upload.fileName, durationMs: 20_000, status: 'READY', sortOrder: 0, createdAt: new Date().toISOString() };
      course.videos = [video];
      course.updatedAt = new Date().toISOString();
      return json({ status: 'READY', video });
    }
    const courseAction = url.pathname.match(/^\/api\/courses\/([^/]+)\/(publish|unpublish)$/u);
    if (courseAction && method === 'POST') {
      const course = this.courses.find((item) => item.id === courseAction[1]);
      if (!course) return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
      course.status = courseAction[2] === 'publish' ? 'PUBLISHED' : 'UNPUBLISHED';
      course.updatedAt = new Date().toISOString();
      return json(this.coursePayload(course));
    }
    if (url.pathname === '/api/storage' && method === 'GET') return json({ usedBytes: '0', reservedBytes: '0', totalBytes: '100000000000', availableBytes: '100000000000', warning: null });
    if (url.pathname === '/api/overview' && method === 'GET') return json(this.overview());
    if (url.pathname === '/api/records' && method === 'GET') {
      const items = this.recordItems(this.activeChildId ?? undefined);
      return json({ total: items.length, limit: 100, offset: 0, items });
    }
    const favoritesMatch = url.pathname.match(/^\/api\/children\/([^/]+)\/favorites$/u);
    if (favoritesMatch && method === 'GET') {
      const childId = favoritesMatch[1];
      const videoIds = [...this.favorites].filter((key) => key.startsWith(`${childId}:`)).map((key) => key.slice(childId.length + 1));
      return json(videoIds.map((videoId) => {
        const video = this.courses.flatMap((course) => course.videos).find((item) => item.id === videoId);
        const course = this.courses.find((item) => item.id === video?.courseId);
        return { id: `${childId}:${videoId}`, childId, videoId, createdAt: new Date().toISOString(), video: { course: { id: course?.id } } };
      }));
    }
    if (favoritesMatch && method === 'PUT') { this.favorites.add(`${favoritesMatch[1]}:${String(body.videoId)}`); return json({}); }
    if (favoritesMatch && method === 'DELETE') { this.favorites.delete(`${favoritesMatch[1]}:${String(body.videoId)}`); return route.fulfill({ status: 204 }); }
    const playbackMatch = url.pathname.match(/^\/api\/videos\/([^/]+)\/playback$/u);
    if (playbackMatch && method === 'POST') return json({ url: `http://minio.test/media/${playbackMatch[1]}.mp4?signature=e2e`, expiresInSeconds: 7200 });
    const progressMatch = url.pathname.match(/^\/api\/children\/([^/]+)\/videos\/([^/]+)\/progress$/u);
    if (progressMatch && method === 'PUT') {
      const [, childId, videoId] = progressMatch;
      const previous = this.progress.get(`${childId}:${videoId}`);
      const updatedAt = new Date().toISOString();
      const progress = { positionMs: Number(body.positionMs), maxProgressPercent: Math.max(previous?.maxProgressPercent ?? 0, Math.floor(Number(body.positionMs) / 200)), completed: Boolean(previous?.completed || Number(body.positionMs) >= 18_000), updatedAt };
      this.progress.set(`${childId}:${videoId}`, progress);
      this.events.push({ id: `event-${this.events.length + 1}`, childId, videoId, effectiveWatchSeconds: Math.max(1, Number(body.watchedSeconds) || 1), occurredAt: updatedAt });
      return json({ progress: { childId, videoId, ...progress }, recordedWatchedSeconds: 1 });
    }
    return json({ error: { code: 'NOT_FOUND', message: `No test handler for ${method} ${url.pathname}` } }, 404);
  }

  private async handleMinio(route: Route) {
    const request = route.request();
    const method = request.method().toUpperCase();
    const corsHeaders = {
      'Access-Control-Allow-Origin': this.origin,
      'Access-Control-Allow-Methods': 'GET, HEAD, PUT, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, range, x-amz-content-sha256, x-amz-date',
      'Access-Control-Expose-Headers': 'ETag, Accept-Ranges, Content-Length, Content-Range',
    };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders });
    if (method === 'PUT') return route.fulfill({ status: 200, headers: { ...corsHeaders, ETag: '"e2e-part"' } });
    if (method === 'GET' || method === 'HEAD') {
      const range = request.headers().range;
      if (range) {
        const match = range.match(/^bytes=(\d+)-(\d*)$/u);
        if (match) {
          const start = Number(match[1]);
          const end = Math.min(match[2] ? Number(match[2]) : this.media.length - 1, this.media.length - 1);
          return route.fulfill({ status: 206, headers: { ...corsHeaders, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${this.media.length}`, 'Content-Length': String(end - start + 1) }, body: method === 'HEAD' ? undefined : this.media.subarray(start, end + 1) });
        }
      }
      return route.fulfill({ status: 200, headers: { ...corsHeaders, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': String(this.media.length) }, body: method === 'HEAD' ? undefined : this.media });
    }
    return route.fulfill({ status: 405, headers: corsHeaders });
  }
}

test('family can enter directly, manage and learn with child-isolated progress', async ({ page }) => {
  const family = new FamilyApiStub();
  await family.install(page);

  await page.goto('/');
  await expect(page.getByRole('link', { name: /儿童学习空间/ })).toHaveAttribute('href', '/child/select');
  await expect(page.getByRole('link', { name: /家长管理中心/ })).toHaveAttribute('href', '/parent/overview');
  await page.getByRole('link', { name: /儿童学习空间/ }).click();
  await expect(page.getByRole('heading', { name: '谁来学习？' })).toBeVisible();

  await page.goto('/');
  await page.getByRole('link', { name: /家长管理中心/ }).click();
  await expect(page.getByRole('heading', { name: '概览' })).toBeVisible();

  await page.goto('/parent/courses?new=1');
  await page.getByLabel('课程名称').fill('家庭科学实验课');
  await page.getByLabel('课程学科').selectOption('science');
  await page.getByLabel('适龄范围').fill('6-9岁');
  await page.getByRole('button', { name: '保存课程' }).click();
  await expect(page.getByRole('heading', { name: '课程管理' })).toBeVisible();

  await page.goto('/parent/uploads');
  await page.getByLabel('所属课程').selectOption({ label: '家庭科学实验课' });
  await page.locator('input[type="file"]').setInputFiles({ name: 'demo-lesson.mp4', mimeType: 'video/mp4', buffer: family.media });
  const uploadTask = page.locator('.upload-task').filter({ hasText: 'demo-lesson.mp4' });
  await expect(uploadTask).toContainText('已完成', { timeout: 15_000 });
  expect(family.requests.some((request) => request.path === '/api/uploads/upload-e2e/parts/1/url' && request.method === 'POST')).toBe(true);

  await page.goto('/parent/courses');
  const courseRow = page.locator('tr').filter({ hasText: '家庭科学实验课' });
  await courseRow.getByRole('button', { name: '发布' }).click();
  await expect(courseRow).toContainText('已发布');

  await page.goto('/child/select');
  await page.getByRole('button', { name: '选择哥哥' }).click();
  await expect(page.getByRole('heading', { name: '你好，哥哥' })).toBeVisible();
  await page.getByRole('link', { name: '家庭科学实验课' }).click();
  await expect(page.getByRole('heading', { name: '家庭科学实验课' })).toBeVisible();
  await page.getByRole('link', { name: /demo-lesson/ }).click();

  const player = page.locator('video[aria-label="视频播放器"]');
  await expect(player).toHaveAttribute('src', /minio\.test\/media\/video-e2e\.mp4/);
  await expect(page.getByRole('heading', { name: 'demo-lesson' })).toBeVisible();
  await player.evaluate((element) => {
    Object.defineProperty(element, 'currentTime', { configurable: true, value: 1 });
    element.dispatchEvent(new Event('play'));
    element.dispatchEvent(new Event('timeupdate'));
    element.dispatchEvent(new Event('pause'));
  });
  await expect.poll(() => family.requests.filter((request) => request.path === '/api/children/child-brother/videos/video-e2e/progress' && request.method === 'PUT').length).toBeGreaterThan(0);
  expect(family.progress.get('child-brother:video-e2e')).toMatchObject({ positionMs: 1000, completed: false });

  await page.goto('/child/select');
  await page.getByRole('button', { name: '选择妹妹' }).click();
  await expect(page.getByRole('heading', { name: '你好，妹妹' })).toBeVisible();
  await page.getByRole('link', { name: '家庭科学实验课' }).click();
  const sisterVideo = page.locator('.catalog-row').filter({ hasText: 'demo-lesson' });
  await expect(sisterVideo).toContainText('开始学习');
  await expect(sisterVideo).not.toContainText('继续学习');
});

test('keeps the complete video frame inside a narrow mobile player', async ({ page }) => {
  await page.setViewportSize({ width: 319, height: 800 });
  const family = new FamilyApiStub();
  family.authenticated = true;
  family.activeChildId = 'child-brother';
  family.courses = [{
    id: 'course-mobile', title: '手机播放测试', subjectId: 'science', description: '', ageRange: '6-9岁',
    cover: { style: 'sunrise', colors: ['#37A7E8', '#B5ECFF'] }, status: 'PUBLISHED',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z',
    videos: [{ id: 'video-mobile', courseId: 'course-mobile', title: '横屏视频', fileName: 'landscape.mp4', durationMs: 20_000, status: 'READY', sortOrder: 0, createdAt: '2026-09-01T00:00:00.000Z' }],
  }];
  await family.install(page);

  await page.goto('/child/watch/video-mobile');
  await expect(page.locator('video[aria-label="视频播放器"]')).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    shellWidth: document.querySelector('.child-shell')!.getBoundingClientRect().width,
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    playerWidth: document.querySelector('.watch-player')!.getBoundingClientRect().width,
    screenWidth: document.querySelector('.watch-screen-live')!.getBoundingClientRect().width,
  }));

  expect(dimensions.shellWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  expect(dimensions.pageWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  expect(dimensions.screenWidth).toBeLessThanOrEqual(dimensions.playerWidth + 1);
});
