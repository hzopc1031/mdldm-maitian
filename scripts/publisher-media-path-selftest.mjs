import assert from 'node:assert/strict';
import {publisherMediaPath,validPublisherRoot} from '../src/publisher-media-path.mjs';

assert.equal(validPublisherRoot('D:\\Ai 作品\\视频工程'),true);
assert.equal(validPublisherRoot('D:/Ai 作品/视频工程/'),true);
assert.equal(publisherMediaPath('D:\\Ai 作品\\视频工程\\','本期','封面/cover-4x3.png'),'D:\\Ai 作品\\视频工程\\本期\\封面\\cover-4x3.png');
assert.equal(publisherMediaPath('D:/Ai 作品/本期','','成片.mp4'),'D:\\Ai 作品\\本期\\成片.mp4');
assert.equal(publisherMediaPath('D:/','','成片.mp4'),'D:\\成片.mp4');
assert.equal(publisherMediaPath('/Volumes/成片/','本期','成片.mp4'),'/Volumes/成片/本期/成片.mp4');
for (const root of ['D:视频工程','..\\视频工程','\\\\machine\\share','/tmp/../home']) assert.equal(validPublisherRoot(root),false);
for (const file of ['../私有素材.mp4','D:\\成片.mp4','/tmp/成片.mp4','成片.mp4:别名','封面//图.png']) {
  assert.throws(()=>publisherMediaPath('D:/测试','本期',file),/相对路径/);
}
assert.throws(()=>publisherMediaPath('D:/测试','../别的工程','成片.mp4'));
console.log('PUBLISHER MEDIA PATH PASS: drive roots, Unicode and spaces, nested covers, POSIX roots, and relative path containment.');
