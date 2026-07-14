"use strict";
(function(){
  function build(shared){
    window.WTSNotificationConfig=Object.freeze({
      supabaseUrl:shared.supabaseUrl||"",
      publishableKey:shared.publishableKey||"",
      storageKey:"wts_notification_control_admin_session",
      sessionTimeoutMs:20*60*1000,
      environment:shared.environment||"development"
    });
    return window.WTSNotificationConfig;
  }
  if(window.WTSRegistryConfig){
    window.WTSNotificationConfigReady=Promise.resolve(build(window.WTSRegistryConfig));
    return;
  }
  window.WTSNotificationConfigReady=new Promise(function(resolve,reject){
    var script=document.createElement("script");
    script.src="../central-registry/config.js";
    script.onload=function(){resolve(build(window.WTSRegistryConfig||{}));};
    script.onerror=function(){reject(new Error("Shared browser configuration could not be loaded."));};
    document.head.appendChild(script);
  });
})();
