import fs from 'node:fs/promises';import ts from 'typescript';import vm from 'node:vm';import assert from 'node:assert/strict';
const transpile=async path=>ts.transpileModule(await fs.readFile(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const media={};vm.runInNewContext(await transpile('lib/note-media.ts'),{exports:media,URL});
const emoji={};vm.runInNewContext(await transpile('lib/custom-emoji.ts'),{exports:emoji,require:()=>media,URL});
const profiles={};vm.runInNewContext(await transpile('lib/profiles.ts'),{exports:profiles,require:n=>n==='./custom-emoji'?emoji:media});
const read=data=>profiles.readProfile({content:JSON.stringify(data),created_at:1,id:'id'});
assert.equal(read({banner:'https://example.com/banner.jpg'}).banner,'https://example.com/banner.jpg');
for(const banner of ['http://example.com/b.png','javascript:alert(1)','data:image/png;base64,AA','https://localhost/b.png','https://127.0.0.1/b.png','https://[::1]/b.png','https://secret@example.com/b.png','https://example.com:8443/b.png',{},123,null])assert.equal(read({banner}).banner,'');
assert.equal(read({}).banner,'');assert.equal(read({display_name:'x'.repeat(120)}).display_name.length,100);assert.equal(read({about:'y'.repeat(6000)}).about.length,5000);
assert.equal(read([]),null);assert.equal(profiles.readProfile({content:'{bad',created_at:1,id:'id'}),null);assert.equal(read({about:'x'.repeat(20001)}),null);
const original=read({name:'original',banner:'https://example.com/old.jpg'}),updated={...read({name:'new'}),created_at:2};assert.equal(profiles.newerProfile(original,updated),true);assert.equal(updated.banner,'');
console.log('PASS kind0 profile/banner validation: https public URL only, empty/invalid/unsafe values, content and field limits, newer profile can remove banner');

assert.equal(profiles.readProfile({content:JSON.stringify({name:':x:'}),created_at:1,id:'1',tags:[['emoji','x','https://example.com/x.png']]}).emojis.x,'https://example.com/x.png');
assert.equal(Object.keys(profiles.readProfile({content:'{}',created_at:1,id:'1',tags:[['emoji','x','https://example.com/x.png'],['content-warning']]}).emojis).length,0);
