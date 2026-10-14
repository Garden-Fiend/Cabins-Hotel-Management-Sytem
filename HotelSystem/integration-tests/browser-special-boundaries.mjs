import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const api = process.env.HMS_INTEGRATION_API, report = process.env.HMS_INTEGRATION_REPORT;
if (!api || !report) throw new Error('Use run-special-boundaries.py');
const checks = [], log = createWriteStream(resolve(report, 'vite.log'));
let child, browser, context, page;
try {
  child = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5183', '--strictPort'], { env: {...process.env, VITE_HMS_DATA_MODE:'api', VITE_HMS_API_URL:api}, windowsHide:true, stdio:['ignore','pipe','pipe'] });
  child.stdout.pipe(log); child.stderr.pipe(log);
  for (let i=0;i<100;i++) {
    if(child.exitCode !== null) throw new Error('Owned Vite exited');
    try {if ((await fetch('http://127.0.0.1:5183')).ok) break;} catch { /* startup */ }
    await new Promise(r=>setTimeout(r,100));
  }
  browser = await chromium.launch({headless:true});
  context = await browser.newContext({timezoneId:'Asia/Manila',viewport:{width:1600,height:1050},recordVideo:{dir:resolve(report,'video')}});
  await context.tracing.start({screenshots:true,snapshots:true});
  page = await context.newPage();
  const write = async(path,data,method='POST')=>{
    const result=await context.request.fetch(`${api}/api/v1/${path}`,{method,data,headers:{'Idempotency-Key':randomUUID()}});
    expect(result.ok(),await result.text()).toBe(true);return result.json();
  };
  const refs=async()=>(await context.request.get(`${api}/api/v1/reference-data`)).json();
  const original=await refs();
  const ordinary=await write('configuration/categories',{label:'Boundary meals',type:'ordinary'});
  const meal=await write('configuration/products',{label:'Historical meal',category_id:ordinary.id,unit_amount_minor:15000});
  const drink=await write('configuration/products',{label:'Historical drink',category_id:ordinary.id,unit_amount_minor:5000});
  const inclusion=original.inventory_categories.find(c=>c.type==='inclusion');
  const towel=await write('configuration/products',{label:'Historical towel',category_id:inclusion.id,unit_amount_minor:0,available_for_sale:false});
  const type=original.room_types[0];
  await write(`configuration/room-types/${type.id}`,{label:type.label,expected_version:type.version,default_inclusions:[{product_id:towel.id,quantity:2}]},'PATCH');
  await write('configuration/breakfast',{expected_version:original.company.breakfast_version,items:[{product_id:meal.id,kind:'meal',enabled:true},{product_id:drink.id,kind:'beverage',enabled:true}]});
  const night=await write('configuration/durations',{label:'Boundary two nights',kind:'overnight',nights:2});
  await write('configuration/rates',{room_type_id:type.id,booking_kind:'overnight',unit_amount_minor:225075});
  const guest=await write('guests',{name:'Boundary guest'});
  const today=new Date(), start=new Date(today.getTime()+3*86400000), day=new Date(start.getTime()+8*3600000).toISOString().slice(0,10);
  const service=new Date(Date.parse(`${day}T00:00:00+08:00`)+32*3600000).toISOString().slice(0,10);
  let saved=await write('reservations',{guest_id:guest.id,booking_source_id:original.booking_sources[0].id,room_id:original.rooms[0].id,duration_id:night.id,scheduled_start:`${day}T14:00:00+08:00`,adults:1,children:1,breakfast:[1,2].map(guest_number=>({service_date:service,guest_number,status:'included',meal_id:meal.id,beverage_id:drink.id}))});
  await write(`configuration/products/${meal.id}`,{label:'Retired renamed meal',category_id:meal.category_id,unit_amount_minor:99999,archived:true,available_for_sale:true,expected_version:meal.version},'PATCH');
  await write(`configuration/products/${towel.id}`,{label:'Renamed towel',category_id:towel.category_id,unit_amount_minor:0,available_for_sale:false,expected_version:towel.version},'PATCH');
  const status=(pane,guestNumber)=>pane.getByLabel(`Breakfast Room 101 ${service} Guest ${guestNumber} status`,{exact:true});
  const edit=async()=>{
    await page.goto(`http://127.0.0.1:5183/reservations/${saved.id}`);
    await page.getByRole('button',{name:'Edit details',exact:true}).click();
    const pane=page.getByRole('dialog',{name:'Edit reservation',exact:true});
    await pane.getByRole('button',{name:'Configure',exact:true}).click();return pane;
  };
  let pane=await edit();
  await expect(pane.getByLabel(`Breakfast Room 101 ${service} Guest 1 meal`,{exact:true})).toHaveValue(meal.id);
  await expect(pane.getByLabel('Historical towel quantity',{exact:true})).toHaveValue('2');
  await pane.locator('summary').filter({hasText:'Reservation note'}).click({position:{x:10,y:10}});
  await pane.getByLabel('Reservation note',{exact:true}).fill('Retired captures retained');
  await pane.getByRole('button',{name:'Save Changes',exact:true}).click();
  await expect(pane).toHaveCount(0);
  saved=(await (await context.request.get(`${api}/api/v1/reservations/${saved.id}`)).json());
  expect(saved.allocation.breakfast[0].meal_label).toBe('Historical meal');
  expect(saved.allocation.inclusions[0].label).toBe('Historical towel');
  await page.reload();
  checks.push('Original detail edit retains retired captured recipe IDs and historical inclusion labels after product renames; persistence and reload agree');

  pane=await edit();
  await status(pane,2).selectOption('skipped');
  const remote=await write(`reservations/${saved.id}`,{expected_version:saved.version,children:0},'PATCH');
  expect(remote.allocation.breakfast).toHaveLength(1);
  await pane.getByRole('button',{name:'Save Changes',exact:true}).click();
  await expect(pane.getByRole('button',{name:/Load latest version for review/})).toBeVisible();
  await pane.getByRole('button',{name:/Load latest version for review/}).click();
  await pane.getByRole('button',{name:'Save Changes',exact:true}).click();
  await expect(pane.getByRole('alert')).toContainText('guest count');
  await expect(status(pane,2)).toHaveValue('skipped');
  const unchanged=await (await context.request.get(`${api}/api/v1/reservations/${saved.id}`)).json();
  expect(unchanged).toEqual(remote);
  saved=remote;
  checks.push('Actual 409 review rejects local breakfast choices outside remotely reduced guest quota, keeps the draft and leaves committed records unchanged');

  await page.goto('http://127.0.0.1:5183/inventory');
  await page.getByRole('button',{name:'Manage categories',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'Manage categories',exact:true});
  for(const kind of ['breakfast','inclusion']) {
    const special=(await refs()).inventory_categories.find(c=>c.type===kind);
    const label=`Collision ${kind}`;
    await write('configuration/categories',{label,type:'ordinary'});
    await page.reload();
    await page.getByRole('button',{name:'Manage categories',exact:true}).click();
    dialog=page.getByRole('dialog',{name:'Manage categories',exact:true});
    await dialog.locator('article').filter({has:page.getByRole('heading',{name:special.label,exact:true})}).getByRole('button',{name:'Rename',exact:true}).click();
    await dialog.getByLabel('Category name',{exact:true}).fill(label);
    await dialog.getByRole('button',{name:'Save',exact:true}).click();
    await expect(dialog.getByRole('status')).toContainText('committed');
    const latest=(await refs()).inventory_categories;
    expect(latest.filter(c=>c.label===label)).toHaveLength(2);
    expect(latest.find(c=>c.id===special.id)).toMatchObject({type:kind,system_defined:true});
  }
  await page.reload();
  checks.push('Original Inventory protected breakfast/inclusion Rename permits ordinary-name coexistence while preserving IDs and classification through refresh');
  await page.screenshot({path:resolve(report,'final.png'),fullPage:true});
  await writeFile(resolve(report,'results.json'),JSON.stringify({status:'PASS',checks,reservation_id:saved.id},null,2));
  console.log(`PASS: ${checks.length} focused special-boundary checks`);
} catch(error) {
  if(page){await page.screenshot({path:resolve(report,'failure.png'),fullPage:true});await writeFile(resolve(report,'failure.html'),await page.content());}
  await writeFile(resolve(report,'results.json'),JSON.stringify({status:'FAIL',checks,error:String(error)},null,2));throw error;
} finally {
  if(context){await context.tracing.stop({path:resolve(report,'trace.zip')});await context.close();}
  if(browser)await browser.close();
  if(child){child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));}log.end();
}
