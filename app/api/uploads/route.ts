import {env} from 'cloudflare:workers';
import {handleUpload} from '../../../lib/upload-server';
export async function POST(request:Request){return handleUpload(request,env)}
