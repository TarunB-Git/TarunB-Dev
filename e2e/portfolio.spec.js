import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const timelineFixture = {
  path: 'viewer',
  periods: [
    {
      id: 1, path: 'viewer', label: 'Origins', slug: 'origins', sort_order: 0, published: true,
      events: [{
        id: 1, period_id: 1, path: 'viewer', slug: 'first-turn', category: 'identity',
        title: 'The first turn', subtitle: 'Where the story starts', summary: 'A short introduction.',
        details_md: '## The longer version\n\nAn accessible detail panel with more context.',
        layout: 'feature', accent: 'violet', media: null, links: [], sort_order: 0, published: true,
      }],
    },
    {
      id: 2, path: 'viewer', label: 'Now', slug: 'now', sort_order: 1, published: true,
      events: [{
        id: 2, period_id: 2, path: 'viewer', slug: 'current-course', category: 'value',
        title: 'The current course', subtitle: '', summary: 'What matters now.',
        details_md: 'Clarity, care, and curiosity.', layout: 'upper', accent: 'blue',
        media: null, links: [{ kind: 'post', slug: 'linked-story', label: 'Read the story' }],
        sort_order: 0, published: true,
      }],
    },
  ],
};

async function waitForApp(page) {
  await page.waitForFunction(() => document.querySelector('#s-loading')?.hidden === true);
}

async function chooseNecessaryOnly(page) {
  const reject = page.locator('[data-consent="reject"]');
  if (await reject.isVisible()) await reject.click();
}

function runtimeErrors(page) {
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('status of 404')) failures.push(message.text());
  });
  return failures;
}

test('deep recruiter route restores light mode with strict local assets', async ({ page }) => {
  const failures = runtimeErrors(page);
  const external = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && url.hostname !== '127.0.0.1') external.push(url.href);
  });
  const response = await page.goto('/recruiter?mode=light');
  await waitForApp(page);
  await expect(page.locator('#ps-recruiter')).toHaveClass(/\bon\b/);
  await expect(page.locator('body')).toHaveClass(/\brm-on\b/);
  await expect(page.locator('#card-name')).not.toBeEmpty();
  await expect(page.locator('#rec-timeline .tl-mobile-event')).toHaveCount(5);
  await expect(page.locator('#rec-timeline-sample')).toContainText('Sample content');
  await expect(page.locator('.rec-news-section .sec-label')).toContainText('Recent News');
  expect(response.headers()['content-security-policy']).toContain("script-src 'self'");
  expect(response.headers()['content-security-policy']).not.toContain("script-src 'self' 'unsafe-inline'");
  expect(external).toEqual([]);
  expect(failures).toEqual([]);

  await page.locator('#rtog').click();
  await expect(page).toHaveURL('/recruiter?shell=directory');
  await expect(page.locator('body')).not.toHaveClass(/\brm-on\b/);
  await page.goBack();
  await expect(page).toHaveURL('/recruiter?mode=light');
  await expect(page.locator('body')).toHaveClass(/\brm-on\b/);
});

test('recruiter card flips, folds in both modes, and restores modal focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/recruiter?mode=light');
  await waitForApp(page);
  await chooseNecessaryOnly(page);
  await expect(page.locator('#cardWrap')).toHaveClass(/\bcard-visible\b/);

  const card = page.locator('#cw');
  const resume = page.locator('[data-action="open-resume"]').first();
  await resume.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#rmo .xb')).toBeFocused();
  await expect(page.locator('#cfront')).toBeVisible();
  await expect(page.locator('#cback')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(resume).toBeFocused();

  await page.locator('#fhint').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#cfront')).toBeHidden();
  await expect(page.locator('#cback')).toBeVisible();
  await expect(card).toHaveAttribute('aria-label', 'Business card back');
  await page.locator('#bhint').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#cfront')).toBeVisible();
  await expect(page.locator('#cback')).toBeHidden();
  await expect(card).toHaveAttribute('aria-label', 'Business card front');

  await page.locator('#apill').hover();
  await expect(page.locator('#att')).toHaveClass(/\bvis\b/);
  await page.mouse.move(8, 500);
  await expect(page.locator('#att')).not.toHaveClass(/\bvis\b/);

  const share = page.locator('[data-action="open-share"]');
  await share.focus();
  await share.click();
  await expect(page.locator('#smo')).toHaveClass(/\bopen\b/);
  await expect(page.locator('#smo .xb')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('#smo')?.id)).toBe('smo');
  await page.keyboard.press('Escape');
  await expect(page.locator('#smo')).not.toHaveClass(/\bopen\b/);
  await expect(share).toBeFocused();

  const stats = page.locator('[data-action="open-stats"]');
  await stats.click();
  await expect(page.locator('#stmo .xb')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(stats).toBeFocused();

  await page.evaluate(() => {
    const scroller = document.getElementById('rec-scroll');
    const filler = document.createElement('div');
    filler.id = 'fold-test-filler';
    filler.style.height = '1200px';
    scroller.appendChild(filler);
    scroller.scrollTop = 700;
    scroller.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('#mini')).toHaveClass(/\bshow\b/);
  await page.evaluate(() => {
    const scroller = document.getElementById('rec-scroll');
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('#mini')).not.toHaveClass(/\bshow\b/);

  await page.locator('#rtog').click();
  await expect(page).toHaveURL('/recruiter?shell=directory');
  await page.evaluate(() => {
    const scroller = document.getElementById('rec-scroll');
    scroller.scrollTop = 700;
    scroller.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('#mini')).toHaveClass(/\bshow\b/);
  await page.locator('[data-app-action="maximize"]').click();
  await expect(page.locator('#directory-app-window')).toHaveClass(/\bis-maximized\b/);
  await expect(page.locator('#mini')).toBeVisible();
  expect((await page.locator('#mini').boundingBox())?.y).toBeGreaterThanOrEqual(69);
});

test('consented business-card flips are counted in public analytics', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/recruiter');
  await waitForApp(page);
  const allow = page.locator('[data-consent="allow"]');
  if (await allow.isVisible()) await allow.click();
  await expect(page.locator('#cardWrap')).toHaveClass(/\bcard-visible\b/);
  await page.locator('#fhint').click();
  await expect(page.locator('#cback')).toBeVisible();
  await page.waitForTimeout(250);
  await page.locator('[data-action="open-stats"]').first().click();
  await expect(page.locator('#st-card-flips')).not.toHaveText('—');
  expect(Number((await page.locator('#st-card-flips').innerText()).replace(/\D/g, ''))).toBeGreaterThan(0);
});

test('first visit opens Device and keeps the Cloud switch available', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);
  await expect(page.locator('#s-directory')).not.toHaveClass(/\bout\b/);
  await expect(page.locator('#experience-switch [data-shell-mode="directory"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#experience-switch [data-shell-mode="world"]')).toBeVisible();
});

