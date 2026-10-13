import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const api = process.env.HMS_INTEGRATION_API;
const report = process.env.HMS_INTEGRATION_REPORT;
if (!api || !report) throw new Error('Run explicitly through integration-tests/run.py against hms_test.');
await mkdir(report, { recursive: true });
const children = [], logs = [];
function server(port, mode) {
  const log = createWriteStream(resolve(report, `vite-${mode}.log`)); logs.push(log);
  const child = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, VITE_HMS_DATA_MODE: mode, VITE_HMS_API_URL: api }, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log); child.stderr.pipe(log); children.push(child);
  return child;
}
async function ready(port, child) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Vite ${port} exited; existing servers are never replaced.`);
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) return; } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Vite readiness timeout');
}
let browser, context, demo, page;
const checks = [];
try {
  const apiServer = server(5173, 'api'), demoServer = server(5174, 'demo');
  await Promise.all([ready(5173, apiServer), ready(5174, demoServer)]);
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ timezoneId: 'Asia/Manila', viewport: { width: 1600, height: 1050 }, recordVideo: { dir: resolve(report, 'video') } });
  await context.tracing.start({ screenshots: true, snapshots: true });
  page = await context.newPage();
  await page.clock.setFixedTime(new Date('2026-10-13T09:00:00+08:00'));
  await page.goto('http://127.0.0.1:5173/guests');
  await expect(page.getByRole('heading', { name: 'Persisted guests' })).toBeVisible();
  await page.getByLabel('Guest name', { exact: true }).fill('   ');
  await page.getByRole('button', { name: 'Save guest', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('body.name');
  await expect(page.getByLabel('Guest name', { exact: true })).toHaveValue('   ');
  expect(await (await context.request.get(`${api}/api/v1/guests`)).json()).toHaveLength(0);
  checks.push('Server 422 validation retained guest draft and created no phantom guest');
  await page.getByLabel('Guest name', { exact: true }).fill('PW PostgreSQL Guest');
  await page.getByLabel('Phone', { exact: true }).fill('09123456789');
  await page.getByRole('button', { name: 'Save guest', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('PW PostgreSQL Guest saved');
  const guests = await (await context.request.get(`${api}/api/v1/guests`)).json();
  expect(guests).toHaveLength(1);
  const refs = await (await context.request.get(`${api}/api/v1/reference-data`)).json();
  checks.push('Guest created through React and persisted independently');
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  async function fillCreate(arrival, note) {
    await page.getByRole('button', { name: 'New reservation', exact: true }).click();
    await page.getByLabel('Guest', { exact: true }).selectOption(guests[0].id);
    await page.getByLabel('Room', { exact: true }).selectOption(refs.rooms[0].id);
    await page.getByLabel('Duration', { exact: true }).selectOption(refs.durations[0].id);
    await page.getByLabel('Arrival (Asia/Manila)', { exact: true }).fill(arrival);
    await page.getByLabel('Reservation notes', { exact: true }).fill(note);
  }
  await fillCreate('2026-11-10T14:07', 'Initial React booking');
  const failedKeys = [];
  const abortCreate = async route => {
    if (route.request().method() === 'POST') { failedKeys.push(route.request().headers()['idempotency-key']); await route.abort('failed'); }
    else await route.continue();
  };
  await context.route(`${api}/api/v1/reservations`, abortCreate);
  await page.getByRole('button', { name: 'Save reservation', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not be confirmed');
  await expect(page.getByLabel('Reservation notes', { exact: true })).toHaveValue('Initial React booking');
  expect(await (await context.request.get(`${api}/api/v1/reservations`)).json()).toHaveLength(0);
  await expect(page.getByText('No persisted reservations.', { exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(report, '01-network-failure-draft.png'), fullPage: true });
  await context.unroute(`${api}/api/v1/reservations`, abortCreate);
  let retryKey;
  page.once('request', request => { if (request.method() === 'POST') retryKey = request.headers()['idempotency-key']; });
  await page.getByRole('button', { name: 'Retry original request', exact: true }).click();
  await expect(page).toHaveURL(/\/reservations\/[0-9a-f-]{36}$/);
  expect(retryKey).toBe(failedKeys[0]);
  let saved = (await (await context.request.get(`${api}/api/v1/reservations`)).json())[0];
  expect(saved.pricing.snapshot.total_minor).toBe(110000);
  await page.reload();
  await expect(page.getByTestId('saved-note')).toHaveText('Initial React booking');
  checks.push('Failed network save preserved draft/key and created no phantom; retry saved once and survived browser refresh');
  await page.getByRole('button', { name: 'Edit notes and guest counts' }).click();
  await page.getByLabel('Reservation notes').fill('Edited persisted note');
  await page.getByLabel('Adults', { exact: true }).fill('3');
  await page.getByLabel('Children', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Changes saved to PostgreSQL');
  await page.reload();
  await expect(page.getByTestId('saved-note')).toHaveText('Edited persisted note');
  await expect(page.getByText('3 adults · 1 children', { exact: true })).toBeVisible();
  checks.push('React version-checked notes/count PATCH survived refresh with unchanged captured price');
  await page.getByRole('button', { name: 'Edit notes and guest counts' }).click();
  await page.getByLabel('Reservation notes').fill('Keep this unsaved draft');
  const external = await context.request.patch(`${api}/api/v1/reservations/${saved.id}`, {
    headers: { 'Idempotency-Key': randomUUID() }, data: { expected_version: 2, note: 'External change', adults: 5 },
  });
  expect(external.status()).toBe(200);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('changed on the server');
  await expect(page.getByLabel('Reservation notes')).toHaveValue('Keep this unsaved draft');
  await page.screenshot({ path: resolve(report, '02-stale-conflict-draft.png'), fullPage: true });
  await page.getByRole('button', { name: 'Load latest version; keep my draft' }).click();
  await expect(page.getByRole('status')).toContainText('Latest version 3 loaded');
  await expect(page.getByLabel('Reservation notes')).toHaveValue('Keep this unsaved draft');
  await expect(page.getByLabel('Adults', { exact: true })).toHaveValue('5');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Changes saved');
  await page.reload();
  await expect(page.getByTestId('saved-note')).toHaveText('Keep this unsaved draft');
  saved = await (await context.request.get(`${api}/api/v1/reservations/${saved.id}`)).json();
  expect(saved.version).toBe(4); expect(saved.allocation.adults).toBe(5);
  expect(saved.pricing.revision).toBe(1); expect(saved.pricing.snapshot.total_minor).toBe(110000);
  checks.push('409 retained user draft; explicit reload retained dirty note and adopted untouched server count before retry');
  await page.screenshot({ path: resolve(report, '03-persisted-detail.png'), fullPage: true });
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Next period', exact: true }).click();
  const calendarStay = page.getByRole('button', { name: /PW PostgreSQL Guest, Room 101/ });
  await calendarStay.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(report, '04-persisted-calendar.png'), fullPage: true });
  await calendarStay.click();
  await expect(page).toHaveURL(new RegExp(`/reservations/${saved.id}$`));
  checks.push('Existing calendar renders the persisted stay and opens canonical UUID details');
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await fillCreate('2026-11-10T14:07', 'Uncertain committed response');
  await page.getByRole('button', { name: 'Save reservation', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('already booked');
  await expect(page.getByLabel('Reservation notes')).toHaveValue('Uncertain committed response');
  expect(await (await context.request.get(`${api}/api/v1/reservations`)).json()).toHaveLength(1);
  checks.push('Room 409 conflict retained create draft and did not overwrite the existing booking');
  await page.getByLabel('Arrival (Asia/Manila)', { exact: true }).fill('2026-11-11T14:07');
  const dropResponse = async route => { await route.fetch(); await route.abort('failed'); };
  await context.route(`${api}/api/v1/reservations`, dropResponse);
  await page.getByRole('button', { name: 'Save reservation', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not be confirmed');
  expect(await (await context.request.get(`${api}/api/v1/reservations`)).json()).toHaveLength(2);
  await context.unroute(`${api}/api/v1/reservations`, dropResponse);
  await page.getByRole('button', { name: 'Retry original request', exact: true }).click();
  await expect(page).toHaveURL(/\/reservations\/[0-9a-f-]{36}$/);
  expect(await (await context.request.get(`${api}/api/v1/reservations`)).json()).toHaveLength(2);
  checks.push('Lost response after real commit replayed the original key without duplicate booking');
  const offline = route => route.abort('failed');
  await context.route(`${api}/api/v1/**`, offline);
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('API unavailable');
  await expect(page.getByRole('heading', { name: 'Reservation not found' })).toHaveCount(0);
  await expect(page.getByText('John Doe', { exact: true })).toHaveCount(0);
  await context.unroute(`${api}/api/v1/**`, offline);
  await page.getByRole('button', { name: 'Retry loading API data' }).click();
  await expect(page.getByTestId('saved-note')).toHaveText('Uncertain committed response');
  checks.push('Offline bootstrap showed explicit unavailable state and no empty/demo fallback; recovery loaded PostgreSQL data');
  demo = await browser.newContext({ timezoneId: 'Asia/Manila' });
  const demoPage = await demo.newPage(); let demoApiRequests = 0;
  demoPage.on('request', request => { if (request.url().startsWith(api)) demoApiRequests++; });
  await demoPage.goto('http://127.0.0.1:5174/guests');
  await expect(demoPage.getByText('Admin User', { exact: true })).toBeVisible();
  await expect(demoPage.getByText('John Doe', { exact: true })).toBeVisible();
  await expect(demoPage.getByText('PW PostgreSQL Guest', { exact: true })).toHaveCount(0);
  expect(demoApiRequests).toBe(0);
  checks.push('Demo mode remained independent and fetched no API data');
  await writeFile(resolve(report, 'results.json'), JSON.stringify({ status: 'PASS', checks, reservation_id: saved.id, version: saved.version }, null, 2));
  console.log(`PASS: ${checks.length} genuine browser integration checks; artifacts ${report}`);
} catch (error) {
  if (page) {
    await page.screenshot({ path: resolve(report, 'failure.png'), fullPage: true });
    await writeFile(resolve(report, 'failure.html'), await page.content());
  }
  await writeFile(resolve(report, 'results.json'), JSON.stringify({ status: 'FAIL', checks, error: String(error) }, null, 2));
  throw error;
} finally {
  if (context) { await context.tracing.stop({ path: resolve(report, 'trace.zip') }); await context.close(); }
  if (demo) await demo.close(); if (browser) await browser.close();
  for (const child of children) { child.kill(); await new Promise(r => child.exitCode !== null ? r() : child.once('exit', r)); }
  for (const log of logs) log.end();
}
