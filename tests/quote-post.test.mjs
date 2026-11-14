import fs from 'node:fs/promises';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {nip19,finalizeEvent,generateSecretKey} from 'nostr-tools';
const dir=resolve('.sites-runtime/quote-post-test');await fs.mkdir(dir,{recursive:true});
try{
 for(const name of ['quote-post','share-note','publication-tags','relays','quotes','reply-tags','local-drafts']){
  const source=(await fs.readFile(`lib/${name}.ts`,'utf8')).replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");
  await fs.writeFile(`${dir}/${name}.mjs`,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
 }
 const load=name=>import(pathToFileURL(`${dir}/${name}.mjs`));
 const {quotePost}=await load('quote-post'),{buildContentTags}=await load('publication-tags'),{quoteIds,quoteDisplayContent}=await load('quotes'),{makeReplyTags}=await load('reply-tags');
 const {draftKey,writeDraft,readDraft,clearSentDraft}=await load('local-drafts');
 const source=finalizeEvent({kind:1,content:'Original fixture',created_at:1,tags:[['e','a'.repeat(64),'','root'],['e','b'.repeat(64),'','reply'],['p','c'.repeat(64)],['q','d'.repeat(64)]]},generateSecretKey());
 const original=JSON.stringify(source),event=quotePost(source,'My comment');
 assert.equal(event.kind,1);
 assert.deepEqual(event.tags,[['q',source.id,'',source.pubkey],['p',source.pubkey]]);
 assert.deepEqual(buildContentTags(event.content,event.tags),event.tags);
 const reference=event.content.split('\n\n').at(-1);assert(reference.startsWith('nostr:nevent1'));
 assert.deepEqual(nip19.decode(reference.slice(6)).data,{id:source.id,author:source.pubkey,kind:1,relays:[]});
 assert.deepEqual(quoteIds(event.content,event.tags),[source.id]);
 assert.equal(quoteDisplayContent(event.content,quoteIds(event.content,event.tags)),'My comment');
 assert(!event.tags.some(t=>t[0]==='e'||t[0]==='a'));assert(makeReplyTags(source).some(t=>t[0]==='e'));
 assert.equal(JSON.stringify(source),original);
 const other=nip19.noteEncode('e'.repeat(64));assert.deepEqual(quoteIds(quotePost(source,`Another nostr:${other}`).content,quotePost(source,`Another nostr:${other}`).tags),[source.id,'e'.repeat(64)]);
 assert.throws(()=>quotePost({...source,kind:6},'comment'));assert.throws(()=>quotePost(source,'  '));assert.throws(()=>quotePost({...source,id:'invalid'},'comment'));
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const key=draftKey(source.pubkey,'quote:'+source.id);
 assert.notEqual(key,draftKey(source.pubkey,source.id));assert.notEqual(key,draftKey(source.pubkey));assert.notEqual(key,draftKey('f'.repeat(64),'quote:'+source.id));
 writeDraft(storage,key,'Unsent');assert.equal(readDraft(storage,key),'Unsent');
 assert(!clearSentDraft(storage,key,'Other draft'));assert.equal(readDraft(storage,key),'Unsent');
 assert(clearSentDraft(storage,key,'Unsent'));assert.equal(readDraft(storage,key),'');
 console.log('PASS quote kind/q/p/nevent, render roundtrip, no inherited reply tags, source priority, isolated saved drafts and conditional cleanup');
}finally{await fs.rm(dir,{recursive:true,force:true})}