test('privacy choices open from Device, the single Cloud control, and the recruiter navbar', async ({ page }) => {
  await page.goto('/?shell=directory');
  await waitForApp(page);
  const banner = page.locator('#cookie-banner');
  const reject = page.locator('[data-consent="reject"]');
  const allow = page.locator('[data-consent="allow"]');
  const privacy = page.locator('#privacy-settings');

  const expectDialogOpen = async choice => {
    await expect(banner).toBeVisible();
    await expect(banner).toHaveClass(/\bshow\b/);
    await expect(banner).toHaveAttribute('open', '');
    await expect(banner).toHaveAttribute('aria-hidden', 'false');
    expect(await banner.evaluate(dialog => dialog.matches(':modal'))).toBe(true);
    const box = await banner.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1440);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
    expect(900 - (box.y + box.height)).toBeLessThanOrEqual(24);
    expect(await page.locator(choice).evaluate(button => {
      const rect = button.getBoundingClientRect();
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        ?.closest('#cookie-banner')?.id;
    })).toBe('cookie-banner');
  };

  const expectDismissed = async () => {
    await expect(banner).not.toHaveAttribute('open', '');
    await expect(banner).not.toHaveClass(/\bshow\b/);
    await expect(banner).toHaveAttribute('aria-hidden', 'true');
    await expect(privacy).toHaveAttribute('aria-expanded', 'false');
    expect(await page.locator(':modal').count()).toBe(0);
  };

  // A first visit already has a non-modal choice bar. Reopening it through
  // Privacy must promote it to a real modal without leaving a stale close
  // event behind.
  await expect(banner).toHaveClass(/\bshow\b/);
  await expect(banner).toHaveAttribute('open', '');
  await expect(reject).toBeVisible();
  await privacy.click();
  await expectDialogOpen('[data-consent="reject"]');
  await allow.click();
  await expectDismissed();
  await page.locator('#experience-switch [data-shell-mode="world"]').click();
  await expect(page).toHaveURL('/?shell=world');
  await page.locator('#experience-switch [data-shell-mode="directory"]').click();
  await expect(page).toHaveURL('/?shell=directory');

  await expect(privacy).toBeVisible();
  await privacy.click();
  await expectDialogOpen('[data-consent="allow"]');
  await reject.click();
  await expectDismissed();
  await page.locator('#experience-switch [data-shell-mode="world"]').click();
  await expect(page).toHaveURL('/?shell=world');

  const cloudPrivacy = page.locator('#cloud-privacy');
  const cloudIsActive = await page.evaluate(() => document.body.dataset.shellMode === 'world');
  const activePrivacyControl = cloudIsActive ? cloudPrivacy : privacy;
  await expect(activePrivacyControl).toBeVisible();
  await expect(page.locator('#privacy-settings:visible, #cloud-privacy:visible')).toHaveCount(1);
  if (cloudIsActive) await expect(privacy).toBeHidden();
  else await expect(cloudPrivacy).toBeHidden();
  await activePrivacyControl.click();
  await expectDialogOpen('[data-consent="reject"]');
  await expect(privacy).toHaveAttribute('aria-expanded', 'true');
  await reject.click();
  await expectDismissed();
  await page.locator('#experience-switch [data-shell-mode="directory"]').click();
  await expect(page).toHaveURL('/?shell=directory');
  await page.locator('#experience-switch [data-shell-mode="world"]').click();
  await expect(page).toHaveURL('/?shell=world');

  await activePrivacyControl.click();
  await expectDialogOpen('[data-consent="allow"]');
  await page.keyboard.press('Escape');
  await expectDismissed();
  await page.locator('#experience-switch [data-shell-mode="directory"]').click();
  await expect(page).toHaveURL('/?shell=directory');

  await page.goto('/recruiter?shell=world');
  await waitForApp(page);
  await page.evaluate(() => {
    const scroller = document.getElementById('rec-scroll');
    const filler = document.createElement('div');
    filler.style.height = '1200px';
    scroller.appendChild(filler);
    scroller.scrollTop = 700;
    scroller.dispatchEvent(new Event('scroll'));
  });
  await expect(page.locator('#mini')).toHaveClass(/\bshow\b/);
  await expect(page.locator('#mini #privacy-settings')).toBeVisible();
  await page.locator('#mini #privacy-settings').click();
  await expectDialogOpen('[data-consent="allow"]');
  await allow.click();
  await expectDismissed();
  await page.locator('#mini #privacy-settings').click();
  await expectDialogOpen('[data-consent="reject"]');
  const recruiterUrlBeforeEscape = page.url();
  const recruiterShellBeforeEscape = await page.evaluate(() => document.body.dataset.shellMode);
  await page.keyboard.press('Escape');
  await expectDismissed();
  await expect(page).toHaveURL(recruiterUrlBeforeEscape);
  expect(await page.evaluate(() => document.body.dataset.shellMode)).toBe(recruiterShellBeforeEscape);
  await expect(page.locator('#mini #privacy-settings')).toBeVisible();
  await page.locator('#mini #experience-switch [data-shell-mode="directory"]').click();
  await expect(page).toHaveURL('/?shell=directory');
});

