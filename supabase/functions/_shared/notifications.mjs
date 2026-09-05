import { noticeCopy } from './commerce.mjs';
export async function drainNotices(config, store, channel) {
  await store.rpc('expire_reserved_orders');
  await store.rpc('daily_summaries');
  if (!config.sendEnabled) return {sent:0,disabled:true};
  const notices = await store.rpc('claim_notices');
  let sent=0;
  for (const notice of notices) {
    let sending=false;
    try {
      const ctx = await store.rpc('notice_context',{p_id:notice.id,p_token:notice.lease_token});
      if(!ctx)continue;
      const text=await noticeCopy(notice,ctx,config.PICKUP_ENCRYPTION_KEY,config.publicOrigin);
      if(!await store.rpc('finish_notice',{p_id:notice.id,p_token:notice.lease_token,p_status:'sending'}))continue;
      sending=true;
      await channel.send(notice.recipient_chat_id,text);
      await store.rpc('finish_notice',{p_id:notice.id,p_token:notice.lease_token,p_status:'sent'});
      sent++;
    } catch {
      await store.rpc('finish_notice',{p_id:notice.id,p_token:notice.lease_token,p_status:sending?'needs_review':'pending'});
    }
  }
  return {sent};
}
