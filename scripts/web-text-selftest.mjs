import assert from 'node:assert/strict';
import { displayNick } from '../src/web-text.mjs';

const title = 'a'.repeat(13) + '😅😅尾';
assert.equal(displayNick(title), 'a'.repeat(13) + '😅😅尾');
assert.equal(displayNick('a'.repeat(15) + '😅尾'), 'a'.repeat(15) + '😅');
assert.equal(displayNick('标题，后半｜副标题'), '标题');
assert.equal(displayNick('标题', '自定义昵称'.repeat(8)), '自定义昵称'.repeat(8));
assert.equal(displayNick('标题', '导入\ud83d'), '导入�');
assert.equal(displayNick('\udc00标题'), '�标题');
assert.equal(displayNick(null), '');
console.log('WEB TEXT PASS: emoji boundary, malformed imports, punctuation, explicit nickname and empty name.');
