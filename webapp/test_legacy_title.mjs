import assert from 'node:assert/strict'
import { legacyTitle } from './src/legacy-title.js'
const text='[原创]【申精】9288s终极系统（已上传完毕）'
for (const value of [`font color=#FF00FF${text}font`, `<font color=#FF00FF>${text}</font>`, `<font color="#FF00FF">${text}</font`]) {
  assert.deepEqual(legacyTitle(value),{text,color:'#FF00FF'})
}
for (const text of ['普通标题','font 使用说明 font','font color=javascript:alert(1)危险font']) {
  assert.deepEqual(legacyTitle(text),{text,color:undefined})
}
console.log('PASS: legacy title wrappers, plain text and invalid colors')
