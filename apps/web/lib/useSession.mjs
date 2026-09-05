'use client';
import {useEffect,useState} from 'react';
import {auth} from './auth.mjs';
export function useSession(){
 const [session,setSession]=useState(null);
 useEffect(()=>{let subscription;let active=true;try{const client=auth();client.auth.getSession().then(({data})=>{if(active)setSession(data.session)});subscription=client.auth.onAuthStateChange((_event,value)=>setSession(value)).data.subscription;}catch{}return()=>{active=false;subscription?.unsubscribe()}},[]);
 return [session,setSession];
}
