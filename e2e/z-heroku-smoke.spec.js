import { test, expect } from '@playwright/test';

test('deployment smoke covers persistence-critical public and owner flows', async ({ page }) => {
  // Keep this deployment-specific flow independent from the login attempts in
  // the broader browser suite while still exercising the durable limiter.
  const proxyHeaders = { 'X-Forwarded-For': '198.51.100.77' };
  const ready = await page.request.get('/readyz');
  expect(ready.ok()).toBe(true);
  expect(await ready.json()).toMatchObject({ status: 'ready', schema_version: 9 });

  for (const path of ['/', '/?shell=world', '/blogs', '/blog/hello-world']) {
    const response = await page.request.get(path);
    expect(response.ok(), `${path} should load`).toBe(true);
  }

  const resume = await page.request.get('/resume.pdf');
  expect(resume.ok()).toBe(true);
  expect((await resume.body()).subarray(0, 5).toString()).toBe('%PDF-');

  const login = await page.request.post('/api/v1/admin/login', {
    headers: proxyHeaders,
    data: { passphrase: 'local-e2e-passphrase-only' },
  });
  expect(login.ok()).toBe(true);
  const { csrf_token: csrf } = await login.json();

  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const upload = await page.request.post('/api/v1/admin/media', {
    headers: { 'X-CSRF-Token': csrf },
    multipart: {
      alt_text: 'One-pixel deployment smoke image',
      file: { name: 'smoke.png', mimeType: 'image/png', buffer: pixel },
    },
  });
  expect(upload.status()).toBe(201);
  const uploaded = await upload.json();
  const served = await page.request.get(uploaded.url);
  expect(served.ok()).toBe(true);
  expect(await served.body()).toEqual(pixel);

  const recovered = await page.request.post('/api/v1/admin/recover', {
    headers: proxyHeaders,
    data: {
      recovery_token: 'local-e2e-recovery-token-only',
      new_passphrase: 'local-e2e-recovered-passphrase',
    },
  });
  expect(recovered.ok()).toBe(true);
  expect((await page.request.post('/api/v1/admin/login', {
    headers: proxyHeaders,
    data: { passphrase: 'local-e2e-passphrase-only' },
  })).status()).toBe(401);
  expect((await page.request.post('/api/v1/admin/login', {
    headers: proxyHeaders,
    data: { passphrase: 'local-e2e-recovered-passphrase' },
  })).ok()).toBe(true);
});
