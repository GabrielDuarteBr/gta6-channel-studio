import { expect, test } from '@playwright/test';

test('no celular, o menu abre como gaveta e navega', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir menu' }).click();
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Configurações' })
    .click();
  await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