test('Cloud Privacy opens a visible modal and returns interaction when WebGL is available', async ({ page }) => {
  await page.goto('/?shell=world');
  await waitForApp(page);
  const cloudReady = await page.evaluate(() =>
    document.body.dataset.shellMode === 'world' &&
    !document.getElementById('s-world')?.classList.contains('graybox-no-webgl')
  );
  test.skip(!cloudReady, 'The browser running this test cannot render Cloud mode.');

  const privacy = page.locator('#cloud-privacy');
  const banner = page.locator('#cookie-banner');
  await expect(privacy).toBeVisible();
  await expect(page.locator('#privacy-settings:visible, #cloud-privacy:visible')).toHaveCount(1);
  await privacy.click();
  await expect(banner).toBeVisible();
  expect(await banner.evaluate(dialog => dialog.matches(':modal'))).toBe(true);
  const box = await banner.boundingBox();
  expect(box).not.toBeNull();
  expect(await page.evaluate(() => window.innerHeight - (document.getElementById('cookie-banner').getBoundingClientRect().bottom))).toBeLessThanOrEqual(24);
  expect(await page.locator('[data-consent="reject"]').evaluate(button => {
    const rect = button.getBoundingClientRect();
    return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      ?.closest('#cookie-banner')?.id;
  })).toBe('cookie-banner');
  await page.locator('[data-consent="reject"]').click();
  await expect(banner).not.toHaveAttribute('open', '');
  expect(await page.locator(':modal').count()).toBe(0);
  await page.locator('#experience-switch [data-shell-mode="directory"]').click();
  await expect(page).toHaveURL('/?shell=directory');
});

test('mobile hides Device home Privacy while Cloud and folded recruiter Privacy remain interactive', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?shell=directory');
  await waitForApp(page);
  await chooseNecessaryOnly(page);

  const privacy = page.locator('#privacy-settings');
  const banner = page.locator('#cookie-banner');
  await expect(privacy).toBeHidden();
  await page.locator('#experience-switch [data-shell-mode="world"]').click();
  await expect(page).toHaveURL('/?shell=world');
  const cloudIsActive = await page.evaluate(() => document.body.dataset.shellMode === 'world');
  if (cloudIsActive) {
    await expect(page.locator('#cloud-privacy')).toBeVisible();
    await expect(privacy).toBeHidden();
    await expect(page.locator('#privacy-settings:visible, #cloud-privacy:visible')).toHaveCount(1);
    await page.locator('#cloud-privacy').click();
    await expect(banner).toBeVisible();
    expect(await banner.evaluate(dialog => dialog.matches(':modal'))).toBe(true);
    await page.locator('[data-consent="reject"]').click();
    await expect(banner).toBeHidden();
  } else {
    await expect(page.locator('#cloud-privacy')).toBeHidden();
    await expect(page.locator('#privacy-settings:visible, #cloud-privacy:visible')).toHaveCount(0);
  }
  await expect(page.locator('#experience-switch [data-shell-mode="directory"]')).toBeVisible();
  await page.locator('#experience-switch [data-shell-mode="directory"]').click();
  await expect(privacy).toBeHidden();

  await page.goto('/recruiter?shell=world');
  await waitForApp(page);
  await page.evaluate(() => {
    const scroller = document.getElementById('rec-scroll');
    scroller.scrollTop = 700;
    scroller.dispatchEvent(new Event('scroll'));
  });
  const miniPrivacy = page.locator('#mini #privacy-settings');
  await expect(page.locator('#mini')).toHaveClass(/\bshow\b/);
  await expect(miniPrivacy).toBeVisible();
  await miniPrivacy.click();
  await expect(banner).toBeVisible();
  expect(await banner.evaluate(dialog => dialog.matches(':modal'))).toBe(true);
  await page.locator('[data-consent="allow"]').click();
  await expect(banner).toBeHidden();
  await expect(page.locator('#mini #experience-switch [data-shell-mode="directory"]')).toBeVisible();
  await page.locator('#mini #experience-switch [data-shell-mode="directory"]').click();
  await expect(page).toHaveURL('/?shell=directory');
  await expect(privacy).toBeHidden();
});

