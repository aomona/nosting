'use client';
import {ChevronDown} from 'lucide-react';

export default function MuteValue({value, label, identifier = false}: {value: string; label: string; identifier?: boolean}) {
 return <div className="mute-value"><span className="mute-kind">{label}</span>{identifier ? <details className="mute-identifier"><summary aria-label={`${label} ${value} の全文を表示`}><span>{value.slice(0, 10)}…{value.slice(-8)}</span><ChevronDown size={16} aria-hidden="true"/></summary><code>{value}</code></details> : <span className="mute-text">{value}</span>}</div>;
}
