'use client';
import {useId} from 'react';
import {M3eButton} from '@m3e/react/button';
import {M3eRichTooltip,M3eRichTooltipAction} from '@m3e/react/tooltip';
import {CircleHelp,Ellipsis,Link2} from 'lucide-react';
import './nip05.css';
export default function Nip05Details({identifier,state,partial=false,iconOnly=false}:{identifier:string;state:'matched'|'unconfirmed'|'checking';partial?:boolean;iconOnly?:boolean}) {
 const id=useId();
 const status=state==='matched'?'公開鍵と一致':state==='checking'?'確認中':'未確認';
 const Icon=state==='matched'&&!partial?Link2:state==='checking'?Ellipsis:CircleHelp;
 const description=state==='matched'?'識別子と公開鍵の対応を確認しました。本人の信頼性を保証するものではありません。':state==='checking'?'識別子と公開鍵の対応を確認しています。':'識別子と公開鍵の対応は未確認です。接続や設定によって確認できない場合があります。';
 return <><button id={id} type="button" className={`nip05-identifier${iconOnly?' nip05-icon-only':''}`} aria-label={`NIP-05: ${identifier}、${status}${partial?'。一部のリレーは未確認です':''}`}>
  {!iconOnly&&<span>{identifier}</span>}<Icon aria-hidden="true"/>
 </button><M3eRichTooltip htmlFor={id} position="below" className="nip05-tooltip"><span slot="subhead">{identifier}</span>{description}{partial&&' 一部のリレーは未確認です。'}<M3eRichTooltipAction slot="actions"><M3eButton variant="text">閉じる</M3eButton></M3eRichTooltipAction></M3eRichTooltip></>;
}