test('Device reveals ship and scroll destinations only after their Cloud landmarks', async ({ page }) => {
  await page.goto('/?shell=directory');
  await waitForApp(page);
  await chooseNecessaryOnly(page);
  const files = page.locator('#directory-files');
  await expect(files).toContainText('Walkthrough.md');
  await expect(files).not.toContainText('About Me');
  await expect(files).not.toContainText('Library & Notes');
  await expect(files).not.toContainText('Blogs');

  await page.evaluate(() => sessionStorage.setItem('cloud_landmarks_visited_v2', JSON.stringify(['viewer'])));
  await page.reload();
  await waitForApp(page);
  await expect(files).toContainText('About Me');
  await expect(files).not.toContainText('Library & Notes');
  await expect(files).not.toContainText('Blogs');

  await page.evaluate(() => sessionStorage.setItem('cloud_landmarks_visited_v2', JSON.stringify(['viewer', 'personal'])));
  await page.reload();
  await waitForApp(page);
  await expect(files).toContainText('About Me');
  await expect(files).toContainText('Library & Notes');
  await expect(files).toContainText('Blogs');
});

test('directory contacts and cloud-world movement remain available', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('cloud_landmarks_visited_v2', JSON.stringify(['viewer', 'personal']));
  });
  await page.goto('/');
  await waitForApp(page);
  await chooseNecessaryOnly(page);
  await expect(page.locator('#s-directory')).not.toHaveClass(/\bout\b/);
  await expect(page.locator('.directory-file')).toHaveCount(9);
  await expect(page.locator('.directory-file')).toContainText(['Work & Résumé', 'Walkthrough.md', 'About Me', 'Library & Notes', 'Blogs', 'Legal & Credits.txt', 'Email', 'Call', 'WhatsApp']);
  await page.locator('.directory-file').filter({ hasText: 'Walkthrough.md' }).click();
  await expect(page.locator('#document-window-title')).toHaveText('Walkthrough.md');
  await expect(page.locator('#directory-document-content')).toContainText('Follow the navigation arrow in the top-right corner');
  await expect(page.locator('#directory-document-content')).toContainText('special way to travel');
  await page.locator('[data-document-action="close"]').click();
  await page.locator('.directory-file').filter({ hasText: 'Blogs' }).click();
  await expect(page.locator('.directory-blog-frame')).toBeVisible();
  await expect(page.locator('.directory-blog-frame')).toHaveAttribute('src', /\/blogs\?embed=1/);
  await expect(page).toHaveURL('/');
  await page.locator('[data-document-action="close"]').click();
  await expect(page.locator('#directory-document-window')).toBeHidden();
  await page.locator('[data-window-action="minimize"]').click();
  await expect(page.locator('#directory-window')).toHaveClass(/\bis-minimized\b/);
  await page.locator('[data-directory-action="restore"]').click();
  await page.locator('[data-window-action="maximize"]').click();
  await expect(page.locator('#directory-window')).toHaveClass(/\bis-maximized\b/);
  await page.locator('[data-window-action="maximize"]').click();
  await page.locator('#experience-switch [data-shell-mode="world"]').click();
  await expect(page).toHaveURL('/?shell=world');
  await expect(page.locator('body')).toHaveClass(/\bgraybox-active\b/);
  await expect(page.locator('#w-prompt-h')).toHaveText('Explore the cloud.');
  await expect(page.locator('#graybox-status')).toHaveText(/Choose a landmark|3D movement needs WebGL\./);
  await expect(page.locator('.world-path-choice')).toHaveCount(0);
  await expect(page.locator('#audio-btn')).toHaveCount(0);
  await expect(page.locator('.graybox-help')).toContainText('W / S');
  await expect(page.locator('.graybox-help')).toContainText('Space');
  await expect(page.locator('[data-graybox-action="fly"]')).toHaveText('Fly');
  await expect(page.locator('[data-graybox-action="drop"]')).toHaveText('Drop');
});

test('mobile Device keeps desktop shortcuts and opens paths without a document refresh', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  let documentNavigations = 0;
  page.on('request', request => {
    if (request.isNavigationRequest() && request.resourceType() === 'document') documentNavigations += 1;
  });
  await page.goto('/?shell=directory');
  await waitForApp(page);
  await expect(page.locator('#directory-window')).toHaveClass(/\bis-maximized\b/);
  documentNavigations = 0;
  await page.locator('[data-window-action="close"]').click();
  await expect(page.locator('#directory-window')).toHaveClass(/\bis-closed\b/);
  const shortcuts = page.locator('#directory-desktop-icons .desktop-shortcut');
  await expect(shortcuts).toHaveCount(8);
  const firstShortcut = await shortcuts.first().boundingBox();
  expect(firstShortcut?.y).toBeGreaterThanOrEqual(40);
  expect(firstShortcut?.y).toBeLessThan(250);
  await page.locator('[data-desktop-entry="0"]').click();
  await expect(page).toHaveURL('/recruiter?shell=directory');
  await expect(page.locator('#directory-app-window')).toHaveClass(/\bactive\b/);
  const appBox = await page.locator('#directory-app-window').boundingBox();
  expect(appBox?.x).toBe(0);
  expect(appBox?.y).toBe(31);
  expect(appBox?.width).toBe(390);
  expect(appBox?.height).toBe(813);
  expect(documentNavigations).toBe(0);
  await page.locator('[data-app-action="maximize"]').click();
  await expect(page.locator('#directory-app-window')).not.toHaveClass(/\bis-maximized\b/);
  await expect(page.locator('#directory-app-window > .directory-resize-handle')).toBeVisible();
  const restoredBox = await page.locator('#directory-app-window').boundingBox();
  expect(restoredBox?.x).toBe(10);
  expect(restoredBox?.y).toBe(72);
  expect(restoredBox?.width).toBe(370);
  await page.locator('[data-app-action="maximize"]').click();
  await page.locator('[data-app-action="minimize"]').click();
  await expect(page.locator('#directory-app-window')).toHaveClass(/\bis-minimized\b/);
  await expect(page.locator('#directory-dock-path')).toBeVisible();
  await context.close();
});

