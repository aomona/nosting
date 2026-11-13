import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const notifications=await fs.readFile('components/notification-feed.css','utf8');
assert(!/--m3e-(?:sys-)?color-/.test(notifications));
assert(notifications.includes('background:var(--md-sys-color-surface-container);color:var(--md-sys-color-on-surface)'));
for(const file of await fs.readdir('components'))if(file.endsWith('.css'))assert(!/--m3e-(?:sys-)?color-/.test(await fs.readFile('components/'+file,'utf8')),`Invalid theme color namespace in ${file}`);
const app=await fs.readFile('components/petal-app.tsx','utf8');assert(app.includes('if(!themeReady)return;'));assert(app.includes("try{localStorage.setItem('petal-dark'"));
console.log('PASS correct M3E color token namespace, explicit notification foreground/background, guarded theme persistence');
