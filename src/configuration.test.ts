import playwrightConfig from '../playwright.config';

it('keeps Playwright tests isolated from Vitest source tests', () => {
  expect(playwrightConfig.testDir).toBe('./tests/e2e');
});