test('path Home follows the active experience mode', async ({ page }) => {
  await page.goto('/viewer?shell=world');
  await waitForApp(page);
  await page.locator('#ps-viewer .site-home').click();
  await expect(page).toHaveURL('/?shell=world');

  await page.locator('#experience-switch [data-shell-mode="directory"]').click();
  await expect(page).toHaveURL('/?shell=directory');
});

test('moon story path opens into its content without bamboo trials', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/friend');
  await waitForApp(page);
  await chooseNecessaryOnly(page);
  await expect(page.locator('#frnd-content-panel.show')).toBeVisible();
  await expect(page.locator('.frnd-c-header h1')).toHaveText('What stayed in orbit.');
  await expect(page.locator('#frnd-replay')).toHaveCount(0);
  await expect(page.locator('#frnd-bamboo-intro')).not.toHaveClass(/\bshow\b/);
  await expect(page.locator('#frnd-test-panel')).not.toHaveClass(/\bshow\b/);
});

test('touch friend path also bypasses the shelved bamboo trials', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/friend');
  await waitForApp(page);
  await chooseNecessaryOnly(page);
  await expect(page.locator('#frnd-content-panel.show')).toBeVisible();
  await expect(page.locator('#frnd-test-panel')).not.toHaveClass(/\bshow\b/);
  await context.close();
});

test('unknown public routes use the mode-aware 404 while APIs stay JSON', async ({ page }) => {
  const response = await page.goto('/somewhere-beyond-the-clouds');
  expect(response.status()).toBe(404);
  await expect(page).toHaveTitle(/Lost above the weather/);
  await expect(page.locator('.directory-error')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No such file or folder.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Desktop' })).toHaveAttribute('href', '/');

  const apiResponse = await page.request.get('/api/v1/definitely-missing');
  expect(apiResponse.status()).toBe(404);
  expect((await apiResponse.json()).detail).toBeTruthy();
});

test('desktop timeline has period pills, scrubber, overview, and deep-linked details', async ({ page }) => {
  await page.route('**/api/v1/timelines/viewer', route => route.fulfill({ json: timelineFixture }));
  const login = await page.request.post('/api/v1/admin/login', {
    data: { passphrase: 'local-e2e-passphrase-only' },
  });
  expect(login.ok()).toBe(true);
  const { csrf_token: csrf } = await login.json();
  const created = await page.request.post('/api/v1/admin/posts', {
    headers: { 'X-CSRF-Token': csrf },
    data: {
      slug: 'linked-story', title: 'A linked timeline story', body_md: 'The linked story body.',
      excerpt: 'The linked story body.', tags: ['viewer'], published: true,
    },
  });
  expect(created.ok()).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/viewer');
  await waitForApp(page);
  await chooseNecessaryOnly(page);

  const timeline = page.locator('#view-timeline');
  await expect(timeline.locator('.tl-desktop')).toBeVisible();
  await expect(timeline.locator('.tl-period-pill')).toHaveCount(2);
  await expect(timeline.locator('.tl-scrubber')).toBeVisible();
  await expect(timeline.locator('.tl-overview')).toBeVisible();
  await expect(timeline.locator('.tl-stage')).toHaveScreenshot('viewer-timeline-desktop.png', {
    animations: 'disabled',
    maxDiffPixels: 200,
  });
  await timeline.locator('.tl-stage').focus();
  await page.keyboard.press('ArrowRight');
  await expect(timeline.locator('.tl-period-pill.is-selected')).toHaveText('Now');
  await page.keyboard.press('ArrowLeft');
  await expect(timeline.locator('.tl-period-pill.is-selected')).toHaveText('Origins');
  await timeline.locator('.tl-plus').first().click();
  await expect(timeline.locator('.tl-dialog')).toHaveAttribute('open', '');
  await expect(page).toHaveURL(/event=first-turn/);
  await expect(timeline.locator('.tl-dialog')).toContainText('The longer version');
  await page.keyboard.press('Escape');
  await expect(timeline.locator('.tl-dialog')).not.toHaveAttribute('open', '');
  await expect(page).toHaveURL('/viewer');

  await page.goto('/viewer?event=current-course');
  await waitForApp(page);
  await expect(page.locator('#view-timeline .tl-dialog')).toHaveAttribute('open', '');
  await expect(page.locator('#view-timeline .tl-dialog')).toContainText('Clarity, care, and curiosity');
  await expect(page.locator('#view-timeline .tl-period-pill.is-selected')).toHaveText('Now');
  await expect(page.locator('#view-timeline .tl-scrubber')).toHaveValue('1');
  await expect.poll(() => page.locator('#view-wrap').evaluate(node => node.scrollTop)).toBeGreaterThan(100);
  await page.reload();
  await waitForApp(page);
  await expect(page.locator('#view-timeline .tl-dialog')).toHaveAttribute('open', '');
  await expect(page.locator('#view-timeline .tl-period-pill.is-selected')).toHaveText('Now');
  await expect.poll(() => page.locator('#view-wrap').evaluate(node => node.scrollTop)).toBeGreaterThan(100);

  await page.locator('#view-timeline .tl-dialog-links a').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('shell')).toBe('directory');
  expect(new URL(page.url()).pathname).toBe('/viewer');
  const journal = page.frameLocator('.directory-blog-frame');
  await expect(journal.locator('.post-title')).toHaveText('A linked timeline story');
  const journalFrame = page.frames().find(frame => frame.url().includes('/blog/linked-story'));
  expect(journalFrame).toBeTruthy();
  await journalFrame.goto(journalFrame.url());
  await expect(journal.locator('.post-title')).toHaveText('A linked timeline story');
  await expect(journal.getByRole('link', { name: /All writing/i })).toHaveAttribute('href', '/blogs?embed=1');
});

