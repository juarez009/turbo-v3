'use client';
import {useEffect} from 'react';
export default function ListingTools({listing}){
 useEffect(()=>{
  const context=document.modelContext;if(!context?.registerTool)return;
  const lifetime=new AbortController();
  Promise.resolve(context.registerTool({name:'read_apartaya_listing',description:'Read the displayed article price, deposit, pickup location and availability. Does not create an order or charge a payment.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute(input){if(!input||Object.keys(input).length)throw new Error('No arguments expected');return {slug:listing.slug,priceCents:listing.price,depositCents:listing.deposit,status:listing.status,pickupPoint:listing.pickupPoint};}},{signal:lifetime.signal})).catch(()=>{});
  return()=>lifetime.abort();
 },[listing]);return null;
}
