import {expect,it} from "vitest";
import {overrideMinor} from "./presetInputs";

it("rounds exact decimal replacement units half up without floating-point conversion",()=>{
  expect(overrideMinor("1.005")).toBe(101);
  expect(overrideMinor("120.01")).toBe(12001);
  expect(overrideMinor("0")).toBe(0);
  expect(overrideMinor("0.0049")).toBe(0);
  expect(overrideMinor("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
  for(const invalid of ["90071992547409.915","-1","NaN","1e2","", "1.2.3"])expect(()=>overrideMinor(invalid)).toThrow();
});