test('mobile timeline is vertical, touch-usable, and has no sideways-only content', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.route('**/api/v1/timelines/viewer', route => route.fulfill({ json: timelineFixture }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/viewer');
  await waitForApp(page);
  await chooseNecessaryOnly(page);
  await expect(page.locator('#view-timeline .tl-mobile')).toBeVisible();
  await expect(page.locator('#view-timeline .tl-desktop')).toBeHidden();
  await expect(page.locator('.tl-mobile-picker')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.locator('.tl-mobile .tl-plus').first().evaluate(button => button.click());
  await expect(page.locator('.tl-dialog')).toHaveAttribute('open', '');
  await context.close();
});

test('tagged path writing exposes every cursor page', async ({ page }) => {
  const posts = Array.from({ length: 7 }, (_, index) => ({
    id: index + 1, slug: `viewer-post-${index + 1}`, title: `Viewer post ${index + 1}`,
    body_md: 'Story', excerpt: 'Story', tags: ['viewer'], created_at: '2026-08-20T12:00:00Z',
    likes: 0, comments: 0, reactions: {}, my_reactions: [], liked: false,
  }));
  const requests = [];
  await page.route('**/api/v1/posts?*', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('tag') !== 'viewer') return route.fallback();
    requests.push(url.searchParams.get('cursor') || '');
    const second = Boolean(url.searchParams.get('cursor'));
    return route.fulfill({ json: {
      items: second ? posts.slice(6) : posts.slice(0, 6),
      next_cursor: second ? null : 'page-2',
    } });
  });
  await page.goto('/viewer');
  await waitForApp(page);
  await chooseNecessaryOnly(page);
  await expect(page.locator('#view-posts .blog-row')).toHaveCount(6);
  await expect(page.locator('#view-posts .blog-more')).toBeVisible();
  await page.locator('#view-posts .blog-more').click();
  await expect(page.locator('#view-posts .blog-row')).toHaveCount(7);
  await expect(page.locator('#view-posts .blog-more')).toBeHidden();
  expect(requests).toEqual(['', 'page-2']);
});

