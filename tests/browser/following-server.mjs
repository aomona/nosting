import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../..',import.meta.url));
const server=await createServer({root,configFile:false,resolve:{alias:{'@':root}},plugins:[react()],server:{host:'127.0.0.1',port:4175,strictPort:true}});
await server.listen();console.log('Following QA http://127.0.0.1:4175/tests/browser/following-feed.html');
