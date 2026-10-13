import { readFileSync } from 'node:fs';
import { renderReport } from './report.mjs';
export default class BookingReporter {
  runs=[]; errors=[];
  onError(error){this.errors.push(error.message??String(error));}
  onTestEnd(test,result){
    const id=test.title.split(' ')[0];
    const attachment=result.attachments.find(a=>a.name==='scenario-evidence');
    let evidence={};
    try {if(attachment) evidence=JSON.parse(attachment.body?.toString() ?? readFileSync(attachment.path,'utf8'));} catch(e){this.errors.push(`Evidence read ${id}: ${e.message}`);}
    const errors=result.errors.map(e=>e.message??String(e));
    const prerequisiteFailure=!evidence.started && (result.status==='failed'||result.status==='timedOut');
    this.runs.push({id,...evidence,status:result.status==='passed'?'PASS':result.status==='skipped'||prerequisiteFailure?'BLOCKED':'FAIL',
      actual:evidence.actual??(prerequisiteFailure?'Browser/test setup failed before scenario actions.':result.status==='skipped'?'Scenario blocked; see gap.':'Scenario assertion failed; inspect errors and final browser state.'),
      errors:[...(evidence.errors??[]),...errors],artifacts:result.attachments.filter(a=>a.path).map(a=>({name:a.name,path:a.path})),durationMs:result.duration});
    renderReport(process.env.HMS_BOOKING_SESSION,this.runs,(process.env.HMS_BOOKING_IDS??'').split(','),this.errors);
  }
  onEnd(){const counts=renderReport(process.env.HMS_BOOKING_SESSION,this.runs,(process.env.HMS_BOOKING_IDS??'').split(','),this.errors);console.log(`Booking evidence: ${process.env.HMS_BOOKING_SESSION}/index.html\n${JSON.stringify(counts)}`);}
}
