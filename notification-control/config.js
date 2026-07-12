"use strict";
(function(){
  var shared=window.WTSRegistryConfig||{};
  window.WTSNotificationConfig=Object.freeze({
    supabaseUrl:shared.supabaseUrl||"",
    publishableKey:shared.publishableKey||"",
    storageKey:"wts_notification_control_admin_session",
    sessionTimeoutMs:20*60*1000,
    environment:shared.environment||"development"
  });
})();
