import {createRoot} from 'react-dom/client';
import {M3eTheme} from '@m3e/react/theme';
import NoteContent from '../../components/note-content';
import '../../app/globals.css';

// Only synthetic content. The browser runner intercepts all media requests.
window.WebSocket=class{constructor(){throw Error('Relay connections forbidden')}};
window.qa={opened:0};
const url=name=>`https://media.example.test/${name}`;
const content=`画像の前\n${url('landscape.png')}\n${url('portrait.png')}\n\n画像の間\n${url('animation.gif')}\n${url('square.webp')}\n${url('clip.webm')}\n${url('last.png')}\n\n画像の後`;
const tags=[['imeta',`url ${url('portrait.png')}`,'alt 縦長の画像','dim 600x900'],['imeta',`url ${url('landscape.png')}`,'alt 横長の画像','dim 900x600'],['imeta',`url ${url('animation.gif')}`,'m image/gif','alt 動く画像']];
function Post({id,content,tags=[]}){
 return <article id={id} className="note" tabIndex={0} onClick={()=>window.qa.opened++}><div className="avatar">N</div><div className="note-content"><div className="note-head"><b>nost.ing</b><span>@local</span></div><NoteContent content={content} tags={tags}/></div></article>;
}
createRoot(document.getElementById('root')).render(<M3eTheme color="#50633c"><div className="shell"><aside className="left"><div className="logo">nost.ing</div></aside><main><header><h1>ホーム</h1></header><div className="feed"><Post id="mixed" content={content} tags={tags}/><Post id="sensitive" content={content} tags={[...tags,['content-warning','確認用']]}/><Post id="single" content={url('portrait.png')} tags={tags}/><Post id="nested" content={`> ${url('landscape.png')}\n> ${url('portrait.png')}\n\n- ${url('animation.gif')}\n  ${url('square.webp')}`}/></div></main></div></M3eTheme>);
