import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReport } from './report.mjs';
export function aggregateReports(root=resolve('booking-tests/reports')) {
  if(!existsSync(root))return;
  const sessions=readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()&&d.name!=='coverage').map(d=>resolve(root,d.name)).sort();
  const latest=new Map(), selected=new Set(), history=[], globalErrors=[];
  for(const folder of sessions){
    const resultFile=resolve(folder,'results.json');
    if(!existsSync(resultFile)){globalErrors.push(`Interrupted session without completed report: ${folder}; inspect raw screenshots/error-context in artifacts.`);continue;}
    const run=JSON.parse(readFileSync(resultFile,'utf8'));
    const triageFile=resolve(folder,'triage.json');
    const triage=existsSync(triageFile)?JSON.parse(readFileSync(triageFile,'utf8')):{};
    for(const id of run.selected){selected.add(id);const result=run.results.find(r=>r.id===id);if(result&&result.status!=='UNEXECUTED')latest.set(id,{...result,...triage[id],sourceSession:folder});}
    history.push({folder,counts:run.counts,selected:run.selected,failures:run.results.filter(r=>r.status==='FAIL'||r.status==='BLOCKED').map(r=>({id:r.id,status:r.status,...triage[r.id]}))});
    globalErrors.push(...run.globalErrors.map(e=>`${folder}: ${e}`));
  }
  const folder=resolve(root,'coverage');
  const counts=renderReport(folder,[...latest.values()],[...selected],globalErrors);
  writeFileSync(resolve(folder,'execution-history.json'),JSON.stringify(history,null,2));
  const reportFile=resolve(folder,'index.html');
  const links=history.map(h=>`<li><a href="${relative(folder,resolve(h.folder,'index.html')).replaceAll('\\','/')}">${h.folder.split(/[\\/]/).pop()}</a>: ${JSON.stringify(h.counts)}</li>`).join('');
  const latestPlaywright=[...history].reverse().find(h=>existsSync(resolve(h.folder,'playwright/index.html')));
  let html=readFileSync(reportFile,'utf8').replace('<h2>Coverage by feature</h2>',`<h2>Preserved execution sessions</h2><p>This aggregate shows the latest recorded result for each scenario. Earlier failures, harness corrections and blocked runs remain available below and in execution-history.json. A later pass does not erase earlier evidence.</p><ul>${links}</ul><h2>Coverage by feature</h2>`);
  if(latestPlaywright)html=html.replace('href="playwright/index.html"',`href="${relative(folder,resolve(latestPlaywright.folder,'playwright/index.html')).replaceAll('\\','/')}"`);
  writeFileSync(reportFile,html);
  console.log(`Cumulative evidence: ${reportFile}\n${JSON.stringify(counts)}`);
  return counts;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))aggregateReports();
