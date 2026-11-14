import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const server=await createServer({configFile:false,resolve:{alias:{'@':fileURLToPath(new URL('../../',import.meta.url))}},plugins:[react()],server:{host:'127.0.0.1',port:4175,strictPort:true}});
await server.listen();console.log('DM mock QA http://127.0.0.1:4175/tests/browser/direct-messages.html');
