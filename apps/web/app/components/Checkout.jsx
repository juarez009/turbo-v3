'use client';
import {useState,useCallback,useEffect} from 'react';
import SignIn from './SignIn';
import AccountBar from './AccountBar';
import {useSession} from '../../lib/useSession.mjs';
import {api} from '../../lib/api.mjs';
export default function Checkout({listing}){
 const [session,onSession]=useSession();
 const [account,setAccount]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[terms,setTerms]=useState(false),[method,setMethod]=useState('deposit'),[link,setLink]=useState(null);
 const loadAccount=useCallback(async()=>{if(!session)return;try{setAccount(await api('account',{token:session.access_token}));setError('')}catch(e){setError(e.message)}},[session]);
 useEffect(()=>{setAccount(null);setLink(null);loadAccount()},[loadAccount]);
 async function connect(){setBusy(true);try{const data=await api('account',{method:'POST',token:session.access_token,body:{}});setLink(data.url)}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function reserve(){setBusy(true);setError('');try{
   // Stable across reloads and method-specific; never regenerate on a timeout.
   const storageKey=`apartaya:checkout:${session.user.id}:${listing.slug}:${method}`;
   let key=sessionStorage.getItem(storageKey);if(!key){key=crypto.randomUUID();sessionStorage.setItem(storageKey,key)}
   const data=await api('orders',{method:'POST',token:session.access_token,key,body:{slug:listing.slug,method,acceptTerms:terms}});
   window.location.assign(`/pedidos/${data.id}`);
 }catch(e){setError(e.message)}finally{setBusy(false)}}
 if(listing.status!=='available')return <div className="notice"><h2>{listing.status==='sold'?'Este artículo ya se vendió':'Este artículo está apartado'}</h2><p>Pedile a tu comerciante otro enlace o consultá más tarde.</p></div>;
 if(!session)return <><SignIn onSession={onSession}/>{!listing.paymentsEnabled&&<p className="notice">Los pagos de este comercio todavía no están habilitados.</p>}</>;
 return <section className="form"><AccountBar/><h2>Completá tu apartado</h2>{!account?<button onClick={loadAccount}>Cargar mi cuenta</button>:!account.linked?<><p>Vinculá este mismo número con WhatsApp para recibir el código de retiro.</p>{link?<a className="button" href={link} target="_blank" rel="noreferrer">Abrir WhatsApp y enviar mensaje ↗</a>:<button disabled={busy} onClick={connect}>Vincular WhatsApp</button>}<button className="secondary" onClick={loadAccount}>Ya envié el mensaje</button></>:<><p className="verified">✓ Tu número está verificado y vinculado.</p>{account.codEligible&&<label>Cómo querés apartar<select value={method} onChange={e=>setMethod(e.target.value)}><option value="deposit">Pagar seña</option><option value="cod">Contraentrega autorizada</option></select></label>}<label className="check"><input type="checkbox" checked={terms} onChange={e=>setTerms(e.target.checked)}/><span>Leí las <a href="/condiciones" target="_blank">condiciones del piloto</a>. Retiraré en el plazo de 24 horas después de la confirmación.</span></label><button disabled={busy||!terms||(method==='deposit'&&!listing.paymentsEnabled)} onClick={reserve}>{busy?'Preparando tu apartado…':method==='cod'?'Apartar sin seña':`Apartar con $${(listing.deposit/100).toFixed(2)}`}</button>{!listing.paymentsEnabled&&method==='deposit'&&<p>Los pagos todavía no están habilitados.</p>}</>}{error&&<p className="error" role="alert">{error}</p>}</section>;
}
