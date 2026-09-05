import {createClient} from '@supabase/supabase-js';
import {base,anon} from './api.mjs';
let instance;
export function auth(){if(!base||!anon)throw new Error('El servicio todavía no está configurado.');return instance??=createClient(base,anon,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});}
