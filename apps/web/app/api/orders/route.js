// Vercel holds only the anon key and the caller's JWT, never service_role.
export async function POST(request) {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!key)return Response.json({error:'payments_unavailable'},{status:503});
  const token=request.headers.get('authorization');
  if(!token?.startsWith('Bearer '))return Response.json({error:'authentication_required'},{status:401});
  if(Number(request.headers.get('content-length'))>4096)return Response.json({error:'body_too_large'},{status:413});
  const reader=request.body?.getReader();let body='',bytes=0;
  if(reader){const decoder=new TextDecoder();for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>4096){await reader.cancel();return Response.json({error:'body_too_large'},{status:413})}body+=decoder.decode(value,{stream:true})}body+=decoder.decode()}
  try{
    const r=await fetch(`${url}/functions/v1/orders`,{method:'POST',headers:{apikey:key,Authorization:token,'Content-Type':'application/json','Idempotency-Key':request.headers.get('idempotency-key')??''},body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
    return new Response(await r.text(),{status:r.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }catch{return Response.json({error:'temporarily_unavailable'},{status:503})}
}
