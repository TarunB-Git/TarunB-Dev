import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });

test('owner PDF upload publishes the download without editing the abridged resume', async ({ page, request }) => {
  expect((await request.post('/api/v1/admin/resume-pdf', { multipart: { file: { name: 'test.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') } } })).status()).toBe(401);
  await page.goto('/admin');
  await page.locator('#pass').fill('local-e2e-passphrase-only');
  await page.locator('#login-btn').click();
  await expect(page.locator('#shell')).toBeVisible();
  const before = await page.request.get('/api/v1/content/resume').then(r => r.json());
  const pdf = execFileSync('python', ['-c', 'import sys; from server.resume import build_pdf; sys.stdout.buffer.write(build_pdf({"name":"Uploaded resume"}))']);
  await page.locator('nav button[data-p="resume"]').click();
  await page.locator('.pdf-file').setInputFiles({ name: 'full-resume.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.locator('.pdf-upload').click();
  await expect(page.locator('#p-resume .card').first().locator('[role="status"]')).toContainText('PDF published');
  expect(await page.request.get('/resume.pdf').then(r => r.body())).toEqual(pdf);
  expect(await page.request.get('/api/v1/content/resume').then(r => r.json())).toEqual(before);
});

test('cloud geometry loads and movement renders without runtime errors', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 800, height: 600 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Exercise real rendering in CI, bypassing only the software-GPU admission
  // guard. Production continues redirecting slow software GPUs to Device.
  await page.route('**/js/graybox.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const probe = '\nwindow.cloudTestProbe = () => ({ shelf: scrollShelfHeight, cloudSurface: upperSurfaceHeightAt(SCROLL_POS.x, SCROLL_POS.z), scroll: SCROLL_POS.y, ship: SHIP_POS.y, moon: landmarks.get("friend")?.object.position.toArray(), maxHeight: maxFlightHeight, solids: cloudSolids.length, cameraClear: cloudClearance(player.position.clone().add(new THREE.Vector3(0,1.2,0)),camera.position,.1), blockedBelow: resolveVerticalTravel(20,32,12,0), passageOpen: resolveVerticalTravel(20,32,0,0) });';
    await route.fulfill({ response, body: source.replace('if (usesSoftwareRenderer(renderer.getContext()))', 'if (false)').replaceAll('failIfMajorPerformanceCaveat: true', 'failIfMajorPerformanceCaveat: false') + probe });
  });
  await page.goto('/?shell=world');
  await page.waitForFunction(() => document.querySelector('#s-loading')?.hidden === true);
  await expect(page.locator('#s-world canvas')).toBeVisible();
  await page.waitForTimeout(3500);
  const geometry = await page.evaluate(() => window.cloudTestProbe());
  expect(geometry.solids).toBeGreaterThanOrEqual(2);
  expect(geometry.scroll).toBeGreaterThan(geometry.cloudSurface);
  expect(geometry.scroll).toBeLessThan(geometry.cloudSurface + 3);
  expect(geometry.ship).toBeGreaterThan(geometry.cloudSurface);
  expect(geometry.moon[1]).toBeGreaterThan(geometry.ship);
  expect(geometry.blockedBelow.surface).toBe('cloud-underside');
  expect(geometry.passageOpen.y).toBe(32);
  expect(geometry.maxHeight).toBeGreaterThan(geometry.scroll);
  await page.screenshot({ path: '/tmp/cloud-collision-start.png' });
  await page.keyboard.down('w');
  await page.waitForTimeout(1800);
  await page.keyboard.up('w');
  await page.keyboard.down('Space');
  await page.waitForTimeout(2500);
  await page.keyboard.up('Space');
  expect((await page.evaluate(() => window.cloudTestProbe())).cameraClear).toBe(1);
  await page.screenshot({ path: '/tmp/cloud-collision-flight.png' });
  expect(errors).toEqual([]);
});
