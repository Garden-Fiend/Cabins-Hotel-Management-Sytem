import {describe,expect,it} from 'vitest';
import {sourceInput,agreementInput,presentAgreement,presentSource,sourceLabel,type AgreementDto} from './sourceInputs';
import {applicableAgreement} from '../../lib/channelFinance';
const dto:AgreementDto={id:'a',company_id:'c',source_id:'s',revision:2,version:3,effective_from:'2026-10-16',effective_to:'2026-10-31',status:'active',currency:'PHP',terms:{pricing:{allowOverride:false,reasonRequired:true},commission:{method:'fixed',basis:'explicit_amount',fixedMinor:12345,rateBasisPoints:0,allowOverride:false},payment:{collection:'per_reservation'},settlement:{method:'manual'}},created_at:'2026-10-16T00:00:00Z',actor:'local-development'};
describe('source configuration transport',()=>{
 it('retains original source labels for historical receipt projections without a captured field',()=>{
  const sources=[{id:'s',source_id:'direct',label:'Renamed source',initial_label:'Original source',enabled:false}];
  expect(sourceLabel('s',null,sources)).toBe('Original source');
  expect(sourceLabel('s','Captured later name',sources)).toBe('Captured later name');
 });
 it('retains stable identity, classification and separate concurrency tokens',()=>{
  const source=presentSource({id:'s',source_id:'legacy',label:'Walk-in',classification:'direct',enabled:false,version:4,agreement_version:7});
  expect(sourceInput(source,false)).toMatchObject({classification:'direct',enabled:false,expected_version:4});
  expect(sourceInput(source,true)).not.toHaveProperty('expected_version');
  expect(source.agreementVersion).toBe(7);
 });
 it('keeps immutable revision and edit version distinct with exact integer cents',()=>{
  const agreement=presentAgreement(dto);
  expect(agreement.version).toBe(2);expect(agreement.serverVersion).toBe(3);
  expect(agreementInput(agreement,{id:'s',label:'Agent',enabled:true,serverVersion:4,agreementVersion:7},false)).toMatchObject({expected_version:3,expected_source_version:4,expected_agreement_version:7,terms:{commission:{fixedMinor:12345}}});
  expect(()=>agreementInput({...agreement,currency:'USD'},{id:'s',label:'Agent',enabled:true,serverVersion:4},true)).toThrow('PHP');
 });
 it('uses inclusive end dates and returns no match for future-only/expired periods',()=>{
  const agreement=presentAgreement(dto);
  expect(applicableAgreement([agreement],'s','2026-10-31')).toEqual(agreement);
  expect(applicableAgreement([agreement],'s','2026-11-01')).toBeUndefined();
  expect(applicableAgreement([agreement],'s','2026-10-15')).toBeUndefined();
 });
});
