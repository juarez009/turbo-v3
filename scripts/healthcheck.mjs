// Read-only probe for a VPS/systemd timer or external monitor; sends no alerts itself.
import {settings} from '../supabase/functions/_shared/adapters.mjs';
const config=settings(name=>process.env[name]);
let ready=false,sessionReady=false;
try{
 const r=await fetch(`${config.OPENWA_BASE_URL}/api/health/ready`,{redirect:'error',signal:AbortSignal.timeout(5000)});ready=r.ok;
 const s=await fetch(`${config.OPENWA_BASE_URL}/api/sessions/${encodeURIComponent(config.OPENWA_SESSION_ID)}`,{headers:{'X-API-Key':config.OPENWA_API_KEY},redirect:'error',signal:AbortSignal.timeout(5000)});
 sessionReady=s.ok&&(await s.json()).status==='ready';
}catch{}
console.log(JSON.stringify({channelReady:ready&&sessionReady,checkedAt:new Date().toISOString()}));
process.exitCode=ready&&sessionReady?0:1;
