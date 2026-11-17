// Portable, uncompressed ZIP: no dependency, executable, platform login or network.
import fs from 'node:fs';
import path from 'node:path';
const crcTable = Array.from({length:256}, (_, n) => {
  for (let i=0;i<8;i++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(data) {
  let n=0xffffffff;
  for (const byte of data) n = crcTable[(n ^ byte) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}
export function zipStored(entries) {
  const blocks=[], directory=[]; let offset=0;
  for (const [name, value] of entries) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(name) || name.includes('..') || name.startsWith('/')) throw new Error('素材包文件名无效');
    const data=Buffer.isBuffer(value)?value:Buffer.from(value,'utf8'), filename=Buffer.from(name);
    const header=Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20,4);
    header.writeUInt16LE(33,12); // Valid DOS date: 1980-01-01.
    header.writeUInt32LE(crc32(data),14); header.writeUInt32LE(data.length,18); header.writeUInt32LE(data.length,22); header.writeUInt16LE(filename.length,26);
    const central=Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6);
    header.copy(central,8,6,26); central.writeUInt16LE(filename.length,28); central.writeUInt32LE(offset,42);
    blocks.push(header,filename,data); directory.push(central,filename); offset+=header.length+filename.length+data.length;
  }
  const end=Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(directory.reduce((n,b)=>n+b.length,0),12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...blocks,...directory,end]);
}
export function xDraftBundle(job) {
  const entries=[['draft.txt', job.content]], files=[];
  for (const [i,file] of job.images.entries()) {
    const name=`images/${String(i+1).padStart(2,'0')}${path.extname(file).toLowerCase()}`;
    files.push(name); entries.push([name,fs.readFileSync(file)]);
  }
  entries.push(['manifest.json',JSON.stringify({platform:'x',title:job.title,content:job.content,images:files,submit:false},null,2)]);
  entries.push(['README.txt','X 文图草稿包\n\n正文见 draft.txt；配图按 images 内编号顺序。\n由本人在自己的 X 窗口确认账号，粘贴正文并手工附图、检查预览。\n本包没有连接 X、上传图片、保存平台草稿或发布。\n长文须本人确认账号权限与字数限制；不截断正文、不自动拆线程。\nmanifest.json 只描述本包素材，不含命令或登录数据。\n']);
  return zipStored(entries);
}
