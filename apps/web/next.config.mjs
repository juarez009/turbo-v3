import {fileURLToPath} from 'node:url';
const storageUrl=process.env.NEXT_PUBLIC_SUPABASE_URL?new URL(process.env.NEXT_PUBLIC_SUPABASE_URL):null;
const nextConfig = {
  turbopack:{root:fileURLToPath(new URL('.',import.meta.url))},
  poweredByHeader:false,
  images:{remotePatterns:storageUrl?[{protocol:storageUrl.protocol.slice(0,-1),hostname:storageUrl.hostname,port:storageUrl.port,pathname:'/storage/v1/object/sign/merchant-photos/**'}]:[],
    formats:['image/webp'],maximumRedirects:0,deviceSizes:[480,640,768,1024,1280],qualities:[75]},
  async headers() { return [{source:'/:path*',headers:[
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
    {key:'X-Frame-Options',value:'DENY'},
    {key:'Content-Security-Policy',value:"frame-ancestors 'none'; object-src 'none'; base-uri 'self'"},
    {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'},
  ]}]; },
};
export default nextConfig;
