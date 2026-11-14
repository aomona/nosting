'use client';
import {createContext,useContext,type ReactNode} from 'react';
import type {NoteMedia} from '../lib/note-media';

// Cached Markdown holds only media data. Each mounted note owns its controls/state.
export const InlineMediaContext=createContext<((items:NoteMedia[])=>ReactNode)|null>(null);
export function InlineMedia({items}:{items:NoteMedia[]}){
 const render=useContext(InlineMediaContext);
 return render?.(items)??null;
}
