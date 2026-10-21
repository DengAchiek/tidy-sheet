import {Container,getContainer} from '@cloudflare/containers';
interface GatewayEnv{PYTHON_CLEANER:DurableObjectNamespace<PythonCleaner>;CLEANING_API_TOKEN:string;}
export class PythonCleaner extends Container<GatewayEnv>{
  defaultPort=8080;
  sleepAfter='1m';
  enableInternet=false;
  envVars={CLEANING_API_TOKEN:this.env.CLEANING_API_TOKEN};
}
async function matches(a:string,b:string){
  const encode=new TextEncoder(),[x,y]=await Promise.all([crypto.subtle.digest('SHA-256',encode.encode(a)),crypto.subtle.digest('SHA-256',encode.encode(b))]);
  const left=new Uint8Array(x),right=new Uint8Array(y);let difference=0;for(let i=0;i<left.length;i++)difference|=left[i]^right[i];return difference===0;
}
export default{
  async fetch(request:Request,env:GatewayEnv){
    const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
    if(!env.CLEANING_API_TOKEN||env.CLEANING_API_TOKEN.length<32)return Response.json({message:'Cleaning service not configured.'},{status:503,headers});
    if(!await matches(request.headers.get('Authorization')||'','Bearer '+env.CLEANING_API_TOKEN))return Response.json({message:'Unauthorized.'},{status:401,headers});
    const path=new URL(request.url).pathname;
    if(!((path==='/clean'&&request.method==='POST')||(path==='/health'&&request.method==='GET')))return Response.json({message:'Not found.'},{status:404,headers});
    const length=request.headers.get('Content-Length');if(length&&Number(length)>6*1024*1024)return Response.json({message:'Request too large.'},{status:413,headers});
    try{
      // Two bounded, independently sleeping instances. Python admits one job per instance.
      const name='cleaning-'+(crypto.getRandomValues(new Uint8Array(1))[0]%2);
      return await getContainer(env.PYTHON_CLEANER,name).fetch(request);
    }catch{return Response.json({message:'Cleaning service is starting or busy. Try again shortly.'},{status:503,headers});}
  }
};
