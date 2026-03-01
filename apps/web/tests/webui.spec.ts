import { expect, test } from '@playwright/test';

test('renders app shell and tabs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Animus')).toBeVisible();
  await expect(page.getByRole('button', { name: /Chats|对话/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Settings|设置/ })).toBeVisible();
});

test('opens and closes command palette', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+K');
  await expect(page.getByRole('dialog', { name: /Command|命令/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /Command|命令/ })).toHaveCount(0);
});

test('settings tab shows config editor', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Settings|设置/ }).click();
  await expect(page.locator('.settings-title').filter({ hasText: /Agent config|Agent 配置/ })).toBeVisible();
  await expect(page.locator('.monaco-editor')).toBeVisible();
});

test('apps tab shows runtime section', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Apps|应用/ }).click();
  await expect(page.getByText(/Runtime|运行时/)).toBeVisible();
  await expect(page.getByText(/Integrations|集成/)).toBeVisible();
});

test('skills tab has searchable list', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Skills|技能/ }).click();
  await expect(page.getByPlaceholder(/Search skills|搜索技能/)).toBeVisible();
});

test('agent query param controls active conversation type label', async ({ page }) => {
  await page.goto('/?agent=acp');
  await expect(page.locator('.app-subtitle')).toContainText(/ACP/);
});

test('agent selector switches type and updates URL', async ({ page }) => {
  await page.goto('/');
  await page.locator('.header-agent-select select').selectOption('gemini');
  await expect(page.locator('.app-subtitle')).toContainText(/Gemini/);
  await expect(page).toHaveURL(/agent=gemini/);
});

test('non-codex agent shows compatibility adapter profile', async ({ page }) => {
  await page.goto('/?agent=acp');
  await page.getByRole('button', { name: /Settings|设置/ }).click();
  await expect(page.getByText(/Adapter profile|适配器模式/)).toBeVisible();
  await expect(page.getByText(/Compatibility|兼容/)).toBeVisible();
});

test('runtime settings show adapter method resolution status', async ({ page }) => {
  await page.goto('/?agent=acp');
  await page.getByRole('button', { name: /Settings|设置/ }).click();
  await expect(page.getByText(/Method resolution|方法解析/)).toBeVisible();
  await expect(page.getByTestId('adapter-method-startTurn')).toBeVisible();
  await expect(page.getByTestId('adapter-method-value-startTurn')).toContainText(/Unresolved|未解析/);
});

test('settings include workspace management sections', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Settings|设置/ }).click();
  await expect(page.locator('.settings-section-title').filter({ hasText: /Worktrees|工作树/ })).toBeVisible();
  await expect(page.locator('.settings-section-title').filter({ hasText: /Local environments|本地环境/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Add project|添加项目/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Create worktree|创建工作树/ })).toBeVisible();
});

test('chat composer shows per-thread workspace selector', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/Workspace|工作区目录/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Choose directory|选择目录/ })).toBeVisible();
});
