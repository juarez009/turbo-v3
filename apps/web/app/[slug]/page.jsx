import {notFound} from 'next/navigation';
import Image from 'next/image';
import Checkout from '../components/Checkout';
import ListingTools from '../components/ListingTools';
import {base,anon} from '../../lib/api.mjs';
export const dynamic='force-dynamic';
export default async function Listing({params}){
 const {slug}=await params;
 if(!/^[a-zA-Z0-9_-]{12,64}$/.test(slug))notFound();
 if(!base||!anon)return <main className="narrow"><h1>Estamos preparando los apartados.</h1><p>Este comercio todavía no está disponible. Volvé a consultar el enlace más tarde.</p></main>;
 let r;try{r=await fetch(`${base}/functions/v1/listings?slug=${encodeURIComponent(slug)}`,{headers:{apikey:anon},cache:'no-store',signal:AbortSignal.timeout(8000)})}catch{return <main className="narrow"><h1>No pudimos cargar el artículo.</h1><p>Revisá tu conexión y volvé a intentar.</p></main>}
 if(r.status===404)notFound();if(!r.ok)return <main className="narrow"><h1>El artículo no está disponible en este momento.</h1></main>;
 const l=await r.json();
 return <main className="product"><ListingTools listing={l}/><section className="photo-panel">{l.imageUrl?<Image className="product-photo" src={l.imageUrl} alt={l.label} width={800} height={1000} sizes="(max-width: 720px) 100vw, 50vw" quality={75} preload/>:<div className="photo-missing">La foto no está disponible.</div>}<span className="photo-caption">Retiro con tu comerciante · Sin envío a domicilio</span></section><section className="product-info"><span className="eyebrow">{l.merchant}</span><h1>{l.label}</h1><p className="price">${(l.price/100).toFixed(2)} <span>precio total</span></p><div className="receipt"><div><span>Seña para apartar</span><strong>${(l.deposit/100).toFixed(2)}</strong></div><div><span>Saldo al retirar</span><strong>${((l.price-l.deposit)/100).toFixed(2)}</strong></div></div><div className="pickup"><b>Tu punto de retiro</b><p>{l.pickupPoint}</p><small>Tenés 24 horas desde la confirmación del apartado.</small></div><Checkout listing={l}/></section></main>;
}
