'use client';

import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {M3eIconButton} from '@m3e/react/icon-button';
import {M3eButton} from '@m3e/react/button';
import {M3eFormField} from '@m3e/react/form-field';
import {MessageCircle, X} from 'lucide-react';
import './inline-reply.css';
import {useLocalDraft} from './local-draft';

export interface InlineReplyProps {
  noteId: string;
  instanceId?: string;
  name: string;
  busy: boolean;
  /** Return true only after relay acceptance. False keeps the draft open. */
  onSend: (text: string) => Promise<boolean>;
  onCancel: () => void;
}

export default function InlineReply({noteId, instanceId=noteId, name, busy, onSend, onCancel}: InlineReplyProps) {
  const localDraft=useLocalDraft(instanceId);
  const text=localDraft.text,setText=localDraft.setText;
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const callback = useRef(onCancel);
  callback.current = onCancel;

  useEffect(() => {
    mounted.current = true;
    input.current?.focus({preventScroll: true});
    return () => { mounted.current = false; clearTimeout(closeTimer.current); };
  }, []);

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 192)}px`;
  }, [text]);

  useEffect(() => {
    const element=input.current;
    if(!element || typeof ResizeObserver==='undefined')return;
    let lastWidth=element.clientWidth;
    let frame=0;
    const observer=new ResizeObserver(()=>{
      if(element.clientWidth===lastWidth)return;
      lastWidth=element.clientWidth;
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        element.style.height='auto';
        element.style.height=String(Math.min(element.scrollHeight,192))+'px';
      });
    });
    observer.observe(element);
    return ()=>{observer.disconnect();cancelAnimationFrame(frame);};
  }, []);

  function close() {
    if (closing) return;
    setClosing(true);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    closeTimer.current = setTimeout(() => callback.current(), reduced ? 0 : 150);
  }

  async function send() {
    const value = text.trim();
    if (!value || busy || locked.current || closing) return;
    locked.current = true;
    setSending(true);
    setError('');
    try {
      const accepted = await onSend(value);
      if (accepted) localDraft.accepted(text);
      if (!mounted.current) return;
      if (accepted) close();
      else setError('送信できませんでした。下書きは残っています。');
    } catch {
      if (mounted.current) setError('送信できませんでした。もう一度お試しください。');
    } finally {
      locked.current = false;
      if (mounted.current) setSending(false);
    }
  }

  const disabled = busy || sending || closing;
  return <div className={`inline-reply${closing ? ' is-closing' : ''}`} data-note-id={noteId}>
    <div className="inline-reply-clip">
      <div className="inline-reply-reveal">
        <form className="inline-reply-form" aria-label={`${name}への返信`} aria-busy={sending} onSubmit={event => {event.preventDefault(); void send();}}>
          <M3eFormField className="inline-reply-field" variant="outlined" hideSubscript="always">
          <MessageCircle slot="prefix" className="inline-reply-leading" aria-hidden="true" size={24}/>
          <textarea ref={input} id={`reply-${instanceId}`} className="inline-reply-input" aria-label={`${name}への返信`} placeholder="返信する…" rows={1} maxLength={4000} value={text} aria-describedby={error?`reply-error-${instanceId}`:undefined} readOnly={disabled} onChange={event => {setText(event.target.value); setError('');}} onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.repeat) return;
            if (event.key === 'Escape' && !disabled) { event.preventDefault(); event.stopPropagation(); close(); }
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); }
          }}/>
          <div slot="suffix" className="inline-reply-controls">
            <M3eIconButton type="button" className="inline-reply-cancel" variant="standard" aria-label="返信を閉じる" disabled={disabled} onClick={close}><X size={20}/></M3eIconButton>

          </div>
          </M3eFormField>
          <M3eButton type="button" className="inline-reply-send" variant="filled" aria-label={sending ? '返信を送信中' : '返信を送信'} disabled={disabled || !text.trim()} onClick={() => void send()}>{sending ? '送信中' : '送信'}</M3eButton>
        </form>
        {!localDraft.saved&&<p className="draft-status">保存できません。閉じる前にコピーしてください</p>}
        {text&&<button type="button" className="draft-clear" disabled={disabled} onClick={()=>setText('')}>下書きを消去</button>}
        {error && <div id={`reply-error-${instanceId}`} className="inline-reply-error" role="alert">{error}</div>}
      </div>
    </div>
  </div>;
}
