// Validate the inventory and report integrity without opening a browser or running booking tests.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { scenarios, rules } from './matrix.mjs';
const root=resolve('booking-tests');
for(const file of readdirSync(root).filter(file=>file.endsWith('.mjs'))){
  const result=spawnSync(process.execPath,['--check',resolve(root,file)],{encoding:'utf8'});
  assert.equal(result.status,0,`${file}: ${result.stderr}`);
}
assert.equal(new Set(scenarios.map(s=>s.id)).size,scenarios.length,'Scenario IDs must be unique');
assert.equal(new Set(rules.map(r=>r.id)).size,rules.length,'Rule IDs must be unique');
const browserCode=readFileSync(resolve(root,'booking.pw.mjs'),'utf8');
const configurationCode=readFileSync(resolve(root,'configuration-cases.mjs'),'utf8');
for(const scenario of scenarios){
  assert.ok(scenario.rules.every(id=>rules.some(r=>r.id===id)),scenario.id+' references unknown rule');
  assert.ok(scenario.expected&&scenario.preconditions&&scenario.references,scenario.id+' missing contract');
  if(scenario.implemented)assert.ok((scenario.kind==='configuration'?configurationCode:browserCode).includes(`case '${scenario.kind==='configuration'?scenario.id:scenario.kind}'`),scenario.id+' has no dispatch');
}
const inventory=JSON.parse(readFileSync(resolve(root,'scenario-matrix.json'),'utf8'));
assert.deepEqual(inventory.scenarios,scenarios,'Regenerate the inventory after changes');
assert.deepEqual(inventory.rules,rules);
const reportPath=resolve(root,'reports/coverage/results.json');
if(existsSync(reportPath)){
  const report=JSON.parse(readFileSync(reportPath,'utf8'));
  assert.equal(report.results.length,scenarios.length);
  assert.equal(Object.values(report.counts).reduce((sum,n)=>sum+n,0),scenarios.length);
  for(const status of ['PASS','FAIL','BLOCKED','UNEXECUTED'])assert.equal(report.counts[status],report.results.filter(r=>r.status===status).length);
  let screenshots=0;
  for(const result of report.results){
    if(result.status==='PASS'||result.status==='FAIL'){
      assert.equal(result.started,true,result.id+' must reach actual UI');
      assert.ok(existsSync(result.finalScreenshot),result.id+' final evidence missing');screenshots++;
      assert.ok(result.steps.length>0,result.id+' needs numbered steps');
      for(const step of result.steps){assert.ok(existsSync(step.screenshot),result.id+' step screenshot missing');screenshots++;}
      if(result.status==='PASS'){assert.ok(result.steps.every(step=>!step.error),result.id+' passed with failed step');assert.equal(result.errors.length,0,result.id+' passed with evidence errors');}
      else assert.ok(result.errors.length>0,result.id+' failure needs assertion/error details');
    }else if(result.status==='BLOCKED')assert.ok(result.gap||result.errors?.length,result.id+' blocked without reason');
  }
  console.log(`Inventory/report integrity passed: ${scenarios.length} scenarios, ${rules.length} rules, ${screenshots} linked step/final screenshots exist.`);
}else console.log(`Inventory syntax/traceability passed: ${scenarios.length} scenarios, ${rules.length} rules. No execution report yet.`);
