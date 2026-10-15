import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ReservationDemoProvider} from '../app/ReservationDemoContext';
import {ReservationDemoContext,type ReservationDemoContextValue} from '../app/reservationDemoStore';
import {useReservationDemo} from '../app/useReservationDemo';
import {RoomsPage} from './RoomsPage';

type RetirementCommand=NonNullable<NonNullable<ReservationDemoContextValue['commands']>['retireDefinition']>;
function Fixture({save,busy=false}:{save:RetirementCommand;busy?:boolean}){
 const value=useReservationDemo();
 const unused=async()=>{throw new Error('Unexpected command');};
 return <ReservationDemoContext.Provider value={{...value,mode:'api',reservations:[],stays:[],configuration:{...value.configuration,rooms:value.configuration.rooms.slice(0,1).map(r=>({...r,serverVersion:7})),roomTypes:value.configuration.roomTypes.map(t=>({...t,serverVersion:3}))},commands:{busy,create:unused,patch:unused,createGuest:unused,retireDefinition:save}}}><RoomsPage/></ReservationDemoContext.Provider>;
}
function setup(save:RetirementCommand=vi.fn<RetirementCommand>().mockResolvedValue(undefined),busy=false){render(<ReservationDemoProvider><Fixture save={save} busy={busy}/></ReservationDemoProvider>);return save;}
afterEach(()=>vi.restoreAllMocks());
describe('API room retirement controls',()=>{
 it('uses a versioned command and filters archived records without demo mutations',async()=>{
  const save=setup();const card=screen.getByText('Room 101').closest('article')!;
  fireEvent.click(within(card).getByRole('button',{name:'Archive'}));
  await waitFor(()=>expect(save).toHaveBeenCalledWith('rooms',expect.any(String),7,'archive'));
  fireEvent.change(screen.getByLabelText('Show records'),{target:{value:'archived'}});
  expect(screen.queryByText('Room 101')).toBeNull();
  fireEvent.change(screen.getByLabelText('Show records'),{target:{value:'active'}});
  expect(screen.getByText('Room 101')).toBeTruthy();
 });
 it('requires deletion confirmation and retains a record on a blocked response',async()=>{
  const save=setup(vi.fn().mockRejectedValue(new Error('History uses this room; archive instead')));
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  const card=screen.getByText('Room 101').closest('article')!;
  fireEvent.click(within(card).getByRole('button',{name:'Delete permanently'}));expect(save).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);fireEvent.click(within(card).getByRole('button',{name:'Delete permanently'}));
  await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('archive instead'));
  expect(screen.getByText('Room 101')).toBeTruthy();
 });
 it('allows API type archive with assigned rooms but prevents duplicate submissions while busy',()=>{
  setup(vi.fn(),true);fireEvent.click(screen.getByRole('button',{name:'Room types'}));
  for(const button of screen.getAllByRole('button',{name:'Archive'}))expect(button).toHaveProperty('disabled',true);
 });
});
