// Entirely local demonstration. No real WhatsApp, Supabase or payment requests.
import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {hash,newCode,encryptCode,botCopy} from '../supabase/functions/_shared/commerce.mjs';
const db=new PGlite();
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
 for(const file of (await readdir('supabase/migrations')).sort())await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
 const rpc=async(name,args=[]) => (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0]?.result;
 let serial=0;const dialogue=[];
 async function message(text,type='text',image=null,price=null,codeHash=null){
  const {id}=await rpc('accept_message',[JSON.stringify({sessionId:'DEMO',messageId:String(++serial),chatId:'50370000000@c.us',type,text})]);
  const claim=await rpc('claim_message',[id]);
  const result=await rpc('process_bot',[id,claim.token,image,price,codeHash]);
  await rpc('finish_message',[id,claim.token,'held',image]);
  dialogue.push({entrada:type==='image'?'[foto ficticia]':text,respuesta:botCopy(result,'https://apartaya.example')});return result;
 }
 await message('Hola');
 const merchant=(await db.query('select id from public.merchants')).rows[0].id;
 await rpc('enable_merchant',[merchant,'Comercio de demostración']);
 await message('PUNTO');await message('Puesto ficticio 10, Mercado Central');
 await message('','image',`${merchant}/demo.png`);
 const listing=await message('12.50','text',null,1250);
 const buyer=await rpc('buyer_identity',[crypto.randomUUID(),'+50370000001']);
 const linkHash=await hash('DEMO-LINK');await rpc('create_chat_link',[buyer.id,linkHash]);
 await rpc('consume_chat_link',['50370000001@c.us',linkHash]);
 const code=newCode();const codeHash=await hash(code);
 const order=await rpc('reserve_order',[buyer.id,listing.slug,'demo-idempotency-key','deposit',codeHash,await encryptCode(code,'ab'.repeat(32))]);
 await rpc('claim_checkout',[order.id]);await rpc('save_checkout',[order.id,'DEMO-LINK','https://example.invalid/no-real-payment']);
 const payment=await rpc('apply_payment',[order.id,'DEMO-PAYMENT','DEMO-LINK',250,'USD','approved']);
 const duplicate=await rpc('apply_payment',[order.id,'DEMO-PAYMENT','DEMO-LINK',250,'USD','approved']);
 await message(`ENTREGADO ${code}`,'text',null,null,codeHash);
 await message(`ENTREGADO ${code}`,'text',null,null,codeHash);
 await message('VENTAS');
 const report=await rpc('operations_report');
 const artifact={warning:'SIMULACIÓN LOCAL. No hubo mensajes, imágenes subidas ni pagos reales.',paymentStatus:payment.status,duplicateIgnored:duplicate.duplicate,dialogue,metrics:report.metrics,settlement:report.settlement};
 await mkdir('artifacts',{recursive:true});
 await writeFile('artifacts/demo-result.json',JSON.stringify(artifact,null,2));
 await writeFile('artifacts/demo-result.md',`# Demostración local ApartaYa\n\n${artifact.warning}\n\n${dialogue.map(x=>`**Entrada:** ${x.entrada}\n\n${x.respuesta}\n`).join('\n---\n\n')}\nPago simulado: ${payment.status}. Duplicado ignorado: ${duplicate.duplicate}. Entregas: ${report.metrics.delivered}.\n`);
 console.log(JSON.stringify({simulation:true,published:report.metrics.listings,paid:report.metrics.paid,delivered:report.metrics.delivered,duplicateIgnored:duplicate.duplicate,artifact:'artifacts/demo-result.md'},null,2));
}finally{await db.close()}
