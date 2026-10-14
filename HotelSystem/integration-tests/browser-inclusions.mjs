import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const api = process.env.HMS_INTEGRATION_API, report = process.env.HMS_INTEGRATION_REPORT;
if (!api || !report) throw new Error('Use run-inclusions.py and its synthetic hms_test company.');
const processes = [], logs = [], checks = [];
let browser, context, demo, page;
async function server(port, mode) {
  const log = createWriteStream(resolve(report, `vite-${mode}.log`)); logs.push(log);
  const child = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { env: { ...process.env, VITE_HMS_DATA_MODE: mode, VITE_HMS_API_URL: api }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  processes.push(child); child.stdout.pipe(log); child.stderr.pipe(log);
  for (let i=0;i<100;i++) {
    if (child.exitCode !== null) throw new Error('Owned Vite exited');
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) return; } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Vite readiness timeout');
}
try {
  await Promise.all([server(5183, 'api'), server(5184, 'demo')]);
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ timezoneId: 'Asia/Manila', viewport: { width: 1600, height: 1050 }, recordVideo: { dir: resolve(report,'video') } });
  await context.tracing.start({ screenshots: true, snapshots: true });
  page = await context.newPage();
  const fail = route => route.abort('failed');
  const refs = async () => (await context.request.get(`${api}/api/v1/reference-data`)).json();
  const record = async id => (await context.request.get(`${api}/api/v1/reservations/${id}`)).json();
  await page.goto('http://127.0.0.1:5183/inventory');
  const category = (await refs()).inventory_categories.find(c => c.type === 'inclusion');
  for (const label of ['PW Towel', 'PW Water', 'PW Soap']) {
    await page.getByRole('button', { name: 'Add product', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add product', exact: true });
    await dialog.getByRole('combobox').selectOption(category.id);
    await dialog.getByLabel('Product name', { exact: true }).fill(label);
    await dialog.getByLabel('Unit price', { exact: false }).fill('900');
    await dialog.getByRole('button', { name: 'Add product', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  const products = (await refs()).catalog_products;
  const towel = products.find(p => p.label === 'PW Towel'), water = products.find(p => p.label === 'PW Water'), soap = products.find(p => p.label === 'PW Soap');
  expect(products.every(p => !p.available_for_sale)).toBe(true);
  checks.push('Original Inventory creates shared-storage non-sellable inclusion definitions');

  await page.goto('http://127.0.0.1:5183/configuration');
  await page.getByRole('row').filter({ hasText: 'Standard' }).getByRole('button', { name: 'Edit', exact: true }).click();
  let form = page.locator('form');
  await form.getByLabel('Add default inclusion', { exact: true }).selectOption(towel.id);
  await form.getByLabel('Default PW Towel quantity', { exact: true }).fill('2');
  await context.route(`${api}/api/v1/configuration/room-types/*`, fail);
  await form.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('p[role="status"]')).toContainText('not confirmed');
  await expect(form.getByLabel('Default PW Towel quantity', { exact: true })).toHaveValue('2');
  await context.unroute(`${api}/api/v1/configuration/room-types/*`, fail);
  await form.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('p[role="status"]')).toContainText('committed to PostgreSQL');
  await page.reload();
  await page.getByRole('row').filter({ hasText: 'Standard' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('form').getByLabel('Default PW Towel quantity', { exact: true })).toHaveValue('2');
  checks.push('Configuration defaults retain failed draft, retry and reopen after refresh');

  await page.goto('http://127.0.0.1:5183/rooms');
  await page.getByRole('button', { name: 'Room types', exact: true }).click();
  await page.getByRole('button', { name: 'Add room type', exact: true }).click();
  let typeDialog = page.getByRole('dialog', { name: 'Add room type', exact: true });
  await typeDialog.getByLabel('Name', { exact: true }).fill('PW Other');
  await typeDialog.getByLabel('Add default inclusion', { exact: true }).selectOption(towel.id);
  await typeDialog.getByLabel('Default PW Towel quantity', { exact: true }).fill('9');
  await typeDialog.getByRole('button', { name: 'Add room type', exact: true }).click();
  await expect(typeDialog).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Room types', exact: true }).click();
  await page.getByRole('heading', { name: 'PW Other', exact: true }).click();
  typeDialog = page.getByRole('dialog', { name: 'Edit room type', exact: true });
  await expect(typeDialog.getByLabel('Default PW Towel quantity', { exact: true })).toHaveValue('9');
  await typeDialog.getByRole('button', { name: 'Close room type form' }).click();
  await page.getByRole('button', { name: 'Add room type', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add room type' }).getByLabel('Add default inclusion')).toHaveValue('');
  await page.getByRole('button', { name: 'Close room type form' }).click();
  const currentRefs = await refs(), other = currentRefs.room_types.find(t => t.label === 'PW Other');
  const write = async (kind, body) => {
    const r = await context.request.post(`${api}/api/v1/configuration/${kind}`, { data: body, headers: { 'Idempotency-Key': randomUUID() } });
    expect(r.status()).toBe(201); return r.json();
  };
  await write('rooms', { number: '202', room_type_id: other.id });
  await write('rates', { room_type_id: other.id, duration_id: currentRefs.durations[0].id, booking_kind: 'hourly', unit_amount_minor: 70000 });
  checks.push('Dedicated Rooms room-type defaults create, persist, reopen and reset independently');

  await page.goto('http://127.0.0.1:5183/');
  await page.getByRole('button', { name: '+ Create Reservation', exact: true }).click();
  let pane = page.getByRole('dialog', { name: 'Create reservation', exact: true });
  await pane.getByRole('button', { name: '+ Create new guest', exact: true }).click();
  await pane.getByLabel('Full name', { exact: false }).fill('PW Inclusion Guest');
  await pane.getByRole('button', { name: 'Use guest', exact: true }).click();
  await pane.getByLabel('Check-in', { exact: false }).fill('2026-12-20T14:00');
  await pane.getByLabel('Choose available room', { exact: true }).selectOption('101');
  await pane.getByRole('button', { name: '+ Add room', exact: true }).click();
  await expect(pane.getByLabel('PW Towel quantity', { exact: true })).toHaveValue('2');
  await pane.getByRole('button', { name: 'Create Reservation', exact: true }).click();
  await expect(pane).toHaveCount(0);
  let saved = (await (await context.request.get(`${api}/api/v1/reservations`)).json())[0];
  expect(saved.allocation.inclusions[0].source).toBe('default');
  expect(saved.pricing.snapshot.total_minor).toBe(110000);
  const originalPricing = saved.pricing;
  async function edit() {
    await page.goto(`http://127.0.0.1:5183/reservations/${saved.id}`);
    await page.getByRole('button', { name: 'Edit details', exact: true }).click();
    const p = page.getByRole('dialog', { name: 'Edit reservation', exact: true });
    await p.getByRole('button', { name: 'Configure', exact: true }).click(); return p;
  }
  pane = await edit();
  await pane.getByLabel('PW Towel quantity', { exact: true }).fill('4');
  await pane.getByLabel('PW Water quantity', { exact: true }).fill('3');
  await context.route(`${api}/api/v1/reservations/${saved.id}/edit-inclusions`, fail);
  await pane.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(pane.getByRole('alert')).toContainText('not confirmed');
  await expect(pane.getByLabel('PW Towel quantity', { exact: true })).toHaveValue('4');
  await context.unroute(`${api}/api/v1/reservations/${saved.id}/edit-inclusions`, fail);
  await pane.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(pane).toHaveCount(0);
  await page.reload(); saved = await record(saved.id);
  expect(saved.pricing).toEqual(originalPricing);
  checks.push('Original create defaults and detail manual overrides persist without billing or lost failed drafts');

  pane = await edit();
  await pane.getByLabel('PW Towel quantity', { exact: true }).fill('5');
  const remote = await context.request.post(`${api}/api/v1/reservations/${saved.id}/edit-inclusions`, { headers: { 'Idempotency-Key': randomUUID() }, data: { expected_version: saved.version, guest_id: saved.guest.id, inclusions: [...saved.allocation.inclusions.map(i => ({ product_id: i.product_id, quantity: i.quantity, overridden: i.overridden })), { product_id: soap.id, quantity: 2 }] } });
  expect(remote.status()).toBe(200);
  await pane.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(pane.getByRole('button', { name: /Load latest version for review/ })).toBeVisible();
  await pane.getByRole('button', { name: /Load latest version for review/ }).click();
  await expect(pane.getByLabel('PW Towel quantity', { exact: true })).toHaveValue('5');
  await pane.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(pane).toHaveCount(0); saved = await record(saved.id);
  expect(saved.allocation.inclusions.find(i => i.product_id === soap.id).quantity).toBe(2);
  pane = await edit();
  await pane.getByLabel('Assigned room 101', { exact: true }).selectOption('202');
  await expect(pane.getByLabel('PW Towel quantity', { exact: true })).toHaveValue('5');
  await pane.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(pane).toHaveCount(0); await page.reload();
  saved = await record(saved.id);
  expect(saved.allocation.inclusions.find(i => i.product_id === water.id).quantity).toBe(3);
  expect(saved.pricing.snapshot.total_minor).toBe(70000);
  await page.goto(`http://127.0.0.1:5183/reservations/${saved.id}/print`);
  await expect(page.getByText(/PW Towel/).first()).toBeVisible();
  await page.screenshot({ path: resolve(report,'inclusions-print.png'), fullPage: true });
  checks.push('409 reviewed retry retains remote inclusion additions; original room reassignment retains positive overrides and manual quantities');

  demo = await browser.newContext({ timezoneId: 'Asia/Manila' });
  const dp = await demo.newPage(); let calls=0;
  dp.on('request', r => { if(r.url().startsWith(api)) calls++; });
  await dp.goto('http://127.0.0.1:5184/rooms');
  await dp.getByRole('button', { name: 'Room types', exact: true }).click();
  await dp.getByRole('button', { name: 'Add room type', exact: true }).click();
  const dd = dp.getByRole('dialog', { name: 'Add room type', exact: true });
  await dd.getByLabel('Name', { exact: true }).fill('Demo Inclusions');
  const option = await dd.getByLabel('Add default inclusion').locator('option').nth(1).getAttribute('value');
  await dd.getByLabel('Add default inclusion').selectOption(option);
  await dd.locator('input[aria-label^="Default "]').fill('3');
  await dd.getByRole('button', { name: 'Add room type', exact: true }).click();
  await expect(dd).toHaveCount(0); expect(calls).toBe(0);
  checks.push('Demo original room-type inclusion defaults remain independent with zero API calls');
  await writeFile(resolve(report,'results.json'), JSON.stringify({ status:'PASS', checks, reservation_id:saved.id },null,2));
  console.log(`PASS: ${checks.length} focused inclusion browser checks`);
} catch(error) {
  if(page) { await page.screenshot({path:resolve(report,'failure.png'),fullPage:true}); await writeFile(resolve(report,'failure.html'),await page.content()); }
  await writeFile(resolve(report,'results.json'),JSON.stringify({status:'FAIL',checks,error:String(error)},null,2)); throw error;
} finally {
  if(context) { await context.tracing.stop({path:resolve(report,'trace.zip')}); await context.close(); }
  if(demo) await demo.close(); if(browser) await browser.close();
  for(const child of processes) { child.kill(); await new Promise(r=>child.exitCode!==null?r():child.once('exit',r)); }
  for(const log of logs) log.end();
}
