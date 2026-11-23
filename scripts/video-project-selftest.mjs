import assert from 'node:assert/strict';
import {checkFaststart,makeVideoProject,projectFiles,projectPath,readProject} from '../src/web/video-project.js';

const box=(type,payload=[1,2,3,4])=>{
  const bytes=Buffer.alloc(8+payload.length);
  bytes.writeUInt32BE(bytes.length); bytes.write(type,4); Buffer.from(payload).copy(bytes,8);
  return bytes;
};
const bytes=new Blob([box('ftyp'),box('free',new Uint8Array(70000)),box('moov'),box('mdat')]);
await checkFaststart(bytes);
await assert.rejects(checkFaststart(new Blob([box('ftyp'),box('mdat'),box('moov')])),/faststart/);
const broken=box('moov');broken.writeUInt32BE(0xffffffff);
await assert.rejects(checkFaststart(new Blob([box('ftyp'),broken,box('mdat')])),/有效的 MP4/);

assert.equal(projectPath('封面\\cover-16x9.png'),'封面/cover-16x9.png');
for(const invalid of ['C:\\media\\a.mp4','../a.mp4','\\\\server\\a.mp4','video/../../file.mp4','/foo/bar']) assert.equal(projectPath(invalid),'');
const file=(contents,name)=>Object.assign(new File([contents],name.split(/[/\\]/).at(-1)),{webkitRelativePath:name});
const saved={version:1,id:'stable-id',name:'离线验收',video:'素材\\成片.mp4',covers:{'16x9':'封面\\cover-16x9.png'},platforms:{xhs:{skip:'已处理'}}};
const directory=projectFiles([
  file(bytes,'测试工程/素材/成片.mp4'),file('fake','测试工程/封面/cover-16x9.png'),
  file('\uFEFF'+JSON.stringify(saved),'测试工程/publish.json'),
]);
const loaded=await readProject(directory);
assert.equal(loaded.video,'素材/成片.mp4');
assert.equal(loaded.covers['16x9'],'封面/cover-16x9.png');
assert.throws(()=>projectFiles([file(bytes,'测试工程/成片.mp4'),file(bytes,'另一个/成片.mp4')]),/一个工程/);
const input={...directory,...loaded,editions:{youtube:{title:'验收视频',desc:'独立简介',tags:['测试']},xhs:{tags:[]}}};
const deps={media:async value=>{await checkFaststart(value);return 2.5;},image:async (_value,ratio)=>assert.equal(ratio,'16x9')};
const approved=await makeVideoProject(input,deps);
assert.deepEqual(approved.errors,[]);
assert.equal(approved.project.id,'stable-id');
assert.deepEqual(approved.project.platforms.youtube,{title:'验收视频',desc:'独立简介',tags:['测试'],covers:['16x9']});
assert.equal(approved.project.platforms.xhs.skip,'已处理');
assert.equal(approved.project.durationSec,2.5);
assert.equal(approved.project.schedule,undefined);
const missing=await makeVideoProject({...input,video:'缺失.mp4'},deps);
assert.equal(missing.project,null);
assert.match(missing.errors.join(' '),/MP4/);
const invalid=await makeVideoProject({...input,editions:{channels:{shortTitle:'短',body:'',tags:[]}}},deps);
assert.equal(invalid.project,null);
assert.match(invalid.errors.join(' '),/6–16/);
const badCover=await makeVideoProject(input,{...deps,image:async()=>{throw new Error('比例不符');}});
assert.equal(badCover.project,null);
assert.match(badCover.errors.join(' '),/比例不符/);
console.log('VIDEO PROJECT PASS: MP4 box ordering and bounds, Windows paths, legacy import, selected platforms, skip marker, validation and manifest.');
