"use strict";
window.WTSNotificationConfigReady=(async()=>{
  const runtime=window.WTS_NOTIFICATION_RUNTIME_CONFIG;
  if(runtime?.supabaseUrl&&runtime?.publishableKey){
    return Object.freeze({
      supabaseUrl:runtime.supabaseUrl,
      publishableKey:runtime.publishableKey,
      storageKey:runtime.storageKey||"wts_notification_admin_connection",
      environment:runtime.environment||"development"
    });
  }
  const response=await fetch("./notification-config.json",{cache:"no-store"});
  if(!response.ok)throw new Error("Notification runtime configuration is unavailable.");
  const config=await response.json();
  if(!config?.supabaseUrl||!config?.publishableKey)throw new Error("Notification runtime configuration is incomplete.");
  return Object.freeze({
    supabaseUrl:config.supabaseUrl,
    publishableKey:config.publishableKey,
    storageKey:config.storageKey||"wts_notification_admin_connection",
    environment:config.environment||"development"
  });
})();

document.addEventListener("DOMContentLoaded",function(){
  const requested=new URLSearchParams(window.location.search).get("view");
  const allowed=["contacts","templates","messages","providers","settings","attempts"];
  if(!allowed.includes(requested))return;
  for(const button of document.querySelectorAll(".nav-item")){
    if(button.dataset.view===requested){button.click();break;}
  }
});
