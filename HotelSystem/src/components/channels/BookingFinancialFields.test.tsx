import {useState} from 'react';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ApiBookingFinancialFields} from './ApiBookingFinancialFields';
import {emptyBookingFinancials} from '../../app/api/bookingFinancials';
import type {ChannelAgreement} from '../../features/channels/types';
import {BookingFinancialContents} from './BookingFinancialContents';
import type {BookingFinancialCapture} from '../../app/api/bookingFinancials';

afterEach(cleanup);
const source={id:'source',label:'Channel',enabled:true,classification:'ota' as const,serverVersion:3,referenceRequired:true};
const agreement:ChannelAgreement={id:'agreement',channelId:source.id,version:2,serverVersion:4,effectiveFrom:'2026-10-01',effectiveTo:'2026-10-31',status:'active',currency:'PHP',
 pricing:{allowOverride:true,reasonRequired:true},commission:{method:'percentage',basis:'confirmed_accommodation',rateBasisPoints:1500,fixedMinor:0,allowOverride:false},payment:{collection:'channel'},settlement:{method:'deducted'}};
function Harness({onValidity=vi.fn(),onReview}:{onValidity?:(valid:boolean)=>void;onReview?:()=>Promise<{sources:typeof source[];agreements:ChannelAgreement[]}>}){
 const [value,setValue]=useState(emptyBookingFinancials(source));
 return <><ApiBookingFinancialFields source={source} agreements={[agreement]} value={value} onChange={setValue} onValidity={onValidity} onReviewDefinitions={onReview}/><output aria-label="Financial intent">{JSON.stringify(value)}</output></>;
}
it('requires an explicit date and resolves the inclusive published revision without inventing payment',()=>{
 render(<Harness/>);
 expect((screen.getByLabelText('External booking confirmation date') as HTMLInputElement).value).toBe('');
 fireEvent.change(screen.getByLabelText('External booking confirmation date'),{target:{value:'2026-10-31'}});
 expect(screen.getByText('Published agreement v2',{exact:false})).toBeTruthy();
 const intent=JSON.parse(screen.getByLabelText('Financial intent').textContent!);
 expect(intent.expected_agreement_id).toBe('agreement');expect(intent.expected_agreement_version).toBe(4);
 expect(intent.collection).toBe('channel');expect(intent.guest_paid_status).toBe('unknown');
 expect(screen.queryByText('Add verified collection')).toBeNull();
});
it('retains invalid decimal input and blocks saving instead of submitting the previous amount',()=>{
 const validity=vi.fn();render(<Harness onValidity={validity}/>);
 fireEvent.change(screen.getByLabelText('Guest accommodation amount reported by booking document (PHP)'),{target:{value:'12.345'}});
 expect(screen.getByRole('alert').textContent).toContain('precision');expect(validity).toHaveBeenLastCalledWith(false);
 expect((screen.getByLabelText('Guest accommodation amount reported by booking document (PHP)') as HTMLInputElement).value).toBe('12.345');
});
it('shows missing agreements explicitly without manufacturing manual terms',()=>{
 render(<Harness/>);fireEvent.change(screen.getByLabelText('External booking confirmation date'),{target:{value:'2026-11-01'}});
 const intent=JSON.parse(screen.getByLabelText('Financial intent').textContent!);
 expect(intent.expected_agreement_id).toBeNull();expect(intent.manual_terms).toBeNull();
 expect(screen.getByText('Manually specified arrangement')).toBeTruthy();
});
it('reopens the exact maximum supported contractual cents without a floating conversion',()=>{
 const value={...emptyBookingFinancials(source),confirmation_date:'2026-10-16',contractual_accommodation_minor:Number.MAX_SAFE_INTEGER};
 render(<ApiBookingFinancialFields source={source} agreements={[agreement]} value={value} onChange={vi.fn()} onValidity={vi.fn()}/>);
 expect((screen.getByLabelText(/^Confirmed accommodation/) as HTMLInputElement).value).toBe('90071992547409.91');
});
it('retries failed definition review without losing the draft or saving stale version tokens',async()=>{
 const review=vi.fn().mockRejectedValueOnce(new Error('Definitions offline')).mockResolvedValueOnce({sources:[{...source,serverVersion:4}],agreements:[{...agreement,serverVersion:5}]});
 render(<Harness onReview={review}/>);
 fireEvent.change(screen.getByLabelText('External booking confirmation date'),{target:{value:'2026-10-16'}});
 fireEvent.change(screen.getByLabelText('External booking reference'),{target:{value:'LOCAL-123'}});
 fireEvent.click(screen.getByRole('button',{name:'Review latest source and agreement'}));
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Definitions offline'));
 fireEvent.click(screen.getByRole('button',{name:'Review latest source and agreement'}));
 await waitFor(()=>expect(JSON.parse(screen.getByLabelText('Financial intent').textContent!).expected_source_version).toBe(4));
 const intent=JSON.parse(screen.getByLabelText('Financial intent').textContent!);
 expect(intent.expected_agreement_version).toBe(5);expect(intent.external_reference).toBe('LOCAL-123');
});
it('displays captured financial values and labels independently of current definitions',()=>{
 const input={...emptyBookingFinancials(source),confirmation_date:'2026-10-16',external_reference:'OLD-1'};
 const capture={source_label:'Historical channel',provenance:'published_agreement',agreement_revision:2,input,reason:'Initial capture',terms:{commission:{method:'percentage'}},
 figures:{standard_accommodation_minor:300000,discounted_accommodation_minor:300000,contractual_accommodation_minor:300000,accommodation_adjustment_minor:0,additional_charges_minor:50000,total_minor:350000,guest_paid_minor:270000,guest_paid_status:'reported_paid',difference_classification:'channel_funded',commission_minor:45000,commission_basis_minor:300000,collection:'channel',settlement_method:'deducted',expected_settlement_minor:255000}} as BookingFinancialCapture;
 render(<BookingFinancialContents capture={capture}/>);
 expect(screen.getByText(/Historical channel/)).toBeTruthy();expect(screen.getByText(/No hotel payment receipt/)).toBeTruthy();
 expect(screen.getByText('Expected channel remittance')).toBeTruthy();
});
it('keeps retired captured agreement controls available instead of substituting current defaults',()=>{
 const value={...emptyBookingFinancials(source),confirmation_date:'2026-10-16',expected_agreement_id:agreement.id,
  expected_agreement_version:agreement.serverVersion!,contractual_accommodation_minor:100000};
 const captured={source_id:source.id,agreement_id:agreement.id,agreement_revision:agreement.version,
  agreement_version:agreement.serverVersion!,agreement_effective_from:agreement.effectiveFrom,
  agreement_effective_to:agreement.effectiveTo,input:value,terms:{pricing:agreement.pricing,commission:agreement.commission,payment:agreement.payment,settlement:agreement.settlement}} as BookingFinancialCapture;
 render(<ApiBookingFinancialFields captured={captured} source={source} agreements={[{...agreement,status:'retired',serverVersion:5}]} value={value} onChange={vi.fn()} onValidity={vi.fn()}/>);
 expect(screen.getByText(/Retained captured agreement v2/)).toBeTruthy();
 expect((screen.getByLabelText(/^Confirmed accommodation/) as HTMLInputElement).value).toBe('1000.00');
 expect(screen.queryByText('Manually specified arrangement')).toBeNull();
});
