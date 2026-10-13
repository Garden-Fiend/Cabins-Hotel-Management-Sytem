import { test, expect, BookingUI } from './ui.mjs';
import { scenarios } from './matrix.mjs';
import { runConfigurationCase } from './configuration-cases.mjs';

const selected=new Set((process.env.HMS_BOOKING_IDS??'').split(','));
for(const s of scenarios.filter(s=>selected.has(s.id))){
  test(`${s.id} ${s.description}`,async({page,evidence})=>{
    test.info().annotations.push({type:'rules',description:s.rules.join(', ')},{type:'priority',description:s.priority},{type:'module',description:s.module});
    test.skip(!s.implemented,s.gap || 'Scenario implementation pending.');
    const ui=new BookingUI(page,evidence), x=s.inputs;
    await ui.boot(x.record?`/reservations/${x.record}`:'/',x.now);
    switch(s.kind){
      case 'configuration': {test.setTimeout(s.id==='GAP-COMMISSION-METHODS'?180000:90000);await runConfigurationCase(s,ui);break;}
      case 'create': {
        await ui.draft(x);await ui.save(x.total);
        await evidence.step('Assert captured room rate and creation audit',async()=>{
          await expect(page.getByText(`Saved rate: ${new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(x.total)}`)).toBeVisible();
          await expect(page.getByRole('heading',{name:'Audit history',exact:true})).toBeVisible();
          await expect(page.getByText('Reservation created',{exact:true})).toBeVisible();
        });break;
      }
      case 'required': {
        await ui.draft({guest:x.missing!=='guest',addRoom:x.missing!=='room',source:x.missing==='source'?'':'direct'});
        if(x.missing==='date')await evidence.step('Clear required arrival',()=>ui.pane.getByLabel('Check-in *',{exact:true}).fill(''));
        await evidence.step('Assert incomplete booking cannot save',()=>expect(ui.pane.getByRole('button',{name:'Create Reservation',exact:true})).toBeDisabled());break;
      }
      case 'inclusionQuantity': {
        await ui.draft();await ui.configure();
        await evidence.step(`Enter inclusion quantity ${x.quantity} and assert normalization`,async()=>{
          const input=ui.pane.getByLabel('Bottled water quantity',{exact:true});await input.fill(String(x.quantity));
          await expect(input).toHaveValue(String(x.expectedQuantity));await ui.total(1100);
        });await ui.save(1100);
        await evidence.step('Assert saved inclusion quantity',async()=>{
          const section=page.locator('section').filter({has:page.getByRole('heading',{name:'Inclusions & Additional Charges',exact:true})});
          if(x.expectedQuantity===0)await expect(section).not.toContainText('Bottled water');
          else await expect(section).toContainText(`Bottled water × ${x.expectedQuantity}`);
        });break;
      }
      case 'inclusionSwitch':case 'inclusionRestore':case 'inclusionSame': {
        await ui.draft();await ui.configure();
        await evidence.step('Override inherited water and add manual towels',async()=>{
          await ui.pane.getByLabel('Bottled water quantity',{exact:true}).fill(s.kind==='inclusionRestore'?'0':'3');
          await ui.pane.getByLabel('Towels quantity',{exact:true}).fill('2');
        });
        if(s.kind==='inclusionSame'){
          await evidence.step('Reassign same room type to 102',async()=>{await ui.pane.getByLabel('Assigned room 101',{exact:true}).selectOption('102');await expect(ui.pane.getByLabel('Bottled water quantity',{exact:true})).toHaveValue('3');await ui.total(1100);});
        }else{
          await evidence.step('Switch Standard to Deluxe and assert inheritance',async()=>{
            await ui.pane.getByLabel('Assigned room 101',{exact:true}).selectOption('107');
            await expect(ui.pane.getByLabel('Bottled water quantity',{exact:true})).toHaveValue(s.kind==='inclusionRestore'?'2':'3');
            await expect(ui.pane.getByLabel('Towels quantity',{exact:true})).toHaveValue('2');
            await expect(ui.pane.getByLabel('Toiletry kit quantity',{exact:true})).toHaveValue('2');await ui.total(1500);
          });
          if(s.kind==='inclusionSwitch')await evidence.step('Switch back without accumulating or losing manual inclusions',async()=>{
            await ui.pane.getByLabel('Assigned room 107',{exact:true}).selectOption('101');
            await expect(ui.pane.getByLabel('Bottled water quantity',{exact:true})).toHaveValue('3');
            await expect(ui.pane.getByLabel('Towels quantity',{exact:true})).toHaveValue('2');
            await expect(ui.pane.getByLabel('Toiletry kit quantity',{exact:true})).toHaveValue('0');await ui.total(1100);
          });
        }
        await ui.save(s.kind==='inclusionRestore'?1500:1100);break;
      }
      case 'time': {
        await ui.draft(x);
        await evidence.step('Assert hotel-local computed checkout',()=>expect(ui.pane).toContainText(x.end));
        await ui.save(x.total);
        await evidence.step('Assert saved checkout and print agree',async()=>{
          await expect(page.locator('dd').filter({hasText:x.end}).first()).toBeVisible();
          await page.getByRole('link',{name:'Print document',exact:true}).click();
          await expect(page.locator('[data-reservation-print-document]')).toContainText(x.end);
        });
        await ui.nav('Dashboard');await page.getByRole('button',{name:'year',exact:true}).click();
        const year=Number(x.start.slice(0,4));
        for(let current=2026;current<year;current++)await page.getByRole('button',{name:'Next period',exact:true}).click();
        await evidence.step('Verify year geometry across the saved timestamp boundary',async()=>{
          const arrival=new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Manila'}).format(new Date(x.start+'+08:00'));
          const bar=page.locator(`[data-testid="occupancy-interval"][aria-label^="John Doe, Room 101, confirmed, ${arrival} to "]`);await expect(bar).toHaveCount(1);
          const endISO={'TIME-MIDNIGHT':'2026-11-11T04:30','TIME-MONTH':'2026-12-01T07:45','TIME-YEAR':'2027-01-01T05:30','TIME-LEAP':'2028-03-01T12:00','TIME-MINUTE':'2026-11-10T20:07'}[s.id];
          const ratio=iso=>{const y=Number(iso.slice(0,4)),m=Number(iso.slice(5,7));if(y>year)return 1;const start=Date.parse(`${y}-${String(m).padStart(2,'0')}-01T00:00:00+08:00`);const next=m===12?Date.parse(`${y+1}-01-01T00:00:00+08:00`):Date.parse(`${y}-${String(m+1).padStart(2,'0')}-01T00:00:00+08:00`);return(m-1+(Date.parse(iso+'+08:00')-start)/(next-start))/12;};
          const box=await bar.evaluate(element=>{const b=element.getBoundingClientRect(),p=element.parentElement.parentElement.getBoundingClientRect();return{left:b.left-p.left,right:b.right-p.left,width:b.width,parent:p.width};});
          expect(Math.abs(box.left-box.parent*ratio(x.start))).toBeLessThanOrEqual(1);expect(Math.abs(box.right-box.parent*ratio(endISO))).toBeLessThanOrEqual(1);
          evidence.geometry=[{view:'year',...box,expectedStart:ratio(x.start),expectedEnd:ratio(endISO)}];
        });break;
      }
      case 'unavailable': {
        await ui.draft({addRoom:false});
        await evidence.step(`Assert blocked Room ${x.room} disabled`,()=>expect(ui.pane.getByLabel('Choose available room').locator(`option[value="${x.room}"]`)).toBeDisabled());break;
      }
      case 'conflict':case 'touch':case 'editConflict': {
        await ui.draft();await ui.save(1100);
        const first=page.url().split('/').pop();
        await ui.nav('Dashboard');
        await ui.draft({start:s.kind==='touch'?'2026-11-10T20:00':'2026-11-10T14:00',addRoom:false});
        await evidence.step('Assert overlap or touching endpoint availability',()=>expect(ui.pane.getByLabel('Choose available room').locator('option[value="101"]'))[s.kind==='touch'?'toBeEnabled':'toBeDisabled']());
        if(s.kind==='editConflict'){
          await ui.pane.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Discard',exact:true}).click();
          await ui.draft({start:'2026-11-10T20:00'});await ui.save(1100);await ui.edit();
          await evidence.step('Move saved stay into first reservation interval',()=>ui.pane.getByLabel('Check-in *',{exact:true}).fill('2026-11-10T15:00'));
          await evidence.step('Assert conflict warning and rejected save',async()=>{
            await expect(ui.pane.locator('footer')).toContainText('unavailable');
            await ui.pane.getByRole('button',{name:'Save Changes',exact:true}).click();
            await expect(ui.pane.getByRole('alert')).toContainText('no longer available');
          });
          evidence.actual=`Edit conflict rejected against ${first}; unchanged record remains behind editor.`;
        }else if(s.kind==='touch'){await ui.addRoom('101');await ui.save(1100);}
        break;
      }
      case 'duplicateRoom': {
        await ui.draft();await evidence.step('Assert selected room is disabled for duplicate assignment',async()=>{
          await expect(ui.pane.getByLabel('Choose available room').locator('option[value="101"]')).toBeDisabled();
          await expect(ui.pane.getByRole('button',{name:'Remove room 101',exact:true})).toHaveCount(1);await ui.total(1100);
        });await ui.save(1100);break;
      }
      case 'lifecycle': {
        await ui.draft();await ui.addRoom('102');const id=await ui.save(2200);
        await evidence.step('Check in all assigned rooms',async()=>{await page.getByRole('button',{name:'Check in',exact:true}).click();await expect(page.getByText(/Status: checked in/)).toBeVisible();await expect(page.getByText('Guest checked in',{exact:true})).toBeVisible();});
        await ui.nav('Dashboard');await page.getByRole('button',{name:'month',exact:true}).click();
        await evidence.step('Assert calendar has both occupied room stays',()=>expect(page.getByRole('button').filter({hasText:/John Doe\s*occupied/})).toHaveCount(2));
        await ui.nav('Reservations');await evidence.step('Reopen checked-in reservation details',async()=>{await page.getByRole('link',{name:id,exact:true}).click();await expect(page.getByRole('heading',{name:id,exact:true})).toBeVisible();});
        await evidence.step('Check out every room and assert Dirty readiness and audit',async()=>{
          await page.getByRole('button',{name:'Check out',exact:true}).click();await expect(page.getByText(/Status: checked out/)).toBeVisible();
          await expect(page.getByText('Housekeeping readiness: dirty',{exact:true})).toHaveCount(2);await expect(page.getByText('Guest checked out',{exact:true})).toBeVisible();await ui.channelValue('Total guest charges',2200);
          await expect(page.getByText('Actual check-out',{exact:true}).locator('xpath=following-sibling::dd[1]')).toHaveText('Nov 10, 2026, 3:00 PM');
        });
        await ui.nav('Dashboard');await expect(page.getByRole('button').filter({hasText:/John Doe\s*occupied/})).toHaveCount(0);await ui.draft({addRoom:false});
        await evidence.step('Assert departed rooms available for reservation despite Dirty readiness',async()=>{for(const room of ['101','102'])await expect(ui.pane.getByLabel('Choose available room').locator(`option[value="${room}"]`)).toBeEnabled();});break;
      }
      case 'checkinBoundary': {
        await ui.draft();await ui.save(1100);
        await evidence.step('Attempt check-in at fixed boundary',async()=>{
          await page.getByRole('button',{name:'Check in',exact:true}).click();
          if(x.allowed)await expect(page.getByText(/Status: checked in/)).toBeVisible();
          else {await expect(page.getByRole('status')).toContainText('scheduled');await expect(page.getByText(/Status: confirmed/)).toBeVisible();}
        });break;
      }
      case 'overdue': {
        await ui.nav('Dashboard');await page.getByRole('button',{name:'month',exact:true}).click();
        await evidence.step('Assert strict overdue threshold for saved Bob Wilson stay',async()=>{
          const bar=page.getByRole('button').filter({hasText:/Bob Wilson/});await expect(bar).toHaveCount(1);
          await expect(bar).toContainText(x.overdue?'overdue':'occupied');
        });break;
      }
      case 'future': {
        await evidence.step('Reject future check-in',async()=>{await page.getByRole('button',{name:'Check in',exact:true}).click();await expect(page.getByRole('status')).toContainText('scheduled stay');await expect(page.getByText(/Status: confirmed/)).toBeVisible();});break;
      }
      case 'cancelFuture': {
        await ui.draft({start:'2026-11-11T14:00'});await ui.save(1100);
        await evidence.step('Cancel unoccupied confirmed booking',async()=>{
          await page.getByRole('button',{name:'Cancel reservation',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Confirm cancellation',exact:true}).click();
          await expect(page.getByText(/Status: cancelled/)).toBeVisible();await expect(page.getByRole('button',{name:'Record Guest Departure',exact:true})).toHaveCount(0);await ui.channelValue('Total guest charges',1100);
        });await ui.nav('Dashboard');await ui.draft({start:'2026-11-11T14:00',addRoom:false});
        await evidence.step('Assert cancelled booking releases room',()=>expect(ui.pane.getByLabel('Choose available room').locator('option[value="101"]')).toBeEnabled());break;
      }
      case 'cancelOccupied': {
        await evidence.step('Cancel occupied reservation using explicit departure choice',async()=>{
          await page.getByRole('button',{name:'Cancel reservation',exact:true}).click();
          await page.getByRole('alertdialog').getByRole('button',{name:x.vacated?'Yes, guest vacated':'No, retain occupancy lock',exact:true}).click();
          await expect(page.getByText(/Status: cancelled/)).toBeVisible();
          if(x.vacated){await expect(page.getByText('Housekeeping readiness: dirty',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Record Guest Departure',exact:true})).toHaveCount(0);}
          else await expect(page.getByRole('alert')).toContainText('202');
        });
        if(!x.vacated){
          await ui.nav('Dashboard');await ui.draft({start:'2027-01-01T14:00',addRoom:false});
          await evidence.step('Assert retained occupancy blocks far-future room assignment',()=>expect(ui.pane.getByLabel('Choose available room').locator('option[value="202"]')).toBeDisabled());
          await ui.pane.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Discard',exact:true}).click();
          await ui.nav('Reservations');await page.getByRole('link',{name:'DEMO-6',exact:true}).click();
          await evidence.step('Record actual departure and release lock',async()=>{await page.getByRole('button',{name:'Record Guest Departure',exact:true}).click();await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.getByText('Housekeeping readiness: dirty',{exact:true})).toBeVisible();});
        }
        await ui.nav('Dashboard');await ui.draft({start:'2027-01-01T14:00',addRoom:false});
        await evidence.step('Assert actual departure makes room bookable again',()=>expect(ui.pane.getByLabel('Choose available room').locator('option[value="202"]')).toBeEnabled());
        break;
      }
      case 'noShow': {
        await evidence.step('Attempt No-show transition',async()=>{
          await page.getByRole('button',{name:'Mark No-show',exact:true}).click();
          if(x.allowed){await expect(page.getByText(/Status: No-show/)).toBeVisible();await expect(page.getByRole('button',{name:'Check in',exact:true})).toHaveCount(0);}
          else {await expect(page.getByRole('status')).toContainText('only after scheduled check-in');await expect(page.getByText(/Status: confirmed/)).toBeVisible();}
        });
        if(x.allowed){
          await ui.nav('Dashboard');await page.getByRole('button',{name:'month',exact:true}).click();
          await evidence.step('Assert no-show is hidden by default and retained when inactive records are shown',async()=>{await expect(page.getByRole('button').filter({hasText:/Jane Smith\s*no show/})).toHaveCount(0);await page.getByRole('checkbox',{name:'Show inactive reservations',exact:true}).check();await expect(page.getByRole('button').filter({hasText:/Jane Smith\s*no show/})).toHaveCount(1);});
          await ui.draft({start:'2026-10-18T14:00',addRoom:false});await evidence.step('Assert no-show releases its original assigned room interval',()=>expect(ui.pane.getByLabel('Choose available room').locator('option[value="204"]')).toBeEnabled());
        }
        break;
      }
      case 'terminal': {
        await page.getByRole('button',{name:'Check out',exact:true}).click();
        await evidence.step('Assert terminal lifecycle controls unavailable',async()=>{for(const name of ['Check in','Check out','Cancel reservation','Edit details'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);await expect(page.getByText(/Status: checked out/)).toBeVisible();});break;
      }
      case 'calendarView': {
        await evidence.step(`Select ${x.view} calendar`,()=>page.getByRole('button',{name:x.view,exact:true}).click());
        await evidence.step('Open saved occupancy details',async()=>{
          await page.getByRole('button').filter({hasText:/Bob Wilson/}).first().click();
          await expect(page.getByRole('dialog',{name:'Bob Wilson',exact:true})).toContainText('202');
        });break;
      }
      case 'editNote': {
        const before=await page.getByRole('region',{name:'Billing summary'}).textContent();await ui.edit();
        await ui.expand('Reservation note');await evidence.step('Change unrelated note only',()=>ui.pane.getByRole('textbox',{name:'Reservation note',exact:true}).fill('PW saved historical pricing note'));
        await ui.saveEdit();await evidence.step('Assert note saved without repricing historical fixture',async()=>{await expect(page.getByText('PW saved historical pricing note',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Billing summary'})).toHaveText(before);await expect(page.getByText(/Saved rate:.*7,000/)).toBeVisible();});break;
      }
      case 'editActual': {
        await page.getByRole('button',{name:'Check in',exact:true}).click();
        await expect(page.getByRole('status')).toContainText('checked in');await ui.edit();await ui.saveEdit();
        await evidence.step('Assert actual timestamp and lifecycle audit preserved',async()=>{await expect(page.getByText('Guest checked in',{exact:true})).toBeVisible();await expect(page.getByText(/Oct 14, 2026, 5:00 PM/).first()).toBeVisible();await expect(page.getByText(/Status: checked in/)).toBeVisible();});break;
      }
      case 'discard': {
        await ui.draft();await evidence.step('Request close and keep draft',async()=>{await ui.pane.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('alertdialog',{name:'Discard changes?'}).getByRole('button',{name:'Keep Editing',exact:true}).click();await expect(ui.pane.getByLabel('Check-in *',{exact:true})).toHaveValue('2026-11-10T14:00');});
        await evidence.step('Discard unsaved changes explicitly',async()=>{await ui.pane.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('alertdialog',{name:'Discard changes?'}).getByRole('button',{name:'Discard',exact:true}).click();await expect(ui.pane).toHaveCount(0);});break;
      }
      case 'manualDiscount': {
        await ui.draft();await ui.manual(x);await ui.save(x.total);break;
      }
      case 'invalidDiscount': {
        await ui.draft();await ui.manual(x);await evidence.step('Assert invalid manual discount rejected',async()=>{await expect(ui.pane.getByRole('alert')).toContainText('discount');await expect(ui.pane.getByRole('button',{name:'Remove Browser verified discount',exact:true})).toHaveCount(0);await ui.total(1100);});break;
      }
      case 'discountSequence': {
        await ui.draft({duration:'1-night'});await evidence.step('Select nightly final price preset',()=>ui.pane.getByRole('combobox',{name:'Room 101 discount',exact:true}).selectOption('standard-special'));
        await ui.manual({scope:'room',target:'101',value:100});await ui.manual({method:'percentage',value:10,label:'Final reservation percentage'});await ui.save(1665);break;
      }
      case 'duplicatePreset': {
        await ui.draft();await ui.expand('Discounts');
        await evidence.step('Apply reservation preset explicitly',async()=>{await ui.pane.getByRole('combobox',{name:'Reservation preset',exact:true}).selectOption('weekend-promo');await ui.pane.getByRole('button',{name:'Apply reservation preset',exact:true}).click();await ui.total(990);});
        await evidence.step('Reject duplicate application',async()=>{await ui.pane.getByRole('combobox',{name:'Reservation preset',exact:true}).selectOption('weekend-promo');await ui.pane.getByRole('button',{name:'Apply reservation preset',exact:true}).click();await expect(ui.pane.getByRole('alert')).toContainText('already applied');await ui.total(990);});await ui.save(990);break;
      }
      case 'invalidPreset': {
        await ui.draft();await ui.pane.getByRole('combobox',{name:'Room 101 discount',exact:true}).selectOption('standard-special');
        await evidence.step('Change rate to uncovered 8h duration',async()=>{await ui.pane.getByRole('combobox',{name:'Duration *',exact:true}).selectOption('8-hours');await expect(ui.pane.getByRole('alert')).toContainText('no longer matches');await expect(ui.pane.getByRole('button',{name:'Create Reservation',exact:true})).toBeDisabled();});
        await evidence.step('Remove incompatible preset and recover',async()=>{await ui.pane.getByRole('combobox',{name:'Room 101 discount',exact:true}).selectOption('');await expect(ui.pane.getByRole('button',{name:'Create Reservation',exact:true})).toBeEnabled();await ui.total(1300);});await ui.save(1300);break;
      }
      case 'presetNights': {
        await ui.draft({duration:'1-night'});await ui.pane.getByRole('combobox',{name:'Room 101 discount',exact:true}).selectOption('standard-special');
        await evidence.step('Increase selected nights while retaining nightly preset',async()=>{await ui.pane.getByRole('combobox',{name:'Duration *',exact:true}).selectOption('3-nights');await expect(ui.pane.getByRole('combobox',{name:'Room 101 discount',exact:true})).toHaveValue('standard-special');await ui.total(5850);});await ui.save(5850);break;
      }
      case 'roomScope': {
        await ui.draft();await ui.extra();await ui.manual({method:'percentage',scope:'room',target:'101',value:10});await ui.save(1098);break;
      }
      case 'itemDiscount': {
        await ui.draft();await ui.extra();await evidence.step('Multiply item unit override by quantity',async()=>{await ui.pane.getByLabel('Laundry quantity',{exact:true}).fill('2');await ui.pane.getByLabel(/Laundry.*discount/).selectOption('laundry-special');await ui.total(1280);});
        await ui.save(1280);await ui.edit();await ui.configure();
        await evidence.step('Remove targeted charge and its preset discount',async()=>{await ui.pane.getByRole('button',{name:'Remove',exact:true}).click();await expect(ui.pane.getByLabel('Laundry quantity',{exact:true})).toHaveCount(0);await ui.total(1100);});await ui.saveEdit();await ui.channelValue('Total guest charges',1100);break;
      }
      case 'adjustment':case 'invalidAdjustment': {
        await ui.draft();const details=await ui.expand('Billing adjustments');await evidence.step('Enter signed adjustment and reason',async()=>{await details.getByLabel('Amount',{exact:true}).fill(String(x.amount));await details.getByLabel('Reason *',{exact:true}).fill(x.reason??'PW documented correction');await details.getByRole('button',{name:'Apply adjustment',exact:true}).click();});
        if(s.kind==='adjustment')await ui.save(x.total);
        else await evidence.step('Assert invalid adjustment rejected',async()=>{await expect(ui.pane.getByRole('alert')).toContainText('non-zero adjustment');await ui.total(1100);});break;
      }
      case 'purchase': {
        await ui.draft();await ui.configure();await evidence.step('Add ordinary purchased Pancit Canton',()=>ui.pane.getByLabel('Add purchased item',{exact:true}).selectOption('pancit-canton'));
        await evidence.step(`Set purchased quantity ${x.qty}`,()=>ui.pane.getByLabel('Pancit Canton quantity',{exact:true}).fill(String(x.qty)));
        {
          const quantity=Math.max(1,Math.floor(x.qty));
          await expect(ui.pane.getByLabel('Pancit Canton quantity',{exact:true})).toHaveValue(String(quantity));await ui.save(1100+quantity*120);
          await evidence.step('Assert purchase emitted once using captured price',()=>expect(page.getByRole('region',{name:'Channel guest billing'})).toContainText(new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(quantity*120)));
        }break;
      }
      case 'breakfastHourly': {
        await ui.draft();await ui.configure();await evidence.step('Assert hourly stay has no breakfast entitlement',async()=>{await expect(ui.pane.getByText('No breakfast dates in this stay.',{exact:true})).toBeVisible();await expect(ui.pane.locator('select').filter({has:page.locator('option[value="included"]')})).toHaveCount(0);});break;
      }
      case 'breakfastNightly':case 'breakfastTrim': {
        await ui.draft({duration:'1-night'});await ui.configure();
        await evidence.step('Configure two adults and one child, three zero-price breakfasts',async()=>{
          await ui.pane.getByLabel('Children',{exact:true}).fill('1');
          const statuses=ui.pane.locator('select').filter({has:page.locator('option[value="included"]')});await expect(statuses).toHaveCount(3);
          for(let i=0;i<3;i++)await statuses.nth(i).selectOption('included');await ui.total(2200);
        });
        if(s.kind==='breakfastTrim')await evidence.step('Reduce guests and assert entitlement trims',async()=>{await ui.pane.getByLabel('Children',{exact:true}).fill('0');await expect(ui.pane.locator('select').filter({has:page.locator('option[value="included"]')})).toHaveCount(2);await ui.total(2200);});
        await ui.save(2200);await evidence.step('Assert saved breakfast labels and zero-priced billing',async()=>{await expect(page.getByText(/Filipino breakfast/).first()).toBeVisible();await ui.channelValue('Additional charges after discounts',0);});break;
      }
      case 'guestEmpty':case 'guestOptional': {
        await ui.draft({guest:false});await ui.pane.getByRole('button',{name:'+ Create new guest',exact:true}).click();
        await evidence.step('Create guest through supported fields',async()=>{await ui.pane.getByLabel('Full name *',{exact:true}).fill(s.kind==='guestEmpty'?'   ':'  PW Name Only  ');await ui.pane.getByRole('button',{name:'Use guest',exact:true}).click();
          if(s.kind==='guestEmpty'){await expect(ui.pane.getByRole('alert')).toContainText("Enter the guest's name");await expect(ui.pane.getByRole('button',{name:'Create Reservation',exact:true})).toBeDisabled();}
          else {await expect(ui.pane.getByText('PW Name Only',{exact:true})).toBeVisible();await expect(ui.pane.getByText('No phone provided',{exact:true})).toBeVisible();}
        });if(s.kind==='guestOptional')await ui.save(1100);break;
      }
      case 'history': {
        await evidence.step('Assert retained historical retired options and original rate',async()=>{await expect(page.getByText(/Agoda \(inactive historical item\)/)).toBeVisible();await expect(page.getByText(/American breakfast/).first()).toBeVisible();await expect(page.getByText(/Legacy minibar/).first()).toBeVisible();await expect(page.getByText(/Saved rate:.*7,000/)).toBeVisible();});break;
      }
      case 'print': {
        await evidence.step(`Open ${x.layout} print and assert guest-only saved billing`,async()=>{await page.getByRole('link',{name:x.layout==='document'?'Print document':'Print thermal',exact:true}).click();await expect(page.locator('[data-reservation-print-document]')).toBeVisible();await ui.channelValue('Guest balance (negative means credit)',120);for(const name of ['Record verification','Record settlement','Save document confirmation'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);});break;
      }
      case 'reload': {
        await ui.draft();const id=await ui.save(1100);await evidence.step('Reload and prove data was session-only',async()=>{await page.reload();await expect(page.getByRole('heading',{name:'Reservation not found',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:id,exact:true})).toHaveCount(0);});break;
      }
      case 'channelPending': {
        await ui.channelDraft();await ui.save(1100);await evidence.step('Assert agreement captured without payment or payout',async()=>{await expect(page.getByText('Version 1 (active at capture)',{exact:true})).toBeVisible();await ui.channelValue('Verified guest collection (all recorded collectors)',0);await ui.channelValue('Guest balance (negative means credit)',1100);await expect(page.getByText('No actual settlement recorded.',{exact:true})).toBeVisible();});break;
      }
      case 'channelReference':case 'channelReason': {
        if(s.kind==='channelReference')await ui.draft({source:'booking-com'});else{await ui.channelDraft();await ui.override('800','');}
        await evidence.step('Attempt save with missing OTA requirement',async()=>{await ui.pane.getByRole('button',{name:'Create Reservation',exact:true}).click();await expect(ui.pane.getByRole('alert')).toContainText(s.kind==='channelReference'?'reference':'reason');await expect(ui.pane).toBeVisible();});
        await evidence.step('Correct required booking evidence',()=>ui.pane.getByLabel(s.kind==='channelReference'?'External booking reference':'Override reason',{exact:true}).fill('PW corrected fictional document'));
        await ui.save(s.kind==='channelReference'?1100:800);break;
      }
      case 'channelOverride': {
        await ui.channelDraft();await ui.extra();await ui.pane.getByLabel(/Laundry.*discount/).selectOption('laundry-promo');await ui.manual({value:100});await ui.override();await ui.save(902);
        await evidence.step('Assert override applied once with isolated extras and commission',async()=>{await ui.channelValue('Confirmed accommodation',800);await ui.channelValue('Additional charges after discounts',102);await ui.channelValue('Total guest charges',902);await expect(page.getByText(/Estimated commission/)).toBeVisible();});break;
      }
      case 'invalidChannelAmount': {
        await ui.channelDraft();await ui.override();
        await evidence.step('Replace valid channel amount with invalid input',async()=>{await ui.pane.getByLabel(/^Confirmed accommodation/).fill(x.value);await ui.pane.getByRole('button',{name:'Create Reservation',exact:true}).click();await expect(ui.pane.getByRole('alert').first()).toBeVisible();await expect(ui.pane).toBeVisible();await expect(page.getByRole('status')).toHaveCount(0);});break;
      }
      case 'collection': {
        await ui.channelDraft();await ui.collection(x.amount);await ui.save(1100,x.balance);
        await evidence.step('Assert total charges, collection and signed balance separately',async()=>{await ui.channelValue('Total guest charges',1100);await ui.channelValue('Verified guest collection (all recorded collectors)',x.amount);await ui.channelValue('Guest balance (negative means credit)',x.balance);await expect(page.getByText('No actual settlement recorded.',{exact:true})).toBeVisible();});break;
      }
      case 'refund':case 'excessRefund': {
        const before=await page.getByRole('region',{name:'Channel guest billing'}).textContent();await ui.detailedCollection({amount:s.kind==='refund'?100:2400.01});
        await evidence.step('Assert refund result and preserve original evidence',async()=>{
          if(s.kind==='refund'){await ui.channelValue('Guest balance (negative means credit)',220);await ui.channelValue('Verified guest collection (all recorded collectors)',2300);await expect(page.getByText(/PW-FICTIONAL-REFUND/).first()).toBeVisible();}
          else {await expect(page.getByRole('status')).toContainText(/exceed/i);await expect(page.getByRole('region',{name:'Channel guest billing'})).toHaveText(before);}
        });break;
      }
      case 'sourceReview': {
        await ui.edit();await evidence.step('Request source change and preserve current choice',async()=>{await ui.pane.getByRole('combobox',{name:'Booking source *',exact:true}).selectOption('booking-com');await expect(page.getByRole('dialog',{name:'Review booking source change'})).toBeVisible();await page.getByRole('button',{name:'Keep current source',exact:true}).click();await expect(ui.pane.getByRole('combobox',{name:'Booking source *',exact:true})).toHaveValue('agoda');});
        await evidence.step('Confirm reviewed source switch',async()=>{await ui.pane.getByRole('combobox',{name:'Booking source *',exact:true}).selectOption('booking-com');await page.getByRole('button',{name:'Confirm reviewed source change',exact:true}).click();await ui.pane.getByLabel('External booking reference',{exact:true}).fill('PW-NEW-CHANNEL');});await ui.saveEdit();
        await evidence.step('Assert earlier verified money and attribution retained',async()=>{await ui.channelValue('Verified guest collection (all recorded collectors)',2400);await ui.channelValue('Total guest charges',3120);await ui.channelValue('Guest balance (negative means credit)',720);await ui.expand('Preserved terms from earlier booking sources',page);await expect(page.locator('p').filter({hasText:/Agoda \/ ILLUSTRATIVE-2/})).toBeVisible();await expect(page.getByText(/ILLUSTRATIVE-BATCH-001/).first()).toBeVisible();});break;
      }
      case 'commission': {
        const before=await page.getByRole('region',{name:'Channel guest billing'}).textContent();await ui.expand('Confirm from a channel document',page);
        await evidence.step('Confirm commission with fictional statement',async()=>{await page.getByRole('combobox',{name:'Confirmation',exact:true}).selectOption('confirmedCommission');await page.getByLabel('Amount (PHP)',{exact:true}).fill('310');await page.getByLabel('Statement / document reference',{exact:true}).fill('PW-COMMISSION-DOC');await page.getByRole('button',{name:'Save document confirmation',exact:true}).click();await expect(page.getByText(/PW-COMMISSION-DOC/).first()).toBeVisible();await expect(page.getByRole('region',{name:'Channel guest billing'})).toHaveText(before);});break;
      }
      case 'batch':case 'negativeAllocation': {
        const before=await page.getByRole('region',{name:'Channel guest billing'}).textContent();await ui.expand('Record settlement transaction (single or batch)',page);
        await evidence.step('Record explicit batch allocations',async()=>{await page.getByLabel('Payout / statement reference',{exact:true}).fill('PW-BATCH-DOC');await page.getByLabel('Settlement allocation CHANNEL-2',{exact:true}).fill(s.kind==='batch'?'100':'-1');if(s.kind==='batch')await page.getByLabel('Settlement allocation CHANNEL-12',{exact:true}).fill('200');await page.getByRole('button',{name:'Record settlement',exact:true}).click();});
        if(s.kind==='batch')await evidence.step('Assert exact batch sum and reconcile with explanation',async()=>{
          const transaction=page.locator('div').filter({has:page.getByText(/^Reference PW-BATCH-DOC/)}).filter({has:page.getByLabel('Reconciliation for PW-BATCH-DOC',{exact:true})}).last();
          await expect(transaction).toContainText('₱300.00');await expect(transaction).toContainText('Covers 2 reservation(s)');
          await page.getByLabel('Reconciliation for PW-BATCH-DOC',{exact:true}).selectOption('reconciled');await page.getByLabel('Reconciliation explanation for PW-BATCH-DOC',{exact:true}).fill('Fictional statement and receipt matched');await transaction.getByRole('button',{name:'Update reconciliation',exact:true}).click();await expect(transaction).toContainText('reconciled');
        });
        else await evidence.step('Assert negative allocation rejected',()=>expect(page.getByRole('status')).toContainText(/negative|non-negative|invalid/i));
        await expect(page.getByRole('region',{name:'Channel guest billing'})).toHaveText(before);break;
      }
      case 'reconcileEmpty': {
        await evidence.step('Attempt reconciliation without required explanation',async()=>{await page.getByLabel('Reconciliation for ILLUSTRATIVE-BATCH-001',{exact:true}).selectOption('reconciled');const form=page.getByLabel('Reconciliation for ILLUSTRATIVE-BATCH-001',{exact:true}).locator('..');await form.getByRole('button',{name:'Update reconciliation',exact:true}).click();expect(await page.getByLabel('Reconciliation explanation for ILLUSTRATIVE-BATCH-001',{exact:true}).evaluate(input=>input.validity.valueMissing)).toBe(true);await expect(page.locator('p').filter({hasText:/^payout.*partial/})).toBeVisible();});break;
      }
      default:throw new Error(`No browser implementation for ${s.id} / ${s.kind}`);
    }
    await ui.checkNoBrowserErrors();
    await evidence.finish();
  });
}