test('blog deep links render standalone searchable post pages after refresh', async ({ page }) => {
  const login = await page.request.post('/api/v1/admin/login', {
    data: { passphrase: 'local-e2e-passphrase-only' },
  });
  expect(login.ok()).toBe(true);
  const { csrf_token: csrf } = await login.json();
  const created = await page.request.post('/api/v1/admin/posts', {
    headers: { 'X-CSRF-Token': csrf },
    data: {
      slug: 'path-story', title: 'A path story',
      body_md: '## A remembered turn\n\nThe exact post survives a refresh.',
      excerpt: 'A remembered turn.', tags: ['viewer', 'recruiter'], primary_tag: 'work',
      secondary_tags: ['testing'], series: 'Portfolio engineering', published: true,
    },
  });
  expect(created.ok()).toBe(true);
  await page.goto('/blog/path-story');
  await expect(page.locator('.post-title')).toHaveText('A path story');
  await expect(page.locator('.post-body h3')).toHaveText('A remembered turn');
  await page.locator('.comment-form [name="name"]').fill('Reader');
  await page.locator('.comment-form [name="body"]').fill('A useful thread starter.');
  await page.locator('.comment-form').evaluate(form => form.requestSubmit());
  await expect(page.locator('.comment')).toContainText('A useful thread starter.');
  await page.reload();
  await expect(page.locator('.post-title')).toHaveText('A path story');

  await page.goto('/blogs');
  await page.locator('.archive-search').fill('testing');
  await expect(page.locator('.archive-card').filter({ hasText: 'A path story' })).toBeVisible();
  await page.locator('[data-tag="work"]').click();
  await expect(page.locator('.archive-card').filter({ hasText: 'A path story' })).toBeVisible();

  await page.goto('/viewer');
  await waitForApp(page);
  await page.locator('#view-posts .blog-row').filter({ hasText: 'A path story' }).click();
  await expect(page).toHaveURL('/viewer?shell=directory');
  await expect(page.locator('.directory-blog-frame')).toHaveAttribute('src', /\/blog\/path-story\?embed=1/);
  await expect(page.frameLocator('.directory-blog-frame').locator('.post-title')).toHaveText('A path story');

  await page.goto('/recruiter?mode=light');
  await waitForApp(page);
  await page.locator('#rec-posts .blog-row').filter({ hasText: 'A path story' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('shell')).toBe('directory');
  expect(new URL(page.url()).pathname).toBe('/recruiter');
  expect(new URL(page.url()).searchParams.get('mode')).toBe('light');
  await expect(page.frameLocator('.directory-blog-frame').locator('.post-title')).toHaveText('A path story');
});

test('message forms are private by default and transmit explicit wall consent separately', async ({ page }) => {
  const submissions = [];
  await page.route('**/api/v1/messages', async route => {
    if (route.request().method() === 'POST') {
      submissions.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, json: { id: submissions.length, status: 'pending' } });
      return;
    }
    await route.fulfill({ json: { items: [] } });
  });
  await page.goto('/personal');
  await waitForApp(page);
  await chooseNecessaryOnly(page);

  const form = page.locator('#pers-msgbox form');
  await form.locator('.mb-contact').fill('private@example.test');
  await form.locator('.mb-body').fill('Keep this in the private inbox.');
  await form.evaluate(node => node.requestSubmit());
  await expect(form.locator('.mb-note')).toContainText('will not be published');
  expect(submissions[0]).toMatchObject({
    path: 'personal', publication_consent: false, consent_version: null,
    contact: 'private@example.test',
  });

  await form.locator('.mb-name').fill('Consenting reader');
  await form.locator('.mb-body').fill('This may be reviewed for the wall.');
  await form.locator('.mb-publish').check();
  await form.evaluate(node => node.requestSubmit());
  await expect(form.locator('.mb-note')).toContainText('may also appear on the wall');
  expect(submissions[1].publication_consent).toBe(true);
  expect(submissions[1].consent_version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('message moderation publishes only consented text and never exposes contact details', async ({ page }) => {
  const privateBody = 'Private moderation E2E message.';
  const privateContact = 'private-moderation@example.test';
  const privateMessage = await page.request.post('/api/v1/messages', {
    data: {
      path: 'personal', author_name: 'Private reader', contact: privateContact,
      body: privateBody, publication_consent: false, consent_version: null, website: '',
    },
  });
  expect(privateMessage.status()).toBe(201);
  const privateId = (await privateMessage.json()).id;

  const login = await page.request.post('/api/v1/admin/login', {
    data: { passphrase: 'local-e2e-passphrase-only' },
  });
  expect(login.ok()).toBe(true);
  const { csrf_token: csrf } = await login.json();
  const blockedPublication = await page.request.patch(`/api/v1/admin/messages/${privateId}`, {
    headers: { 'X-CSRF-Token': csrf },
    data: { status: 'approved', publish: true, public_display_name: 'Private reader' },
  });
  expect(blockedPublication.status()).toBe(409);

  const publicBody = 'Consented moderation E2E wall message.';
  const publicContact = 'never-public@example.test';
  const consentedMessage = await page.request.post('/api/v1/messages', {
    data: {
      path: 'personal', author_name: 'Consenting reader', contact: publicContact,
      body: publicBody, publication_consent: true, consent_version: '2026-08-20', website: '',
    },
  });
  expect(consentedMessage.status()).toBe(201);
  const consentedId = (await consentedMessage.json()).id;
  const published = await page.request.patch(`/api/v1/admin/messages/${consentedId}`, {
    headers: { 'X-CSRF-Token': csrf },
    data: { status: 'approved', publish: true, public_display_name: 'Wall reader' },
  });
  expect(published.ok()).toBe(true);

  const wallResponse = await page.request.get('/api/v1/messages');
  expect(wallResponse.ok()).toBe(true);
  const wall = (await wallResponse.json()).items;
  expect(wall.some(item => item.body === privateBody)).toBe(false);
  const wallMessage = wall.find(item => item.body === publicBody);
  expect(wallMessage).toMatchObject({
    path: 'personal', public_display_name: 'Wall reader', body: publicBody,
  });
  expect(wallMessage).not.toHaveProperty('contact');
  expect(JSON.stringify(wallMessage)).not.toContain(publicContact);

  await page.goto('/personal');
  await waitForApp(page);
  await chooseNecessaryOnly(page);
  const rendered = page.locator('#pers-wall .wall-msg').filter({ hasText: publicBody });
  await expect(rendered).toHaveCount(1);
  await expect(rendered).toContainText('Wall reader');
  await expect(page.locator('#pers-wall')).not.toContainText(privateBody);
  await expect(page.locator('#pers-wall')).not.toContainText(privateContact);
  await expect(page.locator('#pers-wall')).not.toContainText(publicContact);
});

test('public stats render a seven-day daily activity breakdown', async ({ page }) => {
  const end = new Date();
  const today = end.toISOString().slice(0, 10);
  const yesterdayDate = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 1));
  const yesterday = yesterdayDate.toISOString().slice(0, 10);
  await page.route('**/api/v1/stats/public', route => route.fulfill({ json: {
    totals: { view: 12, resume_open: 2, vcard: 1, share: 3 },
    this_week: { view: 7, share: 2 }, paths: { viewer: 4 }, sources: { Direct: 6 },
    daily: [
      { day: yesterday, event_type: 'view', count: 2 },
      { day: today, event_type: 'view', count: 4 },
      { day: today, event_type: 'path_enter', count: 3 },
    ],
  } }));
  await page.goto('/recruiter?mode=light');
  await waitForApp(page);
  await chooseNecessaryOnly(page);
  await page.locator('[data-action="open-stats"]').click();
  await expect(page.locator('#st-weekly .brow')).toHaveCount(7);
  await expect(page.locator(`#st-weekly .brow[data-day="${today}"] span`).last())
    .toHaveText('4 visits · 3 actions');
  await expect(page.locator(`#st-weekly .brow[data-day="${yesterday}"] span`).last())
    .toHaveText('2 visits · 0 actions');
});

