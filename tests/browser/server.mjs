import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
const server=await createServer({configFile:false,plugins:[react()],server:{host:'127.0.0.1',port:4174,strictPort:true}});await server.listen();console.log('QA http://127.0.0.1:4174/tests/browser/notification-feed.html');
