import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { scenarios } from './matrix.mjs';
import { aggregateReports } from './aggregate.mjs';
const args = process.argv.slice(2);
const mode = args[0];
if (!mode || mode === '--help') {
  console.log('On-demand only: node booking-tests/run.mjs --list | --scenario ID | --module FEATURE | --priority P0 | --full\nOptional: --base-url URL (already running app); --headed; --list with a selection for a dry run.');
  process.exit(mode ? 0 : 2);
}
let selected;
if(mode==='--scenario') {
  const ids=(args[1]??'').split(',');
  const unknown=ids.filter(id=>!scenarios.some(s=>s.id===id));
  if(unknown.length)throw new Error(`Unknown scenario ID(s): ${unknown.join(', ')}`);
  selected=scenarios.filter(s=>ids.includes(s.id));
}
else if(mode==='--module') selected=scenarios.filter(s=>s.module===args[1]);
else if(mode==='--priority') selected=scenarios.filter(s=>s.priority===args[1]);
else if(mode==='--full'||mode==='--list') selected=scenarios;
else throw new Error(`Unknown mode ${mode}`);
if (!selected.length) throw new Error('No matching scenarios. Use --list for IDs/modules.');
const resumeIndex=args.indexOf('--resume');
if(resumeIndex>=0){
  if(!args[resumeIndex+1])throw new Error('--resume needs a previous results.json path');
  const previous=JSON.parse(readFileSync(resolve(args[resumeIndex+1]),'utf8'));
  const passed=new Set(previous.results.filter(s=>s.status==='PASS').map(s=>s.id));
  selected=selected.filter(s=>!passed.has(s.id));
  if(!selected.length){console.log('All selected cases already passed in that session.');process.exit(0);}
}
if (args.includes('--list')) {
  for (const s of selected) console.log(`${s.id.padEnd(25)} ${s.module.padEnd(14)} ${s.priority} ${s.implemented?'IMPLEMENTED':s.executable?'PENDING':'BLOCKED'} ${s.description}`);
  process.exit(0);
}
const session = new Date().toISOString().replaceAll(':','-').replaceAll('.','-')+'-'+process.pid;
const folder=resolve('booking-tests/reports',session);
mkdirSync(folder,{recursive:true});
const sourceFiles=[];
function fingerprint(directory){for(const entry of readdirSync(directory,{withFileTypes:true})){const path=resolve(directory,entry.name);if(entry.isDirectory())fingerprint(path);else sourceFiles.push({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});}}
fingerprint(resolve('src'));
for(const path of ['package.json','package-lock.json',...readdirSync('booking-tests').filter(name=>name.endsWith('.mjs')).map(name=>`booking-tests/${name}`)])sourceFiles.push({path:resolve(path),sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});
writeFileSync(resolve(folder,'environment.json'),JSON.stringify({sourceRevision:spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout?.trim(),workingTree:spawnSync('git',['status','--short'],{encoding:'utf8'}).stdout,node:process.version,platform:process.platform,architecture:process.arch,baseURL:args.includes('--base-url')?args[args.indexOf('--base-url')+1]:'http://127.0.0.1:5173',timezone:'Asia/Manila',viewport:{width:1600,height:1050},sourceFiles},null,2));
const env={...process.env,HMS_BOOKING_ON_DEMAND:'1',HMS_BOOKING_SESSION:folder,HMS_BOOKING_IDS:selected.map(s=>s.id).join(',')};
const baseIndex=args.indexOf('--base-url');
if(baseIndex>=0) {if(!args[baseIndex+1]) throw new Error('Missing URL');env.HMS_BOOKING_BASE_URL=args[baseIndex+1];}
writeFileSync(resolve(folder,'selection.json'),JSON.stringify({session,selection:args,selected:selected.map(s=>s.id),createdAt:new Date().toISOString()},null,2));
const cli=resolve('node_modules/@playwright/test/cli.js');
console.log(`Session evidence: ${folder}`);
const result=spawnSync(process.execPath,[cli,'test','--config=booking-tests/playwright.config.mjs',...(args.includes('--headed')?['--headed']:[])],{stdio:'inherit',env});
aggregateReports();
process.exit(result.status ?? 1);
