import {env} from 'cloudflare:workers';
import {handleMedia} from '../../../../lib/upload-server';
type Context={params:Promise<{key:string}>};
export async function GET(request:Request,context:Context){return handleMedia(request,(await context.params).key,env)}
export async function HEAD(request:Request,context:Context){return handleMedia(request,(await context.params).key,env)}
