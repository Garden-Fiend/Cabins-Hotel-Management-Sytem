import { test as base, expect } from '@playwright/test';
export { expect };
import { writeFileSync } from 'node:fs';
const money=value=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(value);
export const test=base.extend({
  evidence:[async ({page},use,testInfo)=>{
    const record={started:false,steps:[],errors:[],console:[],pageErrors:[],failedRequests:[],badResponses:[]};
    page.on('console',message=>{if(['warning','error'].includes(message.type()))record.console.push({type:message.type(),text:message.text()});});
    page.on('pageerror',error=>record.pageErrors.push(error.message));
    page.on('requestfailed',request=>record.failedRequests.push({url:request.url(),method:request.method(),error:request.failure()?.errorText}));
    page.on('response',response=>{if(response.status()>=400)record.badResponses.push({url:response.url(),status:response.status()});});
    const capture=async title=>{
      const path=testInfo.outputPath(`${String(record.steps.length+1).padStart(2,'0')}-${title.replace(/[^a-z0-9]+/gi,'-').slice(0,70)}.png`);
      await page.screenshot({path,fullPage:true,animations:'disabled',timeout:15000});
      await testInfo.attach(title,{path,contentType:'image/png'});
      return path;
    };
    record.step=async(title,action)=>base.step(title,async()=>{
      const item={title};
      try {await action();}catch(e){item.error=e.message;throw e;}
      finally {try{item.screenshot=await capture(title);}catch(e){record.errors.push(`Screenshot ${title}: ${e.message}`);}record.steps.push(item);}
    });
    record.finish=async()=>{
      record.finalScreenshot=await capture('Final observed browser state');
      record.actual=`All scenario assertions passed. Observed URL: ${page.url()}. UI excerpt: ${(await page.locator('main').count()?await page.locator('main').first().innerText():await page.locator('body').innerText()).slice(-2500)}`;
    };
    await use(record);
    if(record.started){
      try {if(!record.finalScreenshot)record.finalScreenshot=await capture('Final observed browser state');}catch(e){record.errors.push(`Final screenshot: ${e.message}`);}
      try {
        if(testInfo.status==='passed'&&!record.actual) record.actual=`All scenario assertions passed. Observed URL: ${page.url()}. UI excerpt: ${(await page.locator('main').count()?await page.locator('main').first().innerText():await page.locator('body').innerText()).slice(-2500)}`;
        else if(testInfo.status!=='passed') record.actual=`Execution ${testInfo.status}. See the failed numbered step, assertion details and final screenshot. Observed URL: ${page.url()}.`;
      } catch(error){record.errors.push(`Reading final UI state: ${error.message}`);record.actual='Browser closed before final evidence could be read; inspect captured steps and trace.';}
    }
    const {step,finish,...serializable}=record;
    void step;
    void finish;
    const evidencePath=testInfo.outputPath('scenario-evidence.json');
    writeFileSync(evidencePath,JSON.stringify(serializable,null,2));
    await testInfo.attach('scenario-evidence',{path:evidencePath,contentType:'application/json'});
    if(record.started && testInfo.status==='passed') expect(record.errors,'Screenshot/evidence capture must complete').toEqual([]);
  },{auto:true}],
});

