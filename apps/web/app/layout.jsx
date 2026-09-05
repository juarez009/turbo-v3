import './style.css';
export const metadata={title:'ApartaYa · Tu artículo, apartado',description:'Apartá y retirá con tu comerciante en El Salvador.',manifest:'/manifest.webmanifest'};
export const viewport={width:'device-width',initialScale:1,themeColor:'#124bdb'};
export default function Layout({children}) {
  return <html lang="es-SV"><body><header><a className="brand" href="/">aparta<span>ya</span><span className="brand-dot">●</span></a><span className="location">Hecho para comprar cerca · El Salvador</span></header>{children}<footer>Un enlace. Tu apartado. Tu comercio de siempre. <a href="/condiciones">Condiciones del piloto</a></footer><script src="/register-sw.js" defer /></body></html>;
}
