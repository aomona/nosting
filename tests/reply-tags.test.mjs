import fs from 'node:fs/promises';import ts from 'typescript';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';import assert from 'node:assert/strict';
const out=resolve('.sites-runtime/reply-tags-test.mjs');await fs.writeFile(out,ts.transpileModule(await fs.readFile('lib/reply-tags.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
try{const {makeReplyTags}=await import(pathToFileURL(out));const id='1'.repeat(64),author='2'.repeat(64),root='3'.repeat(64),rootAuthor='4'.repeat(64),person='5'.repeat(64);const base={id,pubkey:author,kind:1,tags:[]};
assert.deepEqual(makeReplyTags(base),[['e',id,'','root',author],['p',author]]);
assert.deepEqual(makeReplyTags({...base,tags:[['e',root,'','root',rootAuthor],['p',person],['p',person],['p',author],['p','bad']]}),[['e',root,'','root',rootAuthor],['e',id,'','reply',author],['p',author],['p',person]]);
for(const tags of [[['e',root]],[['e',root],['e','6'.repeat(64)],['e','7'.repeat(64)]]])assert.deepEqual(makeReplyTags({...base,tags}).slice(0,2),[['e',root,'','root'],['e',id,'','reply',author]]);
assert.deepEqual(makeReplyTags({...base,tags:[['e',root,'','mention']]}),makeReplyTags(base));
assert.throws(()=>makeReplyTags({...base,kind:30023}));assert.throws(()=>makeReplyTags({...base,tags:[['e',root,'','reply']]}));assert.throws(()=>makeReplyTags({...base,tags:[['e',root,'','root'],['e','6'.repeat(64),'','root']]}));
assert.equal(makeReplyTags({...base,tags:[['e',root,'','root','bad'] ]})[0].length,4);
console.log('PASS NIP10 reply tags: top-level root only, nested root preservation, legacy root, inherited p dedup, valid author hints only, malformed/non-kind1 rejection');
}finally{await fs.rm(out)}
