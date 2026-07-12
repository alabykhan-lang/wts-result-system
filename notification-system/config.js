"use strict";
window.WTSNotificationConfigReady=(async()=>{
  const runtime=window.WTS_NOTIFICATION_RUNTIME_CONFIG;
  if(runtime?.supabaseUrl&&runtime?.publishableKey){
    return Object.freeze({supabaseUrl:runtime.supabaseUrl,publishableKey:runtime.publishableKey,storageKey:runtime.storageKey||"wts_notification_admin_connection"});
  }
  try{
    const response=await fetch("./notification-config.json",{cache:"no-store"});
    if(response.ok){
      const config=await response.json();
      if(config?.supabaseUrl&&config?.publishableKey){
        return Object.freeze({supabaseUrl:config.supabaseUrl,publishableKey:config.publishableKey,storageKey:config.storageKey||"wts_notification_admin_connection"});
      }
    }
  }catch{}
  const legacy=await fetch("../attendance-dashboard/app.js",{cache:"no-store"});
  if(!legacy.ok)throw new Error("Notification runtime configuration is unavailable.");
  const source=await legacy.text();
  const url=source.match(/const SUPABASE_URL = "([^"]+)"/);
  const key=source.match(/const PUBLISHABLE_KEY = "([^"]+)"/);
  if(!url||!key)throw new Error("Notification runtime configuration is incomplete.");
  return Object.freeze({supabaseUrl:url[1],publishableKey:key[1],storageKey:"wts_notification_admin_connection"});
})();