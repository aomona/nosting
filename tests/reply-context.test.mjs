import fs from 'node:fs/promises';import ts from 'typescript';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
await fs.mkdir('.sites-runtime',{recursive:true});const dir=await fs.mkdtemp(resolve('.sites-runtime/reply-context-test-'));
try{
 for(const name of ['thread-replies','reply-context']){let source=await fs.readFile(`lib/${name}.ts`,'utf8');source=source.replace("'./thread-replies'","'./thread-replies.mjs'");await fs.writeFile(`${dir}/${name}.mjs`,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText)}
 const {replyTarget,replyExcerpt}=await import(pathToFileURL(dir+'/reply-context.mjs'));
 const root='1'.repeat(64),parent='2'.repeat(64),self='3'.repeat(64),author='4'.repeat(64),base={id:self,kind:1,tags:[]};
 assert.equal(replyTarget(base),null);
 assert.deepEqual(replyTarget({...base,tags:[['e',root,'','root']]}),{id:root});
 assert.deepEqual(replyTarget({...base,tags:[['e',parent,'','reply'],['e',root,'','root'],['p',author]]}),{id:parent});
 assert.deepEqual(replyTarget({...base,tags:[['e',root],['e',author],['e',parent]]}),{id:parent});
 for(const tags of [[['p',author]],[['q',parent]],[['e',parent,'','mention']],[['e',root,'','mention'],['e',parent]]])assert.equal(replyTarget({...base,tags}),null);
 assert.deepEqual(replyTarget({...base,tags:[['e',parent,'','reply'],['e',root,'','reply']]}),{id:null});
 assert.deepEqual(replyTarget({...base,tags:[['e','bad','','root']]}),{id:null});
 assert.deepEqual(replyTarget({...base,tags:[['e',self,'','reply']]}),{id:null});
 assert.deepEqual(replyTarget({...base,tags:[['e',root,'','root'],['e','bad','','reply']]}),{id:null});
 assert.deepEqual(replyTarget({...base,tags:[['e',parent,'','reply'],['e','bad','','reply']]}),{id:null});
 assert.equal(replyTarget({...base,kind:6,tags:[['e',parent]]}),null);
 assert.equal(replyExcerpt({content:'  hello\n  world  ',tags:[]}), 'hello world');
 assert.equal(replyExcerpt({content:'SECRET',tags:[['content-warning','reason']]}),'センシティブな投稿');
 assert.equal(replyExcerpt({content:'\n',tags:[]}), '本文のない投稿');
 assert.equal(replyExcerpt({content:'a'.repeat(1000),tags:[]}).length,180);
 const component=await fs.readFile('components/reply-context.tsx','utf8');
 assert.match(component,/<span className="reply-context-label" role="img" aria-label="返信"><CornerUpLeft size=\{16\} aria-hidden="true"\/><\/span>/);
 assert.match(component,/IntersectionObserver/);assert.match(component,/current=false/);assert.match(component,/setSettled\(null\)/);assert.match(component,/isMuted\(event\)/);assert.match(component,/再試行/);assert.doesNotMatch(component,/new WebSocket|signEvent|publish\(/);
 const app=await fs.readFile('components/petal-app.tsx','utf8');assert.match(app,/<ReplyContext event=\{n\}>/);assert.match(app,/<ReplyPreview\/>/);assert.match(app,/<\/a><\/div><ReplyRecipient\/>/);
 console.log('PASS reply context: immediate marked parent, root-only, legacy, no p/q/mention guessing, ambiguous/self invalid, sensitive/empty/long excerpts, lazy resolution, retry and no signing');
}finally{await fs.rm(dir,{recursive:true,force:true})}