export class BookingUI {
  constructor(page,evidence){this.page=page;this.e=evidence;}
  get pane(){return this.page.getByRole('dialog',{name:/^(Create|Edit) reservation$/});}
  async boot(path='/',now='2026-11-10T15:00:00+08:00'){
    this.e.environment={browser:this.page.context().browser()?.version(),viewport:this.page.viewportSize(),timezone:'Asia/Manila',locale:'en-PH',clock:now};
    await this.page.clock.setFixedTime(new Date(now));
    await this.e.step(`Open ${path} with hotel clock ${now}`,async()=>{
      await this.page.goto(path);
      await expect(this.page.getByRole('navigation',{name:'Main navigation'})).toBeVisible();
      this.e.started=true;
    });
  }
  async nav(name){await this.e.step(`Navigate to ${name} without reloading session`,async()=>{
    await this.page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name,exact:true}).click();
    await expect(this.page.getByRole('heading',{name,exact:true}).first()).toBeVisible();
  });}
  async draft({room='101',duration='6-hours',start='2026-11-10T14:00',source='direct',guest=true,addRoom=true}={}){
    await this.e.step('Open Create Reservation',async()=>{await this.page.getByRole('button',{name:'+ Create Reservation',exact:true}).click();await expect(this.pane).toBeVisible();});
    if(guest)await this.e.step('Select primary guest John Doe',()=>this.pane.getByRole('button',{name:/^John Doe/}).click());
    await this.e.step(`Set ${duration} arriving ${start} Asia/Manila`,async()=>{
      await this.pane.getByRole('combobox',{name:'Duration *',exact:true}).selectOption(duration);
      await this.pane.getByLabel('Check-in *',{exact:true}).fill(start);
    });
    if(addRoom)await this.addRoom(room);
    if(source)await this.e.step(`Choose booking source ${source}`,()=>this.pane.getByRole('combobox',{name:'Booking source *',exact:true}).selectOption(source));
  }
  async addRoom(room){await this.e.step(`Assign available Room ${room}`,async()=>{
    await this.pane.getByLabel('Choose available room').selectOption(room);
    await this.pane.getByRole('button',{name:'+ Add room',exact:true}).click();
    await expect(this.pane.getByRole('button',{name:`Remove room ${room}`,exact:true})).toBeVisible();
  });}
  async configure(room='101'){
    const article=this.pane.locator('article').filter({has:this.page.getByRole('button',{name:`Remove room ${room}`,exact:true})});
    await this.e.step(`Inspect settings for Room ${room}`,async()=>{
      const toggle=article.getByRole('button',{name:'Configure',exact:true});
      if(await toggle.count())await toggle.click();
      await expect(article.getByRole('button',{name:'Hide settings',exact:true})).toHaveAttribute('aria-expanded','true');
    });
    return article;
  }
  async expand(summary,root=this.pane){
    const toggle=root.locator('summary').filter({hasText:summary}).first();
    const detail=toggle.locator('..');
    if(await detail.getAttribute('open')===null) await this.e.step(`Expand ${summary}`,async()=>{
      // The summary contains an InfoTip button. Click its disclosure marker, not its center.
      await toggle.click({position:{x:8,y:10}});
      await expect(detail).toHaveJSProperty('open',true);
    });
    return detail;
  }
  async total(amount,root=this.pane){await expect(root.locator('footer').locator('span.font-bold')).toHaveText(money(amount));}
  async channelValue(label,amount,root=this.page){
    const section=root.getByRole('region',{name:'Channel guest billing',exact:true});
    const row=section.getByText(label,{exact:true}).locator('..');
    await expect(row.locator('dd')).toHaveText(money(amount));
  }
  async save(total,balance=total){
    let id;
    await this.e.step('Assert charges and save reservation',async()=>{
      if(balance!==undefined) await this.total(balance);
      await this.pane.getByRole('button',{name:'Create Reservation',exact:true}).click();
      await expect(this.pane).toHaveCount(0);
      const notice=this.page.getByRole('status');
      await expect(notice).toContainText(/Reservation .* created in this session/);
      id=(await notice.innerText()).match(/Reservation (\S+) created/)[1];
    });
    await this.nav('Reservations');
    await this.e.step(`Open saved reservation ${id}`,async()=>{
      await this.page.getByRole('link',{name:id,exact:true}).click();
      await expect(this.page.getByRole('heading',{name:id,exact:true})).toBeVisible();
      await expect(this.page.getByText(/Status: confirmed/)).toBeVisible();
      if(total!==undefined)await this.channelValue('Total guest charges',total);
    });
    return id;
  }
  async edit(){await this.e.step('Open saved reservation editor',async()=>{await this.page.getByRole('button',{name:'Edit details',exact:true}).click();await expect(this.pane).toBeVisible();});}
  async saveEdit(){await this.e.step('Save changes through UI',async()=>{await this.pane.getByRole('button',{name:'Save Changes',exact:true}).click();await expect(this.pane).toHaveCount(0);});}
  async manual({method='fixed',value,scope='reservation',target,label='Browser verified discount'}){
    const details=await this.expand('Discounts');
    await this.e.step(`Apply ${scope} ${method} discount ${value}`,async()=>{
      await details.getByLabel('Manual discount label',{exact:true}).fill(label);
      await details.getByRole('combobox',{name:'Applies to',exact:true}).selectOption(scope);
      await details.getByRole('combobox',{name:'Discount type',exact:true}).selectOption(method);
      if(target)await details.getByRole('combobox',{name:'Target',exact:true}).selectOption(target);
      await details.getByLabel(method==='percentage'?'Percentage':'Amount',{exact:true}).fill(String(value));
      await details.getByRole('button',{name:'+ Add discount',exact:true}).click();
    });
  }
  async extra(product='laundry',room='101'){const article=await this.configure(room);await this.e.step(`Add extra ${product}`,()=>article.getByLabel('Add extra charge',{exact:true}).selectOption(product));return article;}
  async channelDraft(){await this.draft({source:'booking-com'});await this.e.step('Record fictional OTA booking reference',()=>this.pane.getByLabel('External booking reference',{exact:true}).fill('PW-FICTIONAL-REF'));}
  async override(value='800',reason='Fictional document for browser scenario'){
    await this.expand('Use a channel accommodation total');
    await this.e.step(`Enter external accommodation ${value}`,async()=>{
      await this.pane.getByLabel(/^Confirmed accommodation/).fill(value);
      await this.pane.getByLabel('Override reason',{exact:true}).fill(reason);
    });
  }
  async collection(amount){
    await this.expand('Verify guest collection');
    await this.e.step(`Record simulated verified collection ${amount}`,async()=>{
      await this.pane.getByLabel('Verified collected amount (PHP)',{exact:true}).fill(String(amount));
      await this.pane.getByLabel('Payment document reference',{exact:true}).fill('PW-FICTIONAL-PAYMENT');
      await this.pane.getByRole('combobox',{name:'Verification',exact:true}).selectOption('confirmed');
      await this.pane.getByRole('button',{name:'Add verified collection',exact:true}).click();
    });
  }
  async detailedCollection({kind='refund',amount,reference='PW-FICTIONAL-REFUND'}){
    await this.expand('Record verified collection / refund / reversal',this.page);
    await this.e.step(`Append ${kind} ${amount} with fictional evidence`,async()=>{
      await this.page.getByRole('combobox',{name:'Transaction',exact:true}).selectOption(kind);
      await this.page.getByLabel('Verified amount (PHP)',{exact:true}).fill(String(amount));
      await this.page.getByLabel('Document / collection reference',{exact:true}).fill(reference);
      await this.page.getByRole('button',{name:'Record verification',exact:true}).click();
    });
  }
  async checkNoBrowserErrors(){await expect(this.e.pageErrors,'Unhandled browser errors').toEqual([]);await expect(this.e.badResponses,'HTTP failures').toEqual([]);await expect(this.e.failedRequests,'Failed requests').toEqual([]);}
}
