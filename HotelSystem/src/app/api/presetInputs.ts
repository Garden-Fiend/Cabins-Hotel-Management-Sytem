/** Exact nonnegative PHP input, with the demo's half-up monetary boundary. */
export function overrideMinor(input:string):number {
  const value=input.trim();
  if(value.length>40 || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error("Enter a non-negative discounted unit price.");
  const [whole,fraction=""]=value.split(".");
  const rounded=BigInt(whole)*100n+BigInt(fraction.slice(0,2).padEnd(2,"0"))+(fraction.length>2 && fraction[2]>="5" ? 1n : 0n);
  const minor=Number(rounded);
  if(!Number.isSafeInteger(minor))throw new Error("Discounted unit price exceeds supported PHP precision.");
  return minor;
}
