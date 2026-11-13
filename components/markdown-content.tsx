'use client';
import {memo} from 'react';
import {compileMarkdown} from '../lib/compiled-markdown';
import './markdown-content.css';
const MarkdownContent=memo(function MarkdownContent({content,tags}:{content:string;tags:string[][]}){
 return <div className="petal-markdown">{compileMarkdown(content,tags).body}</div>;
});
export default MarkdownContent;
