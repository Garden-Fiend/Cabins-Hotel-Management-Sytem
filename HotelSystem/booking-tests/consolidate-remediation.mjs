// Explicit report generation only; never launches tests or changes historical sessions.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { renderReport } from './report.mjs';

const inputs=process.argv.slice(2).map(path=>resolve(path));
if(!inputs.length)throw new Error('Supply the completed remediation session directories, oldest first.');
const latest=new Map(), selected=new Set(), environments=[];
for(const session of inputs){
  const run=JSON.parse(readFileSync(resolve(session,'results.json'),'utf8'));
  environments.push({session,...JSON.parse(readFileSync(resolve(session,'environment.json'),'utf8'))});
  for(const id of run.selected){selected.add(id);const result=run.results.find(result=>result.id===id);if(result&&result.status!=='UNEXECUTED')latest.set(id,{...result,sourceSession:session});}
}
const applicationFingerprint=environment=>createHash('sha256').update(environment.sourceFiles.filter(file=>file.path.includes(`${process.platform==='win32'?'\\':'/'}src${process.platform==='win32'?'\\':'/'}`)&&!file.path.includes('.test.')).map(file=>`${file.path}:${file.sha256}`).sort().join('\n')).digest('hex');
const fingerprints=environments.map(applicationFingerprint);
if(new Set(fingerprints).size!==1)throw new Error('Application sources differ between sessions; do not consolidate them as one verified source state.');
const folder=resolve('booking-tests/reports',new Date().toISOString().replaceAll(':','-').replaceAll('.','-')+'-remediation');
const counts=renderReport(folder,[...latest.values()],[...selected],[]);
writeFileSync(resolve(folder,'environment.json'),JSON.stringify({applicationFingerprint:fingerprints[0],sessions:environments},null,2));
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link=path=>relative(folder,path).replaceAll('\\','/');
let html=readFileSync(resolve(folder,'index.html'),'utf8');
const metadata=`<h2>Remediation verification</h2><p>Consolidated selected outcomes: ${escape(JSON.stringify([...latest.values()].reduce((counts,result)=>({...counts,[result.status]:(counts[result.status]??0)+1}),{})))}. Other inventory cases were not rerun in this report.</p><p>Application SHA-256: ${fingerprints[0]}. Base Git revision: ${escape(environments[0].sourceRevision)} plus the recorded working tree. <a href="environment.json">Exact source manifests and execution environment</a>.</p><ul>${inputs.map(session=>`<li><a href="${link(resolve(session,'index.html'))}">${escape(session.split(/[\\/]/).pop())}</a> — original session, including any failures.</li>`).join('')}</ul><h2>Preserved before evidence</h2><p><a href="${link(resolve('booking-tests/reports/2026-10-12T01-01-04-925Z-4912/index.html'))}#GAP-DUPLICATE-SUBMIT">Original adjustment collision</a> · <a href="${link(resolve('booking-tests/reports/2026-10-12T01-04-33-985Z-5888/index.html'))}#CONFIG-OPTIONAL-CAPACITY">Original optional room-field failure</a> · <a href="${link(resolve('booking-tests/reports/2026-10-12T01-04-33-985Z-5888/index.html'))}#GAP-CALENDAR-GEOMETRY">Original calendar width failure</a></p>`;
html=html.replace('<h2>Coverage by feature</h2>',metadata+'<h2>Coverage by feature</h2>');
// Consolidated artifacts stay in their original sessions, including native Playwright reports.
html=html.replace('href="playwright/index.html"',`href="${link(resolve(inputs.at(-1),'playwright/index.html'))}"`);
writeFileSync(resolve(folder,'index.html'),html);
console.log(JSON.stringify({folder,counts,selected:selected.size,applicationFingerprint:fingerprints[0]},null,2));
