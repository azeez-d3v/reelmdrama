// Dependency-free SHA-256 for bounded UTF-8 metadata/manifest evidence, not credentials.
export function utf8(value: string): number[] {
  const bytes: number[] = [];
  for (const char of value) {
    const c=char.codePointAt(0)!;
    if(c<128) bytes.push(c);
    else if(c<2048) bytes.push(192|(c>>>6),128|(c&63));
    else if(c<65536) bytes.push(224|(c>>>12),128|((c>>>6)&63),128|(c&63));
    else bytes.push(240|(c>>>18),128|((c>>>12)&63),128|((c>>>6)&63),128|(c&63));
  }
  return bytes;
}
export function sha256(value: string): string {
  const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const b=utf8(value),bitLength=b.length*8;
  b.push(128); while(b.length%64!==56)b.push(0);
  const hi=Math.floor(bitLength/0x100000000),lo=bitLength>>>0;
  for(const x of [hi,lo])for(let s=24;s>=0;s-=8)b.push((x>>>s)&255);
  const r=(x:number,n:number)=>(x>>>n)|(x<<(32-n));
  for(let offset=0;offset<b.length;offset+=64){
    const w=new Array<number>(64);
    for(let i=0;i<16;i++)w[i]=((b[offset+i*4]<<24)|(b[offset+i*4+1]<<16)|(b[offset+i*4+2]<<8)|b[offset+i*4+3])>>>0;
    for(let i=16;i<64;i++){const a=w[i-15],c=w[i-2];w[i]=(w[i-16]+(r(a,7)^r(a,18)^(a>>>3))+w[i-7]+(r(c,17)^r(c,19)^(c>>>10)))>>>0;}
    let[a,c,d,e,f,g,j,l]=h;
    for(let i=0;i<64;i++){const t1=(l+(r(f,6)^r(f,11)^r(f,25))+((f&g)^(~f&j))+k[i]+w[i])>>>0,t2=((r(a,2)^r(a,13)^r(a,22))+((a&c)^(a&d)^(c&d)))>>>0;l=j;j=g;g=f;f=(e+t1)>>>0;e=d;d=c;c=a;a=(t1+t2)>>>0;}
    for(const [i,x]of [a,c,d,e,f,g,j,l].entries())h[i]=(h[i]+x)>>>0;
  }
  return h.map(x=>x.toString(16).padStart(8,'0')).join('');
}
