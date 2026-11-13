import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'Petal',description:'Nostrクライアント'};
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="ja" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:"try{document.documentElement.dataset.theme=localStorage.getItem('petal-dark')==='true'?'dark':'light'}catch{}"}}/><meta name="referrer" content="no-referrer"/><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Noto+Sans+JP:wght@400;500;600;700&display=swap"/></head><body>{children}</body></html>}
