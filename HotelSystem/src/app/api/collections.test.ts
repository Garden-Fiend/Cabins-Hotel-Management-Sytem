import {expect,it} from 'vitest';
import {collectionDecimal} from './collections';
import {parseMinor} from '../../lib/channelFinance';

it('reopens the maximum exact PHP amount without losing its final cent',()=>{
 const text=collectionDecimal(Number.MAX_SAFE_INTEGER);
 expect(text).toBe('90071992547409.91');
 expect(parseMinor(text,'PHP')).toBe(Number.MAX_SAFE_INTEGER);
});
it('retains signed credit cents and rejects unsafe amounts',()=>{
 expect(collectionDecimal(-Number.MAX_SAFE_INTEGER)).toBe('-90071992547409.91');
 expect(collectionDecimal(-1)).toBe('-0.01');
 expect(()=>collectionDecimal(Number.MAX_SAFE_INTEGER+1)).toThrow();
});
