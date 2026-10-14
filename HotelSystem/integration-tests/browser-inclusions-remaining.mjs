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
  const records = async () => (await context.request.get(`${api}/api/v1/reservations`)).json();
  const write = async (path, data, method='post') => {
    const r = await context.request[method](`${api}/api/v1/${path}`, { data, headers:{'Idempotency-Key':randomUUID()} });
    expect(r.ok()).toBe(true); return r.json();
  };
  const initial = await refs(), type = initial.room_types[0], category = initial.inventory_categories.find(c=>c.type==='inclusion');
  const towel = await write('configuration/products',{label:'PW Remaining Towel',category_id:category.id,unit_amount_minor:30000,available_for_sale:false});
  const water = await write('configuration/products',{label:'PW Remaining Water',category_id:category.id,unit_amount_minor:7500,available_for_sale:false});
  await write(`configuration/room-types/${type.id}`,{label:type.label,expected_version:type.version,default_inclusions:[{product_id:towel.id,quantity:2}]},'patch');
  await write('guests',{name:'PW Remaining Guest'});

  await page.goto('http://127.0.0.1:5183/configuration');
  const typeRow = () => page.getByRole('row').filter({hasText:'Standard'});
  await typeRow().getByRole('button',{name:'Edit',exact:true}).click();
  let form = page.locator('form');
  await form.getByRole('button',{name:'Remove default PW Remaining Towel',exact:true}).click();
  await form.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.locator('p[role="status"]')).toContainText('committed to PostgreSQL');
  expect((await refs()).room_types[0].default_inclusions).toEqual([]);
  await page.reload(); await typeRow().getByRole('button',{name:'Edit',exact:true}).click();
  await expect(page.getByLabel('Default PW Remaining Towel quantity')).toHaveCount(0);
  await page.getByLabel('Add default inclusion').selectOption(towel.id);
  await page.getByLabel('Default PW Remaining Towel quantity').fill('2');
  await page.locator('form').getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.locator('p[role="status"]')).toContainText('committed to PostgreSQL');
  checks.push('Configuration default clear persists empty list and reopens empty; re-add restores explicit quantity');

  await page.goto('http://127.0.0.1:5183/rooms');
  await page.getByRole('button',{name:'Room types',exact:true}).click();
  await page.getByRole('heading',{name:'Standard',exact:true}).click();
  let dialog = page.getByRole('dialog',{name:'Edit room type',exact:true});
  await dialog.getByRole('button',{name:'Remove default PW Remaining Towel',exact:true}).click();
  await dialog.getByRole('button',{name:'Save room type',exact:true}).click();
  await expect(dialog).toHaveCount(0); await page.reload();
  await page.getByRole('button',{name:'Room types',exact:true}).click();
  await page.getByRole('heading',{name:'Standard',exact:true}).click();
  dialog = page.getByRole('dialog',{name:'Edit room type',exact:true});
  await expect(dialog.getByLabel('Default PW Remaining Towel quantity')).toHaveCount(0);
  await dialog.getByLabel('Add default inclusion').selectOption(towel.id);
  await dialog.getByLabel('Default PW Remaining Towel quantity').fill('2');
  await dialog.getByRole('button',{name:'Save room type',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'Add room type',exact:true}).click();
  const addType = page.getByRole('dialog',{name:'Add room type',exact:true});
  await addType.getByLabel('Add default inclusion').selectOption(towel.id);
  await addType.getByLabel('Default PW Remaining Towel quantity').fill('3');
  await addType.getByRole('button',{name:'Close room type form'}).click();
  await page.getByRole('button',{name:'Add room type',exact:true}).click();
  await expect(addType.getByLabel('Default PW Remaining Towel quantity')).toHaveCount(0);
  await addType.getByRole('button',{name:'Close room type form'}).click();
  checks.push('Dedicated room-type default clear/edit persists; close/reopen discards only unsaved add-form selections');

  await page.goto('http://127.0.0.1:5183/configuration');
  await page.getByRole('button',{name:'Inclusions & Extras',exact:true}).click();
  form = page.locator('form');
  await form.getByLabel('Name',{exact:true}).fill('PW Remaining Catalog');
  await form.getByLabel('Category',{exact:true}).selectOption(category.id);
  await form.getByLabel('Unit price',{exact:true}).fill('25.50');
  await form.getByRole('button',{name:'Add configuration',exact:true}).click();
  await expect(page.locator('p[role="status"]')).toContainText('committed to PostgreSQL');
  await page.reload();
  const catalog = (await refs()).catalog_products.find(p=>p.label==='PW Remaining Catalog');
  expect(catalog.unit_amount_minor).toBe(2550); expect(catalog.available_for_sale).toBe(false);
  checks.push('Generic Configuration creates inclusion product with exact metadata price and non-sellable classification');

  await page.goto('http://127.0.0.1:5183/');
  await page.getByRole('button',{name:'month',exact:true}).click();
  const date = new Date(Date.now()+96*3600000);
  const dateLabel = new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeZone:'Asia/Manila'}).format(date);
  await page.getByRole('button',{name:`Select Room 101 on ${dateLabel}`,exact:true}).click();
  let pane = page.getByRole('dialog',{name:'Create reservation',exact:true});
  await pane.getByRole('button',{name:/PW Remaining Guest/}).click();
  if(await pane.getByRole('button',{name:'Configure',exact:true}).count()) await pane.getByRole('button',{name:'Configure',exact:true}).click();
  await expect(pane.getByLabel('PW Remaining Towel quantity',{exact:true})).toHaveValue('2');
  await context.route(`${api}/api/v1/reservations`,fail);
  await pane.getByRole('button',{name:'Create Reservation',exact:true}).click();
  await expect(pane.getByRole('alert')).toContainText('not confirmed');
  await expect(pane.getByLabel('PW Remaining Towel quantity',{exact:true})).toHaveValue('2');
  await context.unroute(`${api}/api/v1/reservations`,fail);
  expect(await records()).toHaveLength(0);
  await pane.getByRole('button',{name:'Create Reservation',exact:true}).click();
  await expect(pane).toHaveCount(0); await page.reload();
  let saved = (await records())[0]; const originalPricing = saved.pricing;
  expect(saved.allocation.inclusions.find(i=>i.product_id===towel.id).quantity).toBe(2);
  checks.push('Calendar empty-cell create preserves room default/inclusions, failed draft and no-phantom retry; refresh retains captures');

  async function calendarEdit() {
    await page.goto('http://127.0.0.1:5183/');
    await page.getByRole('button',{name:'month',exact:true}).click();
    await page.getByRole('button',{name:/PW Remaining Guest, Room 101, confirmed/}).press('Enter');
    await page.getByRole('button',{name:'Edit',exact:true}).click();
    const p = page.getByRole('dialog',{name:'Edit reservation',exact:true});
    if(await p.getByRole('button',{name:'Configure',exact:true}).count()) await p.getByRole('button',{name:'Configure',exact:true}).click();
    return p;
  }
  pane = await calendarEdit();
  await pane.getByLabel('PW Remaining Towel quantity',{exact:true}).fill('0');
  await pane.getByLabel('PW Remaining Water quantity',{exact:true}).fill('3');
  await pane.getByRole('button',{name:'Save Changes',exact:true}).click();
  await expect(pane).toHaveCount(0); await page.reload(); saved=(await records())[0];
  expect(saved.pricing).toEqual(originalPricing);
  expect(saved.allocation.inclusions.find(i=>i.product_id===towel.id)).toMatchObject({quantity:0,source:'default',overridden:true});
  pane = await calendarEdit();
  await expect(pane.getByLabel('PW Remaining Towel quantity',{exact:true})).toHaveValue('0');
  await expect(pane.getByLabel('PW Remaining Water quantity',{exact:true})).toHaveValue('3');
  await pane.getByRole('button',{name:'Save Changes',exact:true}).click();
  await expect(pane).toHaveCount(0);
  expect((await records())[0].version).toBe(saved.version);
  checks.push('Calendar summary Edit persists zero default override/manual quantity; reopen/no-op preserves provenance and pricing');

  await page.goto('http://127.0.0.1:5183/inventory');
  await page.getByRole('button',{name:/PW Remaining Catalog/}).click();
  dialog = page.getByRole('dialog',{name:'Item details: PW Remaining Catalog',exact:true});
  await dialog.getByRole('button',{name:'Archive',exact:true}).click();
  await expect(dialog).toHaveCount(0); await page.reload();
  expect((await refs()).catalog_products.find(p=>p.id===catalog.id).archived).toBe(true);
  await page.goto('http://127.0.0.1:5183/configuration');
  await page.getByRole('button',{name:'Inclusions & Extras',exact:true}).click();
  await page.getByRole('row').filter({hasText:'PW Remaining Catalog'}).getByRole('button',{name:'Edit',exact:true}).click();
  await page.locator('form').getByLabel('Unit price',{exact:true}).fill('30.50');
  await page.locator('form').getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.locator('p[role="status"]')).toContainText('committed to PostgreSQL');
  const archived = (await refs()).catalog_products.find(p=>p.id===catalog.id);
  expect(archived.archived).toBe(true); expect(archived.enabled).toBe(false);
  await page.goto('http://127.0.0.1:5183/inventory');
  await page.getByLabel('Show archived').check();
  await page.getByRole('button',{name:/PW Remaining Catalog/}).click();
  dialog = page.getByRole('dialog',{name:'Item details: PW Remaining Catalog',exact:true});
  await dialog.getByRole('button',{name:'Restore',exact:true}).click();
  await expect(dialog).toHaveCount(0); await page.reload();
  const restored = (await refs()).catalog_products.find(p=>p.id===catalog.id);
  expect(restored).toMatchObject({archived:false,enabled:true,available_for_sale:false,unit_amount_minor:3050});
  expect((await records())[0].pricing).toEqual(originalPricing);
  checks.push('Inclusion archive metadata survives generic definition edit; original Inventory restore persists without billing changes');
  await page.screenshot({path:resolve(report,'remaining-inclusions.png'),fullPage:true});
  await writeFile(resolve(report,'results.json'),JSON.stringify({status:'PASS',checks,reservation_id:saved.id},null,2));
  console.log(`PASS: ${checks.length} remaining inclusion checks`);
} catch(error) {
  if(page) { await page.screenshot({path:resolve(report,'failure.png'),fullPage:true}); await writeFile(resolve(report,'failure.html'),await page.content()); }
  await writeFile(resolve(report,'results.json'),JSON.stringify({status:'FAIL',checks,error:String(error)},null,2)); throw error;
} finally {
  if(context) { await context.tracing.stop({path:resolve(report,'trace.zip')}); await context.close(); }
  if(demo) await demo.close(); if(browser) await browser.close();
  for(const child of processes) { child.kill(); await new Promise(r=>child.exitCode!==null?r():child.once('exit',r)); }
  for(const log of logs) log.end();
}
