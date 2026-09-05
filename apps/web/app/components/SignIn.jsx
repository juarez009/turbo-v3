'use client';
import {useState} from 'react';
import {auth} from '../../lib/auth.mjs';
export default function SignIn({onSession,operations=false}){
 const [phone,setPhone]=useState(''),[code,setCode]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState('');
 const [sent,setSent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(e){e.preventDefault();setBusy(true);setError('');try{
  const client=auth(); let result;
  if(operations)result=await client.auth.signInWithPassword({email,password});
  else if(sent)result=await client.auth.verifyOtp({phone:`+503${phone}`,token:code,type:'sms'});
  else {if(!/^\d{8}$/.test(phone))throw new Error('Escribí los ocho dígitos de tu número.');result=await client.auth.signInWithOtp({phone:`+503${phone}`});}
  if(result.error)throw new Error('No pudimos verificar los datos. Revisalos e intentá de nuevo.');
  if(result.data?.session)onSession(result.data.session);else setSent(true);
 }catch(e){setError(e.message)}finally{setBusy(false)}}
 return <form onSubmit={submit} className="form"><h2>{operations?'Ingresá a operaciones':'Verificá tu número'}</h2>{operations?<><label>Correo<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Contraseña<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label></>:sent?<><p>Ingresá el código enviado por SMS a +503 {phone}.</p><label>Código SMS<input autoComplete="one-time-code" inputMode="numeric" required maxLength={10} value={code} onChange={e=>setCode(e.target.value)}/></label><button className="text-link" type="button" onClick={()=>{setSent(false);setCode('')}}>Cambiar número</button></>:<><p>Usá el mismo número que tenés en WhatsApp.</p><label>Tu celular<div className="phone"><span>+503</span><input type="tel" autoComplete="tel-national" inputMode="numeric" required pattern="[0-9]{8}" maxLength={8} placeholder="7000 0000" value={phone} onChange={e=>setPhone(e.target.value.replace(/\D/g,''))}/></div></label></>}{error&&<p role="alert" className="error">{error}</p>}<button disabled={busy}>{busy?'Un momento…':operations?'Ingresar':sent?'Verificar código':'Recibir código por SMS'}</button></form>;
}
