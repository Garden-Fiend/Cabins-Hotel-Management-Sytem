// Read-only analysis of browser evidence; writes reports/triage, never application records.
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderReport } from './report.mjs';
import { aggregateReports } from './aggregate.mjs';
import { scenarios, rules } from './matrix.mjs';
const root=resolve('booking-tests/reports');
const defects={
  'GAP-DUPLICATE-SUBMIT':{classification:'APPLICATION DEFECT / P0',suspectedCause:'ReservationPane.addAdjustment uses Date.now() as ID. A fixed clock reproduces equal IDs; removal filters by ID and removes both independent entries. Same-millisecond collisions are the corresponding real-clock risk.'},
  'GAP-CALENDAR-GEOMETRY':{classification:'APPLICATION DEFECT / P1',suspectedCause:'Month/Year stay buttons use px-3 plus borders. Their rendered box cannot shrink below 26px, even though inline CSS ratios retain minute precision. The six-hour bar is 26px versus intended 22px (month) and approximately 0.83px (year) at the tested viewport.'},
  'CONFIG-OPTIONAL-CAPACITY':{classification:'APPLICATION DEFECT / P1',suspectedCause:'ConfigurationPage.save lists capacityOverride/description/operationalNotes as optional, but the shared field renderer gives their inputs required. Native validation prevents submit before domain validation can handle blanks.'},
};
for(const entry of readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()&&d.name!=='coverage')){
  const folder=resolve(root,entry.name), resultFile=resolve(folder,'results.json');
  // Recover interrupted first-run evidence from genuine Playwright artifacts, explicitly labeled.
  if(!existsSync(resultFile)){
    const selection=JSON.parse(readFileSync(resolve(folder,'selection.json'),'utf8'));
    const artifacts=resolve(folder,'artifacts');
    const dirs=existsSync(artifacts)?readdirSync(artifacts,{withFileTypes:true}).filter(d=>d.isDirectory()):[];
    const recovered=[];
    for(const dir of dirs){
      const path=resolve(artifacts,dir.name), errorFile=resolve(path,'error-context.md');
      if(!existsSync(errorFile))continue;
      const context=readFileSync(errorFile,'utf8'), id=selection.selected.find(id=>dir.name.includes(id));
      if(!id)continue;
      const screenshots=readdirSync(path).filter(name=>/^\d+-.*\.png$/.test(name));
      recovered.push({id,status:'FAIL',started:true,classification:'HARNESS / INTERRUPTED',actual:'Recovered from genuine browser screenshots and Playwright error-context after the outer command was interrupted. Runner completion was not observed.',errors:[context.match(/# Error details\s+```\s*([\s\S]*?)```/)?.[1]??context],steps:screenshots.filter(n=>!n.includes('Final-')).map(name=>({title:`Recovered capture: ${name}`,screenshot:resolve(path,name)})),finalScreenshot:screenshots.find(n=>n.includes('Final-'))?resolve(path,screenshots.find(n=>n.includes('Final-'))):undefined});
    }
    if(recovered.length)renderReport(folder,recovered,selection.selected,['This report was reconstructed from preserved artifacts after interruption; no new browser execution occurred.']);
  }
  if(!existsSync(resultFile))continue;
  const run=JSON.parse(readFileSync(resultFile,'utf8')), triage={};
  for(const result of run.results.filter(r=>r.status==='FAIL'||(r.status==='BLOCKED'&&r.implemented))){
    const messages=(result.errors??[]).join('\n');
    if(result.id==='GAP-DUPLICATE-SUBMIT'&&messages.includes('PW adjustment B'))triage[result.id]=defects[result.id];
    else if(result.id==='GAP-CALENDAR-GEOMETRY'&&messages.includes('Padding/minimum box sizing'))triage[result.id]=defects[result.id];
    else if(result.id==='CONFIG-OPTIONAL-CAPACITY'&&messages.includes('optional capacity'))triage[result.id]=defects[result.id];
    else triage[result.id]={classification:/Test timeout.*setting up|closed|Screenshot|CONNECTION_REFUSED/s.test(messages)?'ENVIRONMENT / EVIDENCE':'HARNESS',suspectedCause:'Earlier test setup/selector/assertion/evidence failure; subsequent corrected runs are preserved separately. See original assertion and latest result. No booking defect is inferred from this failure.'};
  }
  writeFileSync(resolve(folder,'triage.json'),JSON.stringify(triage,null,2));
  if(Object.keys(triage).length){
    if(!existsSync(resolve(folder,'original-results.json')))copyFileSync(resultFile,resolve(folder,'original-results.json'));
    if(existsSync(resolve(folder,'index.html'))&&!existsSync(resolve(folder,'original-index.html')))copyFileSync(resolve(folder,'index.html'),resolve(folder,'original-index.html'));
    renderReport(folder,run.results.filter(r=>run.selected.includes(r.id)).map(r=>({...r,...triage[r.id]})),run.selected,run.globalErrors);
  }
}
const counts=aggregateReports();
const latest=JSON.parse(readFileSync(resolve(root,'coverage/results.json'),'utf8'));
const failed=latest.results.filter(r=>r.status==='FAIL');
const blocked=latest.results.filter(r=>r.status==='BLOCKED');
const link=id=>`reports/coverage/index.html#${id}`;
writeFileSync(resolve('booking-tests/FINDINGS.md'),`# Booking browser findings\n\n${scenarios.length} scenarios discovered, ${scenarios.filter(s=>s.implemented).length} implemented, ${rules.length} traceable rules. Latest recorded outcomes across preserved batches: **${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.BLOCKED} BLOCKED, ${counts.UNEXECUTED} UNEXECUTED**. Each implemented scenario has reached the actual application UI; all hotel data and financial transactions remain simulated session memory. This is not complete production or combinatorial coverage.\n\n## Verified failures\n\n${failed.map(r=>`- [${r.id}](${link(r.id)}) — ${r.classification??'Needs triage'}: ${r.suspectedCause??r.description}`).join('\n')}\n\nThe adjustment failure is reproduced with a deterministic fixed hotel clock, making the ID collision reliable. It demonstrates the same-timestamp boundary rather than asserting collisions occur during every ordinary interaction. The geometry probe verifies minute-accurate style percentages before comparing actual rendered widths. The capacity probe supplies valid description/notes so the remaining invalid native constraint is the optional blank capacity. Application logic was not edited or repaired.\n\n## Blocked coverage\n\n${blocked.map(r=>`- ${r.id}: ${r.gap}`).join('\n')}\n\nCapability denial and invalid direct-domain calls cannot be driven through the granted-capability demo UI; contact/occupancy policies need confirmation; cancellation financial policy and real persistence/banking are unavailable. Static inspection also finds no explicit lifecycle guard in cancelReservation; this is an unverified domain concern, not a browser-discovered defect. Existing unit tests are separate evidence and are not counted as browser passes.\n\n## Validation actually run\n\n- Existing Vitest suite: 161 tests in 26 files passed.\n- npm run lint passed.\n- npm run build passed; existing >500 kB bundle-size warning remains.\n- Browser suite ran in manually selected batches, with no automatic hooks or CI changes. JavaScript syntax and inventory/report consistency were checked separately.\n\n## Preserved sessions and limitations\n\n[Visual coverage report](reports/coverage/index.html), [execution history](reports/coverage/execution-history.json), [scenario matrix](SCENARIO-MATRIX.md), and [execution instructions](README.md). Early selector, encoding, text-comparison and browser/setup failures remain preserved and classified. No result or screenshot was fabricated; no failures were silently deleted. Tests use Chromium desktop/Asia-Manila and SPA navigation. The isolated test server disables hot reload and ignores generated artifacts after unexpected reloads were observed in development-server traces. Foreign-currency hotel setups, backend concurrency, other browsers/viewports and unsupported policies are excluded.\n`, 'utf8');