test('analytics rejection sends nothing and acceptance sends only a coarse source bucket', async ({ browser, baseURL }) => {
  const rejectedContext = await browser.newContext({ baseURL });
  const rejectedPage = await rejectedContext.newPage();
  let rejectedEvents = 0;
  await rejectedPage.route('**/api/v1/stats/events', route => {
    rejectedEvents += 1;
    return route.fulfill({ json: { ok: true } });
  });
  await rejectedPage.goto('/', { referer: 'https://www.linkedin.com/feed/' });
  await waitForApp(rejectedPage);
  await rejectedPage.locator('[data-consent="reject"]').click();
  await rejectedPage.waitForTimeout(200);
  expect(rejectedEvents).toBe(0);
  await rejectedPage.locator('[data-open-privacy]').click();
  await expect(rejectedPage.locator('#cookie-banner')).toHaveClass(/\bshow\b/);
  await expect(rejectedPage.locator('[data-consent="reject"]')).toBeFocused();
  await rejectedPage.locator('[data-consent="reject"]').click();
  await rejectedContext.close();

  const acceptedContext = await browser.newContext({ baseURL });
  const acceptedPage = await acceptedContext.newPage();
  const accepted = [];
  let withdrawals = 0;
  await acceptedPage.route('**/api/v1/stats/events', async route => {
    accepted.push({ body: route.request().postDataJSON(), consent: route.request().headers()['x-analytics-consent'] });
    await route.fulfill({ json: { ok: true, deduplicated: false } });
  });
  await acceptedPage.route('**/api/v1/stats/session', route => {
    withdrawals += 1;
    return route.fulfill({ status: 204, body: '' });
  });
  await acceptedPage.goto('/', { referer: 'https://www.linkedin.com/feed/' });
  await waitForApp(acceptedPage);
  await acceptedPage.locator('[data-consent="allow"]').click();
  await expect.poll(() => accepted.length).toBe(1);
  expect(accepted[0].consent).toBe('true');
  expect(accepted[0].body.landing_referrer).toBe('LinkedIn');
  expect(JSON.stringify(accepted[0].body)).not.toContain('linkedin.com');
  await acceptedPage.locator('[data-open-privacy]').click();
  await acceptedPage.locator('[data-consent="reject"]').click();
  await expect.poll(() => withdrawals).toBe(1);
  expect(await acceptedPage.evaluate(() => ({
    session: sessionStorage.getItem('portfolio_analytics_session_v1'),
    sent: sessionStorage.getItem('portfolio_analytics_events_v1'),
  }))).toEqual({ session: null, sent: null });
  await acceptedContext.close();
});

test('no-WebGL fallback keeps the cloud-world routes understandable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
      if (String(type).startsWith('webgl')) return null;
      return original.call(this, type, ...args);
    };
  });
  await page.goto('/');
  await waitForApp(page);
  await chooseNecessaryOnly(page);
  await expect(page.locator('#s-world')).toHaveClass(/\bgraybox-no-webgl\b/);
  await expect(page.locator('#w-prompt-h')).toHaveText('Explore the cloud.');
  await expect(page.locator('#graybox-status')).toHaveText('3D movement needs WebGL.');
  await expect(page.locator('.world-path-choice')).toHaveCount(0);

  // Portfolio pages remain available by direct URL while world navigation is
  // intentionally absent during the movement prototype.
  await page.goto('/viewer');
  await waitForApp(page);
  await expect(page).toHaveURL('/viewer');
  await expect(page.locator('#ps-viewer')).toHaveClass(/\bon\b/);
});

test('admin is unlinked/noindex and exposes structured onboarding after login', async ({ page }) => {
  const response = await page.goto('/admin');
  expect(response.headers()['x-robots-tag']).toContain('noindex');
  await page.locator('#pass').fill('local-e2e-passphrase-only');
  await page.locator('#login-btn').click();
  await expect(page.locator('#shell')).toBeVisible();
  await expect(page.locator('#readiness')).toContainText(/Launch check|Not ready|Missing|required/i);
  await expect(page.locator('nav button')).toHaveCount(11);
  await page.locator('nav button[data-p="card"]').click();
  await expect(page.locator('#p-card label').first()).toBeVisible();
  expect(await page.locator('#p-card input, #p-card textarea').count()).toBeGreaterThan(5);
  await page.locator('#p-card [data-field="name"]').fill('E2E Owner');
  await page.locator('#p-card [data-field="role"]').fill('Test Engineer');
  await page.locator('#p-card [data-field="email"]').fill('owner@example.test');
  await expect(page.locator('#p-card .content-published')).toBeChecked();
  await page.locator('#p-card .content-published').uncheck();
  await page.locator('#p-card .save').click();
  await expect(page.locator('#p-card .editor-actions .note')).toContainText('Saved as draft');
  const cardDraft = await page.evaluate(async () => (await fetch('/api/v1/content/card')).json());
  expect(cardDraft).toMatchObject({ published: false, data: { name: 'E2E Owner', role: 'Test Engineer' } });
  expect(cardDraft.data.selected_work.length).toBeGreaterThan(0);
  await page.locator('nav button[data-p="timelines"]').click();
  await expect(page.locator('#p-timelines')).toContainText('recruiter timeline');
});

test('stable fallback route has no serious or critical accessibility violations', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
      if (String(type).startsWith('webgl')) return null;
      return original.call(this, type, ...args);
    };
  });
  await page.goto('/');
  await waitForApp(page);
  await chooseNecessaryOnly(page);
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(item => ['serious', 'critical'].includes(item.impact));
  expect(blocking, blocking.map(item => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('each active path is a labelled landmark without serious accessibility violations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const path of ['recruiter', 'friend', 'viewer', 'personal']) {
    await page.goto(`/${path}`);
    await waitForApp(page);
    await chooseNecessaryOnly(page);
    const panel = page.locator(`#ps-${path}`);
    await expect(panel).toHaveAttribute('role', 'region');
    await expect(panel).toHaveAttribute('aria-label', /path/i);
    const results = await new AxeBuilder({ page }).include(`#ps-${path}`).analyze();
    const blocking = results.violations.filter(item => ['serious', 'critical'].includes(item.impact));
    expect(blocking, `${path}: ${blocking.map(item => `${item.id}: ${item.help}`).join('\n')}`).toEqual([]);
  }
});
