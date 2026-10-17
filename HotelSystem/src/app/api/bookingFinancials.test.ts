import {expect,it} from 'vitest';
import {bookingFinancialPreview} from './bookingFinancials';
import type {ReservationPriceSummary} from '../../types/reservation';

it('replaces accommodation once after final-unit prices and reductions, leaving extras separate',()=>{
 const base={lines:[{kind:'room',amount:3000,finalAmount:2400},{kind:'charge',amount:500,finalAmount:450}],
 subtotal:3500,discountTotal:100,priceOverrideTotal:550,adjustmentTotal:20,amountOwed:2870} as ReservationPriceSummary;
 const result=bookingFinancialPreview(base,270000);
 expect(result.amountOwed).toBe(3170);expect(result.channel?.accommodationAdjustmentMinor).toBe(30000);
 expect(result.channel?.roomAllocations).toEqual([]);expect(result.channel?.verifiedCollectionMinor).toBe(0);
 expect(base.amountOwed).toBe(2870);
});
it('applies the final zero clamp after signed adjustments without treating reported payment as cash',()=>{
 const base={lines:[{kind:'room',amount:1000,finalAmount:900}],adjustmentTotal:-1000,amountOwed:0} as ReservationPriceSummary;
 expect(bookingFinancialPreview(base,100).amountOwed).toBe(0);
});
