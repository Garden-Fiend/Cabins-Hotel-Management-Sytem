import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {describe,expect,it,vi} from 'vitest';
import {ReservationDemoProvider} from '../../app/ReservationDemoContext';
import {ReservationDemoContext,type ReservationDemoContextValue} from '../../app/reservationDemoStore';
import {useReservationDemo} from '../../app/useReservationDemo';
import {ConfigurationPage} from '../../pages/ConfigurationPage';
import type {ChannelAgreement} from '../../features/channels/types';
type Commands=NonNullable<ReservationDemoContextValue['commands']>;
const agreement:ChannelAgreement={id:'agreement',channelId:'source',version:1,serverVersion:1,status:'active',currency:'PHP',effectiveFrom:'2026-10-01',pricing:{allowOverride:false,reasonRequired:true},commission:{method:'fixed',basis:'explicit_amount',fixedMinor:9007199254740991,rateBasisPoints:0,allowOverride:false},payment:{collection:'per_reservation'},settlement:{method:'manual'}};
function Fixture({commands}:{commands:Partial<Commands>}){
 const base=useReservationDemo(),unused=async()=>{throw new Error('Unexpected command');};
 return <ReservationDemoContext.Provider value={{...base,mode:'api',capabilities:{...base.capabilities,manage_channels:true},setConfiguration:()=>{throw new Error('No demo fallback');},configuration:{...base.configuration,bookingSources:[{id:'source',label:'Partner',classification:'ota',enabled:true,serverVersion:2,agreementVersion:1}],channelAgreements:[agreement]},commands:{create:unused,patch:unused,createGuest:unused,...commands}}}><ConfigurationPage/></ReservationDemoContext.Provider>;
}
function setup(commands:Partial<Commands>){render(<ReservationDemoProvider><Fixture commands={commands}/></ReservationDemoProvider>);fireEvent.click(screen.getByRole('button',{name:'Booking Sources'}));}
describe('original API source configuration entry point',()=>{
 it('blocks saves until explicit version review has finished',async()=>{
  let resolve:((value:Awaited<ReturnType<NonNullable<Commands['loadChannels']>>>)=>void)|undefined;
  const pending=new Promise<Awaited<ReturnType<NonNullable<Commands['loadChannels']>>>>(done=>{resolve=done;});
  const save=vi.fn();setup({saveSource:save,loadChannels:()=>pending});
  fireEvent.click(screen.getByRole('button',{name:'Details / history'}));
  fireEvent.click(screen.getByRole('button',{name:'Load latest versions and review draft'}));
  expect(screen.getByRole('button',{name:'Save channel'}).closest('fieldset')).toHaveProperty('disabled',true);
  expect(screen.getByRole('button',{name:'Details / history'})).toHaveProperty('disabled',true);
  resolve!({sources:[{id:'source',label:'Partner',enabled:true,serverVersion:3,agreementVersion:1}],agreements:[]});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Save channel'}).closest('fieldset')).toHaveProperty('disabled',false));
  expect(save).not.toHaveBeenCalled();
 });
 it('enables its original controls and retains source drafts on failed saves',async()=>{
  const save=vi.fn().mockRejectedValue(new Error('Save not confirmed'));
  setup({saveSource:save});fireEvent.click(screen.getByRole('button',{name:'Add channel'}));
  fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Local draft'}});fireEvent.click(screen.getByRole('button',{name:'Save channel'}));
  await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('not confirmed'));
  expect(screen.getByLabelText('Name')).toHaveProperty('value','Local draft');expect(save).toHaveBeenCalledOnce();
 });
 it('reopens exact fixed cents and keeps published rules frozen',()=>{
  setup({saveSource:vi.fn()});fireEvent.click(screen.getByRole('button',{name:'Details / history'}));
  fireEvent.click(screen.getByRole('button',{name:'Edit dates / status'}));
  expect(screen.getByLabelText('Fixed amount')).toHaveProperty('value','90071992547409.91');
  expect(screen.getByLabelText('Fixed amount').closest('fieldset')).toHaveProperty('disabled',true);
  expect(screen.getByLabelText('Effective from').closest('fieldset')).toHaveProperty('disabled',false);
 });
 it('explicit latest-version review preserves local metadata and updates concurrency tokens',async()=>{
  const load=vi.fn().mockResolvedValue({sources:[{id:'source',serverVersion:7,agreementVersion:3}],agreements:[]});
  const save=vi.fn().mockResolvedValue({id:'source',label:'Partner',enabled:true,serverVersion:8});
  setup({saveSource:save,loadChannels:load});fireEvent.click(screen.getByRole('button',{name:'Details / history'}));
  fireEvent.change(screen.getByLabelText('Internal notes'),{target:{value:'Retain my draft'}});
  fireEvent.click(screen.getByRole('button',{name:'Load latest versions and review draft'}));
  await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('Your draft is retained'));
  fireEvent.click(screen.getByRole('button',{name:'Save channel'}));
  await waitFor(()=>expect(save).toHaveBeenCalledWith(expect.objectContaining({notes:'Retain my draft',serverVersion:7,agreementVersion:3}),false));
 });
});
