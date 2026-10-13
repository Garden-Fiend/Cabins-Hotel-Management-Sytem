import { expect } from './ui.mjs';

async function category(ui,name){
  await ui.nav('Configuration');
  await ui.e.step(`Open booking configuration ${name}`,()=>ui.page.getByRole('navigation',{name:'Configuration categories'}).getByRole('button',{name,exact:true}).click());
}
async function editRow(ui,title){
  const row=ui.page.getByRole('row').filter({has:ui.page.getByRole('cell',{name:title,exact:true})});
  await ui.e.step(`Edit configuration ${title}`,()=>row.getByRole('button',{name:'Edit',exact:true}).click());
  return row;
}
async function saveConfig(ui){await ui.e.step('Save configuration through actual UI',()=>ui.page.getByRole('button',{name:'Save changes',exact:true}).click());}
async function returnToRecord(ui,id){await ui.nav('Reservations');await ui.e.step(`Return to saved reservation ${id}`,()=>ui.page.getByRole('link',{name:id,exact:true}).click());}

export async function runConfigurationCase(s,ui){
  const {page,e}=ui;
  switch(s.id){
    case 'REMEDY-CALENDAR-INTERACTION': {
      for(const [guest,start,room] of [['PW Tiny First','2026-11-10T14:07','101'],['PW Tiny Adjacent','2026-11-10T20:07','101'],['PW Very Long Guest Name That Must Never Enlarge The Scheduled Occupancy Interval Even When Its Entire Label Cannot Fit','2026-11-10T14:07','102']]) {
        await ui.nav('Dashboard');await ui.draft({start,room,guest:false});
        await e.step(`Create real UI guest ${guest} for adjacent stay`,async()=>{await ui.pane.getByRole('button',{name:'+ Create new guest',exact:true}).click();await ui.pane.getByLabel('Full name *',{exact:true}).fill(guest);await ui.pane.getByRole('button',{name:'Use guest',exact:true}).click();});await ui.save(1100);
      }
      await ui.nav('Dashboard');await page.getByRole('button',{name:'year',exact:true}).click();
      await e.step('Verify distinct short-stay markers and exact touching geometry',async()=>{
        const first=page.getByTestId('occupancy-interval').filter({hasText:'PW Tiny First'}),second=page.getByTestId('occupancy-interval').filter({hasText:'PW Tiny Adjacent'});
        const a=await first.boundingBox(),b=await second.boundingBox();expect(a.width).toBeLessThan(1);expect(Math.abs(a.x+a.width-b.x)).toBeLessThanOrEqual(1);
        await expect(page.getByRole('button',{name:/Short stay: PW Tiny First/})).toBeVisible();
      });
      await e.step('Pointer conflict requires explicit reservation choice',async()=>{
        const target=await page.getByRole('button',{name:/Short stay: PW Tiny First/}).boundingBox();
        await page.mouse.click(target.x+target.width/2,target.y+target.height/2);
        const chooser=page.getByRole('dialog',{name:'Choose reservation',exact:true});await expect(chooser).toBeVisible();
        await expect(chooser.getByRole('button',{name:/^PW Tiny First,/})).toBeVisible();
        await chooser.getByRole('button',{name:/^PW Tiny Adjacent,/}).click();await expect(page.getByRole('dialog',{name:'PW Tiny Adjacent',exact:true})).toBeVisible();await page.getByRole('button',{name:'Close reservation summary',exact:true}).click();
      });
      await e.step('Keyboard activation opens the exact first reservation',async()=>{const target=page.getByRole('button',{name:/Short stay: PW Tiny First/});await target.focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog',{name:'PW Tiny First',exact:true})).toBeVisible();await page.getByRole('button',{name:'Close reservation summary',exact:true}).click();});
      await e.step('Narrow viewport and long accessible identity preserve precise intervals',async()=>{await page.setViewportSize({width:1024,height:768});await page.getByRole('button',{name:'month',exact:true}).click();for(const guest of ['PW Tiny First','PW Very Long Guest']){const bar=page.getByTestId('occupancy-interval').filter({hasText:guest});expect((await bar.boundingBox()).width).toBeCloseTo(22,0);await expect(bar).toHaveAttribute('aria-label',/Nov 10, 2026.*2:07 PM.*8:07 PM/);}const scroll=page.getByTestId('occupancy-interval').first().locator('xpath=ancestor::div[contains(@class,"overflow-x-auto")][1]');await scroll.evaluate(element=>{element.scrollLeft=900;});const bar=page.getByTestId('occupancy-interval').filter({hasText:'PW Very Long Guest'});expect((await bar.boundingBox()).width).toBeCloseTo(22,0);});
      await e.step('Nearby empty calendar action remains usable',async()=>{await page.getByRole('button',{name:'day',exact:true}).click();const cell=page.getByRole('button',{name:'Select Room 101 at 12 AM',exact:true});await expect(cell).toBeEnabled();await cell.click();await expect(ui.pane).toBeVisible();});break;
    }
    case 'REMEDY-ROOM-CONTRACT': {
      await category(ui,'Rooms');await editRow(ui,'102');
      await e.step('Save populated optional capacity and custom room name',async()=>{
        await page.getByLabel('Capacity override',{exact:true}).fill('2');
        await page.getByLabel('Display name',{exact:true}).fill('PW Custom Room');
        await page.getByLabel('Description',{exact:true}).fill('PW description');
        await page.getByLabel('Operational notes',{exact:true}).fill('PW notes');
      });await saveConfig(ui);await editRow(ui,'102');
      await e.step('Clear description independently without losing capacity or custom name',async()=>{await page.getByLabel('Description',{exact:true}).fill('');});await saveConfig(ui);await editRow(ui,'102');
      await e.step('Verify description clear and clear operational notes independently',async()=>{await expect(page.getByLabel('Description',{exact:true})).toHaveValue('');await expect(page.getByLabel('Capacity override',{exact:true})).toHaveValue('2');await expect(page.getByLabel('Display name',{exact:true})).toHaveValue('PW Custom Room');await page.getByLabel('Operational notes',{exact:true}).fill('');});await saveConfig(ui);await editRow(ui,'102');
      await e.step('Reject zero negative and fractional capacity without completing edit',async()=>{
        for(const value of ['0','-1','1.5']) { await page.getByLabel('Capacity override',{exact:true}).fill(value);await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('button',{name:'Save changes',exact:true})).toHaveCount(1); }
        await page.getByLabel('Capacity override',{exact:true}).fill('1');
      });await saveConfig(ui);await editRow(ui,'102');
      await e.step('Clear all optional values intentionally',async()=>{for(const name of ['Capacity override','Display name','Description','Operational notes'])await page.getByLabel(name,{exact:true}).fill('');});await saveConfig(ui);await editRow(ui,'102');
      await e.step('Reopened form preserves blanks and changed type uses fallback',async()=>{
        for(const name of ['Capacity override','Display name','Description','Operational notes'])await expect(page.getByLabel(name,{exact:true})).toHaveValue('');
        await page.getByLabel('Room type',{exact:true}).selectOption('suite');
      });await saveConfig(ui);
      await e.step('Assert current room type supplies display fallback',()=>expect(page.getByRole('row').filter({has:page.getByRole('cell',{name:'102',exact:true})})).toContainText('Display name: Suite'));
      await ui.nav('Rooms');
      await e.step('Dedicated editor also stores blank override and preserves custom name',async()=>{
        const card=page.locator('article').filter({has:page.getByRole('heading',{name:'Room 102',exact:true})});
        await card.getByRole('heading',{name:'Room 102',exact:true}).click();
        await expect(page.getByLabel('Room name or display type',{exact:true})).toHaveValue('');
        await page.getByLabel('Room name or display type',{exact:true}).fill('PW Dedicated Name');
        await page.getByRole('button',{name:'Save room',exact:true}).click();
        await expect(page.getByText(/PW Dedicated Name/)).toBeVisible();
      });
      await ui.nav('Dashboard');await ui.draft();await ui.save(1100);
      await e.step('Check in valid room before testing configuration safety',async()=>{await page.getByRole('button',{name:'Check in',exact:true}).click();await expect(page.getByRole('status')).toContainText(/checked in/i);});
      await category(ui,'Rooms');await editRow(ui,'101');
      await e.step('Generic editor cannot bypass occupied-room readiness guard',async()=>{
        await page.getByLabel('Housekeeping readiness',{exact:true}).selectOption('dirty');await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('status')).toContainText('occupied');await expect(page.getByRole('button',{name:'Save changes',exact:true})).toHaveCount(1);
      });
      await e.step('Save optional notes while preserving occupied readiness and lock',async()=>{await page.getByLabel('Housekeeping readiness',{exact:true}).selectOption('clean');await page.getByLabel('Operational notes',{exact:true}).fill('PW occupied notes');await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('button',{name:'Save changes',exact:true})).toHaveCount(0);});
      await ui.nav('Dashboard');await ui.draft({start:'2027-01-01T14:00',addRoom:false});
      await e.step('Occupied room remains unavailable after descriptive configuration edit',()=>expect(ui.pane.getByLabel('Choose available room').locator('option[value="101"]')).toBeDisabled());break;
    }
    case 'REMEDY-ROOM-METADATA': {
      await ui.nav('Rooms');
      await e.step('Archive unassigned room through supported Rooms action',async()=>{
        const card=page.locator('article').filter({has:page.getByRole('heading',{name:'Room 103',exact:true})});
        await card.getByRole('button',{name:'Archive',exact:true}).click();await expect(card.getByRole('button',{name:'Restore',exact:true})).toBeVisible();
      });
      await category(ui,'Rooms');await editRow(ui,'103');await page.getByLabel('Operational notes',{exact:true}).fill('PW archive metadata');await saveConfig(ui);await ui.nav('Rooms');
      await e.step('Archived state survives ordinary generic room edit',async()=>{const card=page.locator('article').filter({has:page.getByRole('heading',{name:'Room 103',exact:true})});await expect(card.getByRole('button',{name:'Restore',exact:true})).toBeVisible();});break;
    }
    case 'CONFIG-OPTIONAL-CAPACITY': {
      await category(ui,'Rooms');await editRow(ui,'102');
      await e.step('Leave optional capacity override blank and change readiness',async()=>{await expect(page.getByLabel('Capacity override',{exact:true})).toHaveValue('');await page.getByLabel('Description',{exact:true}).fill('PW room fixture');await page.getByLabel('Operational notes',{exact:true}).fill('PW readiness fixture');await page.getByRole('combobox',{name:'Housekeeping readiness',exact:true}).selectOption('dirty');});
      await saveConfig(ui);
      await e.step('Assert optional blank value does not block saving unrelated room readiness',async()=>{
        const capacity=page.getByLabel('Capacity override',{exact:true});
        e.capacityValidation={required:await capacity.getAttribute('required'),value:await capacity.inputValue(),valueMissing:await capacity.evaluate(input=>input.validity.valueMissing)};
        await expect(page.getByRole('button',{name:'Save changes',exact:true}),'Room edit should finish when only optional capacity is blank').toHaveCount(0);
        await expect(page.getByRole('row').filter({has:page.getByRole('cell',{name:'102',exact:true})})).toContainText('Housekeeping readiness: Dirty');
      });break;
    }
    case 'STAY-CUSTOM': {
      await ui.draft();await ui.addRoom('102');const article=await ui.configure('102');
      await e.step('Configure independent 8h stay for second room',async()=>{await article.getByRole('radio',{name:'Custom stay',exact:true}).check();await article.getByRole('textbox',{name:'Check-in',exact:true}).fill('2026-11-10T15:30');await article.getByRole('combobox',{name:'Duration',exact:true}).selectOption('8-hours');await expect(article).toContainText('Nov 10, 2026, 11:30 PM');await ui.total(2400);});await ui.save(2400);
      await e.step('Assert independent room duration and captured package amount saved',async()=>{const stay=page.locator('section').filter({has:page.getByRole('heading',{name:'Stay Details',exact:true})});await expect(stay).toContainText('Duration: 8 hours');await expect(stay).toContainText('11:30 PM');await ui.channelValue('Total guest charges',2400);});break;
    }
    case 'CHECKIN-DIRTY': {
      await category(ui,'Rooms');await editRow(ui,'102');await page.getByRole('combobox',{name:'Housekeeping readiness',exact:true}).selectOption('dirty');await page.getByLabel('Capacity override',{exact:true}).fill('2');await page.getByLabel('Description',{exact:true}).fill('PW room fixture');await page.getByLabel('Operational notes',{exact:true}).fill('PW readiness fixture');await saveConfig(ui);
      await e.step('Assert Dirty readiness persisted before lifecycle action',async()=>{await expect(page.getByRole('button',{name:'Save changes',exact:true})).toHaveCount(0);await expect(page.getByRole('row').filter({has:page.getByRole('cell',{name:'102',exact:true})})).toContainText('Housekeeping readiness: Dirty');});
      await ui.nav('Dashboard');await ui.draft();await ui.addRoom('102');await ui.save(2200);
      await e.step('Reject all-room check-in if one assigned room is Dirty',async()=>{await page.getByRole('button',{name:'Check in',exact:true}).click();await expect(page.getByRole('status')).toContainText('must be Clean');await expect(page.getByText(/Status: confirmed/)).toBeVisible();await expect(page.getByText('Guest checked in',{exact:true})).toHaveCount(0);});break;
    }
    case 'CAL-EXTEND': {
      await ui.nav('Dashboard');await page.getByRole('button',{name:'month',exact:true}).click();await expect(page.getByRole('button').filter({hasText:/Bob Wilson\s*overdue/})).toHaveCount(1);
      await ui.nav('Reservations');await page.getByRole('link',{name:'DEMO-6',exact:true}).click();await ui.edit();
      await e.step('Extend current checked-in stay to 3 nights',()=>ui.pane.getByRole('combobox',{name:'Duration *',exact:true}).selectOption('3-nights'));await ui.saveEdit();
      await ui.nav('Dashboard');await page.getByRole('button',{name:'month',exact:true}).click();await e.step('Assert extension updates overdue status using the new scheduled checkout',()=>expect(page.getByRole('button').filter({hasText:/Bob Wilson\s*occupied/})).toHaveCount(1));break;
    }
    case 'GAP-CALENDAR-GEOMETRY': {
      await ui.draft({start:'2026-11-10T14:07',guest:false});
      await e.step('Use a unique deterministic guest to distinguish the year-view bar from seed stays',async()=>{await ui.pane.getByRole('button',{name:'+ Create new guest',exact:true}).click();await ui.pane.getByLabel('Full name *',{exact:true}).fill('PW Geometry Guest');await ui.pane.getByRole('button',{name:'Use guest',exact:true}).click();});
      await ui.save(1100);await ui.nav('Dashboard');
      const minute=14*60+7;
      const expected={day:{left:minute/1440,width:360/1440},week:{left:(1440+minute)/10080,width:360/10080},month:{left:(9*1440+minute)/43200,width:360/43200},year:{left:(10+(9*1440+minute)/43200)/12,width:360/(43200*12)}};
      const mismatches=[];
      for(const view of ['day','week','month','year'])await e.step(`Measure minute-accurate ${view} occupancy bar geometry`,async()=>{
        await page.getByRole('button',{name:view,exact:true}).click();
        const bar=page.getByTestId('occupancy-interval').filter({hasText:/PW Geometry Guest\s*confirmed/});await expect(bar).toHaveCount(1);
        const measured=await bar.evaluate(element=>{const box=element.getBoundingClientRect(),parent=element.closest('[data-testid="occupancy-interval"]').parentElement.parentElement.getBoundingClientRect();return{leftPercent:parseFloat(element.style.left),widthPercent:parseFloat(element.style.width),actualWidth:box.width,parentWidth:parent.width,actualLeft:box.left-parent.left,actualRight:box.right-parent.left};});
        // Chromium serializes inline percentages to a few decimals; this tolerance is subpixel.
        expect(measured.leftPercent).toBeCloseTo(expected[view].left*100,3);expect(measured.widthPercent).toBeCloseTo(expected[view].width*100,3);
        const intendedWidth=measured.parentWidth*expected[view].width;
        if(Math.abs(measured.actualWidth-intendedWidth)>1 || Math.abs(measured.actualLeft-measured.parentWidth*expected[view].left)>1 || Math.abs(measured.actualRight-measured.parentWidth*(expected[view].left+expected[view].width))>1)mismatches.push({view,...measured,intendedWidth});
        e.geometry=[...(e.geometry??[]),{view,...measured,intendedWidth}];
      });
      await e.step('Assert rendered widths match precise scheduled intervals',()=>expect(mismatches,'Padding/minimum box sizing must not visually extend hourly occupancy beyond its interval').toEqual([]));break;
    }
    case 'GAP-COMMISSION-METHODS': {
      const variants=[
        {method:'fixed',basis:'confirmed_accommodation',fixed:'12.34',estimate:'₱12.34',settlement:'deducted'},
        {method:'none',basis:'confirmed_accommodation',estimate:'₱0.00',settlement:'separate_invoice'},
        {method:'manual',basis:'confirmed_accommodation',estimate:'Pending',settlement:'manual'},
        {method:'percentage',basis:'reference_value',value:'600',estimate:'₱90.00',settlement:'offset'},
        {method:'percentage',basis:'explicit_amount',value:'333.33',estimate:'₱50.00',settlement:'deducted'},
      ];
      for(const [index,variant] of variants.entries()){
        const label=`PW fictional commission ${index+1}`;
        await category(ui,'Booking Sources');
        await e.step(`Create fictional channel for ${variant.method}/${variant.basis}`,async()=>{
          await page.getByRole('button',{name:'Add channel',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill(label);await page.getByRole('button',{name:'Save channel',exact:true}).click();
          await page.locator('li').filter({hasText:label}).getByRole('button',{name:'New agreement version',exact:true}).click();
          await page.getByRole('combobox',{name:'Method',exact:true}).selectOption(variant.method);await page.getByRole('combobox',{name:'Basis',exact:true}).selectOption(variant.basis);await page.getByLabel('Fixed amount',{exact:true}).fill(variant.fixed??'0');await page.getByLabel('Rate (%)',{exact:true}).fill('15');
          await page.getByRole('combobox',{name:'Settlement default',exact:true}).selectOption(variant.settlement);await page.getByRole('combobox',{name:'Collection default',exact:true}).selectOption('channel');await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('active');await page.getByRole('button',{name:'Save agreement',exact:true}).click();await expect(page.getByRole('status')).toContainText('saved');
        });
        await ui.nav('Dashboard');await ui.draft({source:'',start:`2026-11-${10+index}T14:00`});
        await e.step('Select newly configured source by its visible label',()=>ui.pane.getByRole('combobox',{name:'Booking source *',exact:true}).selectOption({label}));
        if(variant.value){await ui.expand('Accounting calculation inputs');await e.step('Supply explicit financial calculation basis',()=>ui.pane.getByLabel(variant.basis==='reference_value'?'Contract / reference selling value':'Explicit commissionable amount',{exact:true}).fill(variant.value));}
        await ui.collection(1100);await ui.save(1100,0);
        await e.step(`Assert ${variant.method}/${variant.basis} commission independent of guest charges`,async()=>{
          await expect(page.getByText('Estimated commission',{exact:true}).locator('..').locator('dd')).toHaveText(variant.estimate);await ui.channelValue('Total guest charges',1100);
          const expected=page.getByText('Expected settlement',{exact:true}).locator('..').locator('dd');
          if(variant.settlement==='deducted')await expect(expected).toContainText(index===0?'1,087.66':'1,050.00');
          else if(variant.settlement==='separate_invoice')await expect(expected).toContainText('1,100.00');
          else await expect(expected).toHaveText('Pending');
        });
      }break;
    }
    case 'GAP-BREAKFAST-STAY': {
      await ui.draft({duration:'3-nights'});await ui.configure();
      await e.step('Select complimentary breakfast on third service date',async()=>{
        const statuses=ui.pane.locator('select').filter({has:page.locator('option[value="included"]')});await expect(statuses).toHaveCount(6);await statuses.nth(4).selectOption('included');
      });await ui.save(6600);await ui.edit();
      await e.step('Shorten stay to one night',()=>ui.pane.getByRole('combobox',{name:'Duration *',exact:true}).selectOption('1-night'));await ui.configure();
      await e.step('Assert selections outside new entitlement removed',async()=>{
        const statuses=ui.pane.locator('select').filter({has:page.locator('option[value="included"]')});await expect(statuses).toHaveCount(2);for(let i=0;i<2;i++)await expect(statuses.nth(i)).toHaveValue('unrecorded');await ui.total(2200);
      });await ui.saveEdit();await ui.channelValue('Total guest charges',2200);break;
    }
    case 'GAP-PRESET-CURRENCY': {
      await ui.draft();await ui.pane.getByRole('combobox',{name:'Room 101 discount',exact:true}).selectOption('standard-special');const id=await ui.save(950);
      await ui.nav('Discounts');const row=page.getByRole('row').filter({has:page.getByRole('cell',{name:'Standard Special Rate',exact:true})});
      await e.step('Edit preset value and disable its new selection',async()=>{await row.getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('6 hours discounted price',{exact:true}).fill('900');await page.getByRole('button',{name:'Save Discount',exact:true}).click();await row.getByRole('button',{name:'Disable',exact:true}).click();});
      await returnToRecord(ui,id);await ui.edit();await e.step('Assert saved disabled preset uses captured 950 value',async()=>{await ui.total(950);await expect(ui.pane.getByRole('combobox',{name:'Room 101 discount',exact:true}).locator('option[value="standard-special"]')).toHaveJSProperty('disabled',true);});await ui.saveEdit();
      await ui.nav('Dashboard');await ui.draft({start:'2026-11-11T14:00'});
      await e.step('Assert disabled preset excluded from new selections',()=>expect(ui.pane.getByRole('combobox',{name:'Room 101 discount',exact:true}).locator('option[value="standard-special"]')).toHaveCount(0));
      await ui.pane.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Discard',exact:true}).click();
      await ui.nav('Discounts');await row.getByRole('button',{name:'Enable',exact:true}).click();await category(ui,'Room Prices');await editRow(ui,'standard-6-hours');await page.getByLabel('Price',{exact:true}).fill('800');await saveConfig(ui);
      await ui.nav('Dashboard');await ui.draft({start:'2026-11-11T14:00'});
      await e.step('Assert preset above current base excluded',async()=>{await expect(ui.pane.getByRole('combobox',{name:'Room 101 discount',exact:true}).locator('option[value="standard-special"]')).toHaveCount(0);await ui.total(800);});break;
    }
    case 'GAP-DUPLICATE-SUBMIT': {
      await ui.draft();
      let id;
      await e.step('Rapid double-click Create produces exactly one booking',async()=>{
        await ui.pane.getByRole('button',{name:'Create Reservation',exact:true}).dblclick();await expect(ui.pane).toHaveCount(0);
        id=(await page.getByRole('status').innerText()).match(/Reservation (\S+) created/)[1];
      });
      await ui.nav('Reservations');await e.step('Assert single reservation row, then inspect saved record',async()=>{await expect(page.getByRole('link',{name:id,exact:true})).toHaveCount(1);await page.getByRole('link',{name:id,exact:true}).click();});await ui.edit();
      const details=await ui.expand('Billing adjustments');
      for(const [reason,amount] of [['PW adjustment A',100],['PW adjustment B',200]])await e.step(`Apply independent ${reason}: ${amount}`,async()=>{await details.getByLabel('Amount',{exact:true}).fill(String(amount));await details.getByLabel('Reason *',{exact:true}).fill(reason);await details.getByRole('button',{name:'Apply adjustment',exact:true}).click();});
      await e.step('Assert both documented adjustments affect billing',()=>ui.total(1400));
      await e.step('Remove only adjustment A; adjustment B must remain',async()=>{await details.locator('li').filter({hasText:'PW adjustment A'}).getByRole('button',{name:'Remove',exact:true}).click();await expect(details.locator('li').filter({hasText:'PW adjustment B'})).toHaveCount(1);await ui.total(1300);});
      await ui.saveEdit();await ui.channelValue('Total guest charges',1300);
      await e.step('Verify saved adjustment and independently readable audit',async()=>{
        await expect(page.getByRole('heading',{name:'Audit history',exact:true})).toBeVisible();
        await expect(page.getByText(/PW adjustment B/).first()).toBeVisible();
        expect(e.console.filter(item=>/same key/.test(item.text))).toEqual([]);
      });
      await e.step('Verify document print retains adjustment B and bill total',async()=>{
        await page.getByRole('link',{name:'Print document',exact:true}).click();
        await expect(page.getByText(/PW adjustment B/).first()).toBeVisible();
        await expect(page.locator('main').last()).toContainText('1,300.00');
      });break;
    }
    case 'GAP-MONEY-ROUND': {
      await category(ui,'Room Prices');await editRow(ui,'standard-nightly');await e.step('Set half-cent nightly base rate 1.005',()=>page.getByLabel('Price',{exact:true}).fill('1.005'));await saveConfig(ui);
      await ui.nav('Dashboard');await ui.draft({duration:'3-nights'});
      await e.step('Assert unit rounded before multiplication: 1.01 × 3 = 3.03',()=>ui.total(3.03));
      await ui.manual({method:'percentage',value:50});await ui.save(1.51);
      await e.step('Assert rounded percentage reduction 1.52 against original 3.03',async()=>{await ui.channelValue('Original accommodation',3.03);await ui.channelValue('Accommodation after hotel discounts',1.51);});break;
    }
    case 'GAP-ALLOC-ZERO': {
      for(const [index,base] of [0,1].entries()){
        await category(ui,'Room Prices');await editRow(ui,'standard-6-hours');await page.getByLabel('Price',{exact:true}).fill(String(base));await saveConfig(ui);
        await ui.nav('Dashboard');await ui.draft({source:'booking-com',start:`2026-11-${10+index}T14:00`});await ui.addRoom('102');await ui.pane.getByLabel('External booking reference',{exact:true}).fill(`PW-CENT-TIE-${index}`);await ui.override('0.01');await ui.save(0.01);
        await ui.expand('Internal accommodation allocation',page.getByRole('region',{name:'Channel guest billing'}));
        await e.step(`Assert exact cent allocation with ${base===0?'zero-price equal':'proportional tie'} basis`,async()=>{
          const section=page.getByRole('region',{name:'Channel guest billing'});
          await expect(section.getByText(/Room 101:.*0\.01/)).toBeVisible();await expect(section.getByText(/Room 102:.*0\.00/)).toBeVisible();
          await expect(section).toContainText(base===0?'Equal allocation: zero original prices':'Proportional to original prices');
        });
      }break;
    }
    case 'GAP-RATE-ZERO': {
      await category(ui,'Room Prices');await editRow(ui,'standard-6-hours');
      await e.step('Configure zero accommodation package rate',()=>page.getByLabel('Price',{exact:true}).fill('0'));await saveConfig(ui);
      await ui.nav('Dashboard');await ui.draft();await ui.save(0);
      await category(ui,'Room Prices');
      await e.step('Disable the exact hourly rate',()=>page.getByRole('row').filter({has:page.getByRole('cell',{name:'standard-6-hours',exact:true})}).getByRole('button',{name:'Disable',exact:true}).click());
      await ui.nav('Dashboard');await ui.draft({start:'2026-11-11T14:00',addRoom:false});
      await e.step('Assert newly assigned room requires enabled price',async()=>{await expect(ui.pane.getByLabel('Choose available room').locator('option[value="101"]')).toBeDisabled();await expect(ui.pane.getByLabel('Choose available room').locator('option[value="101"]')).toContainText('No price configured');});break;
    }
    case 'GAP-SNAPSHOT-CONFIG': {
      await ui.draft();const id=await ui.save(1100);
      await category(ui,'Room Prices');await editRow(ui,'standard-6-hours');await page.getByLabel('Price',{exact:true}).fill('9999');await saveConfig(ui);
      await returnToRecord(ui,id);await ui.channelValue('Total guest charges',1100);await ui.edit();await ui.expand('Reservation note');await ui.pane.getByRole('textbox',{name:'Reservation note',exact:true}).fill('PW keep captured rate');await ui.saveEdit();
      await e.step('Assert unrelated save retains captured original price',()=>ui.channelValue('Total guest charges',1100));
      await category(ui,'Room Prices');await editRow(ui,'standard-nightly');await page.getByLabel('Price',{exact:true}).fill('3333');await saveConfig(ui);await returnToRecord(ui,id);await ui.edit();
      await e.step('Explicit duration change captures current nightly unit price',async()=>{await ui.pane.getByRole('combobox',{name:'Duration *',exact:true}).selectOption('2-nights');await ui.total(6666);});await ui.saveEdit();await ui.channelValue('Total guest charges',6666);break;
    }
    case 'GAP-INCL-CONFIG': {
      await ui.draft();const id=await ui.save(1100);
      await category(ui,'Room Types');await editRow(ui,'Standard');
      await e.step('Reject zero default inclusion using native form constraint',async()=>{const input=page.getByLabel('Default Bottled water quantity',{exact:true});await input.fill('0');await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(input).toHaveValue('0');expect(await input.evaluate(input=>input.validity.rangeUnderflow)).toBe(true);});
      await e.step('Prevent duplicate default inclusion selection',()=>expect(page.getByLabel('Add default inclusion').locator('option[value="bottled-water"]')).toHaveCount(0));
      await page.getByLabel('Default Bottled water quantity',{exact:true}).fill('9');await saveConfig(ui);
      await returnToRecord(ui,id);await ui.edit();await ui.configure();
      await e.step('Assert saved inclusion frozen despite new type defaults',()=>expect(ui.pane.getByLabel('Bottled water quantity',{exact:true})).toHaveValue('1'));await ui.saveEdit();
      await ui.nav('Dashboard');await ui.draft({start:'2026-11-11T14:00'});await ui.configure();await e.step('Assert new assignment inherits current configured quantity',()=>expect(ui.pane.getByLabel('Bottled water quantity',{exact:true})).toHaveValue('9'));await ui.save(1100);break;
    }
    case 'GAP-INVENTORY-RETIRED': {
      await ui.draft();await ui.configure();await ui.pane.getByLabel('Add purchased item').selectOption('pancit-canton');const id=await ui.save(1220);
      await category(ui,'Inclusions & Extras');await editRow(ui,'Pancit Canton');
      await e.step('Disable new sales and change current inventory price',async()=>{await page.getByLabel('Available for sale',{exact:true}).uncheck();await page.getByLabel('Unit price',{exact:true}).fill('999');});await saveConfig(ui);
      await returnToRecord(ui,id);await ui.edit();await ui.configure();
      await e.step('Assert historical purchase retains captured unit and quantity',async()=>{await expect(ui.pane.getByLabel('Pancit Canton quantity',{exact:true})).toHaveValue('1');await ui.total(1220);});await ui.saveEdit();
      await ui.nav('Dashboard');await ui.draft({start:'2026-11-11T14:00'});await ui.configure();
      await e.step('Assert sale-disabled ordinary product cannot be newly purchased',()=>expect(ui.pane.getByLabel('Add purchased item').locator('option[value="pancit-canton"]')).toHaveCount(0));break;
    }
    case 'GAP-AGREEMENT': {
      await category(ui,'Booking Sources');
      const source=page.locator('li').filter({hasText:'Booking.com'});
      await e.step('Inspect published Booking.com agreement',async()=>{await source.getByRole('button',{name:'Details / history',exact:true}).click();await page.getByRole('button',{name:'Edit dates / status',exact:true}).click();await expect(page.getByRole('combobox',{name:'Method',exact:true})).toBeDisabled();await expect(page.getByLabel('Currency',{exact:true})).toBeDisabled();});
      await e.step('Reject published agreement demotion to draft',async()=>{await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('draft');await page.getByRole('button',{name:'Save agreement',exact:true}).click();await expect(page.getByRole('status')).toContainText(/immutable/i);});
      await e.step('End original active agreement on the current hotel entry date',async()=>{await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('active');await page.getByLabel('Effective through (inclusive)',{exact:true}).fill('2026-11-10');await page.getByRole('button',{name:'Save agreement',exact:true}).click();await expect(page.getByRole('status')).toContainText('saved');});
      await e.step('Reject overlapping inclusive active ranges',async()=>{await source.getByRole('button',{name:'New agreement version',exact:true}).click();await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('active');await page.getByRole('button',{name:'Save agreement',exact:true}).click();await expect(page.getByRole('status')).toContainText(/overlap/i);});
      await e.step('Save adjacent next-day agreement version',async()=>{await page.getByLabel('Effective from',{exact:true}).fill('2026-11-11');await page.getByRole('button',{name:'Save agreement',exact:true}).click();await expect(page.getByRole('status')).toContainText('saved');});
      await ui.nav('Dashboard');await ui.draft({source:'booking-com',start:'2026-11-12T14:00'});await ui.pane.getByLabel('External booking reference',{exact:true}).fill('PW-AGREEMENT-ENDPOINT');const first=await ui.save(1100);
      await e.step('Capture v1 at inclusive booking-entry endpoint regardless of stay date',()=>expect(page.getByText('Version 1 (active at capture)',{exact:true})).toBeVisible());
      await page.clock.setFixedTime(new Date('2026-11-11T15:00:00+08:00'));await ui.nav('Dashboard');await ui.draft({source:'booking-com',start:'2026-11-13T14:00'});await ui.pane.getByLabel('External booking reference',{exact:true}).fill('PW-AGREEMENT-STARTPOINT');await ui.save(1100);
      await e.step('Capture v2 at inclusive booking-entry start date',()=>expect(page.getByText('Version 2 (active at capture)',{exact:true})).toBeVisible());await returnToRecord(ui,first);
      await e.step('Preserve original deep agreement snapshot',()=>expect(page.getByText('Version 1 (active at capture)',{exact:true})).toBeVisible());break;
    }
    default:throw new Error(`Unhandled configuration case ${s.id}`);
  }
}
