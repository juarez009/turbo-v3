'use client';
import {useState} from 'react';
import {auth} from '../../lib/auth.mjs';
export default function AccountBar(){const [busy,setBusy]=useState(false);return <button className="text-link" disabled={busy} onClick={async()=>{setBusy(true);try{await auth().auth.signOut()}finally{setBusy(false)}}}>Cerrar sesión</button>}
