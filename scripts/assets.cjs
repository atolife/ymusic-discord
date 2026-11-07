const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const size = 64, scale = 4;
function rounded(x,y,left,top,right,bottom,r) {
  const dx=Math.max(left+r-x,0,x-(right-r)),dy=Math.max(top+r-y,0,y-(bottom-r));
  return x>=left && x<=right && y>=top && y<=bottom && dx*dx+dy*dy<=r*r;
}
const raw=Buffer.alloc(size*(size*4+1));
for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
  let r=0,g=0,b=0,a=0;
  for(let sy=0;sy<scale;sy++)for(let sx=0;sx<scale;sx++) {
    const px=x+(sx+.5)/scale,py=y+(sy+.5)/scale;
    if(!rounded(px,py,1,1,63,63,16))continue;
    const bar=rounded(px,py,16,25,23,44,3.5)||rounded(px,py,29,15,36,49,3.5)||rounded(px,py,42,21,49,43,3.5);
    r+=bar?32:201;g+=bar?49:239;b+=bar?23:145;a+=255;
  }
  const offset=y*(size*4+1)+1+x*4;
  const alpha=a/(scale*scale);
  if(a){raw[offset]=Math.round(r*255/a);raw[offset+1]=Math.round(g*255/a);raw[offset+2]=Math.round(b*255/a);raw[offset+3]=Math.round(alpha);}
}
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function chunk(name,data){const type=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);let c=0xffffffff;for(const byte of Buffer.concat([type,data]))c=table[(c^byte)&255]^(c>>>8);crc.writeUInt32BE((c^0xffffffff)>>>0);return Buffer.concat([length,type,data,crc]);}
const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
const target=path.resolve(__dirname,'../desktop');fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'icon.png'),png);
const ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico[6]=size;ico[7]=size;ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(png.length,14);ico.writeUInt32LE(22,18);fs.writeFileSync(path.join(target,'icon.ico'),Buffer.concat([ico,png]));
