import path from 'node:path';
import { test, expect } from '@playwright/test';

test('family learning main path keeps children progress isolated and history after offline', async ({ page }) => {
  const courseTitle = '家庭科学实验课';
  const fixturePath = path.join(process.cwd(), 'tests', 'fixtures', 'demo-lesson.mp4');

  await page.goto('/parent/overview');
  await expect(page.getByRole('heading', { name: '概览' })).toBeVisible();

  await page.getByRole('link', { name: '+ 新增课程' }).click();
  await page.getByLabel('课程名称').fill(courseTitle);
  await page.getByLabel('课程学科').selectOption('science');
  await page.getByLabel('适龄范围').fill('6-9岁');
  await page.getByRole('button', { name: '保存课程' }).click();
  await expect(page.getByRole('heading', { name: '课程管理' })).toBeVisible();

  await page.goto('/parent/uploads');
  await page.getByLabel('所属课程').selectOption({ label: courseTitle });
  await page.locator('input[type="file"]').setInputFiles(fixturePath);
  const uploadTask = page.locator('.upload-task').filter({ hasText: 'demo-lesson.mp4' });
  await expect(uploadTask).toContainText('已完成', { timeout: 10000 });

  await page.goto('/parent/courses');
  const courseRow = page.locator('tr').filter({ hasText: courseTitle });
  await expect(courseRow).toContainText('草稿');
  await courseRow.getByRole('button', { name: '发布' }).click();
  await expect(courseRow).toContainText('已发布');

  await page.goto('/child/select');
  await page.getByRole('button', { name: '选择哥哥' }).click();
  await expect(page.getByRole('heading', { name: '你好，哥哥' })).toBeVisible();

  const courseLink = page.getByRole('link', { name: courseTitle });
  await expect(courseLink).toBeVisible();
  await courseLink.click();
  await expect(page.getByRole('heading', { name: courseTitle })).toBeVisible();
  await page.getByRole('link', { name: /demo-lesson/ }).click();

  const playbackSlider = page.getByRole('slider', { name: '播放进度' });
  await expect(playbackSlider).toHaveAttribute('max', '180');
  await playbackSlider.fill('90');
  await expect(page.getByText(/正在学习 · 50%/)).toBeVisible();
  await page.getByRole('link', { name: '首页' }).click();
  const continueCard = page.locator('.continue-card');
  await expect(continueCard).toContainText('demo-lesson');

  await page.getByRole('link', { name: '继续观看' }).click();
  await page.getByRole('slider', { name: '播放进度' }).fill('162');
  await expect(page.getByText(/正在学习 · 90%/)).toBeVisible();
  await page.getByRole('link', { name: '首页' }).click();
  await expect(page.locator('.continue-card')).not.toContainText('demo-lesson');

  await page.getByRole('link', { name: '切换孩子' }).click();
  await page.getByRole('button', { name: '选择妹妹' }).click();
  await page.getByRole('link', { name: courseTitle }).click();
  const sisterVideoRow = page.locator('.catalog-row').filter({ hasText: 'demo-lesson' });
  await expect(sisterVideoRow).toContainText('开始学习');
  await expect(sisterVideoRow).not.toContainText('再看一次');

  await page.goto('/parent/courses');
  const publishedCourseRow = page.locator('tr').filter({ hasText: courseTitle });
  await publishedCourseRow.getByRole('button', { name: '下架' }).click();
  await expect(page.getByText(/学习记录会保留/)).toBeVisible();
  await page.getByRole('button', { name: '确认下架' }).click();
  await expect(publishedCourseRow).toContainText('已下架');

  await page.goto('/child/select');
  await page.getByRole('button', { name: '选择哥哥' }).click();
  await page.getByRole('link', { name: '课程' }).click();
  await expect(page.getByText(courseTitle)).not.toBeVisible();
  await page.getByRole('link', { name: '我的', exact: true }).click();
  await page.getByRole('link', { name: /学习记录/ }).click();
  await page.getByRole('tab', { name: '学习历史' }).click();
  await expect(page.getByTestId('records-history')).toContainText('demo-lesson');
});
