// Structural regression only. Client render counts/state/focus are tested in browser QA.
import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const source=await fs.readFile('components/petal-app.tsx','utf8');
assert.match(source,/export const MemoizedNoteList=memo\(NoteList\)/);
assert.match(source,/export function NoteList[\s\S]*?<WindowedFeed items=\{notes\}[\s\S]*?renderItem=\{n=><NoteRow key=\{n\.id\}/);
assert.match(source,/<div className="feed"><MemoizedNoteList notes=\{filtered\}/);
assert.doesNotMatch(source,/filtered\.map\(/);
assert.match(source,/busy=\{busy&&replySet\.has\(n\.id\)\}/);
assert.match(source,/const noteActions=useRef<NoteActions>/);
assert.match(source,/const openQuote=useMemo\(\(\)=>\(n:NostrEvent\)=>noteActions\.current\.openDetail\(n\),\[\]\)/);
assert.match(source,/<QuoteOpenContext\.Provider value=\{openQuote\}>/);
assert.match(source,/const bookmarkSet=useMemo/);assert.match(source,/const likedSet=useMemo/);assert.match(source,/const replySet=useMemo/);assert.match(source,/const filtered=useMemo/);
console.log('PASS source guard: memoized keyed list under unchanged feed wrapper, stable action ref/QuoteOpen callback, memoized list inputs; browser QA required for render/state/focus');
