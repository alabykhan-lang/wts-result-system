"use strict";
(function(){
  var configPromise=window.WTSNotificationConfigReady;
  var timer=null,lastWrite=0;
  function parse(raw){try{var v=JSON.parse(raw||"null");return v&&v.adminCode&&v.adminSecret?v:null;}catch(e){return null;}}
  async function cfg(){return configPromise;}
  async function get(){var c=await cfg();var v=parse(sessionStorage.getItem(c.storageKey));if(!v)return null;if(!v.expiresAt||v.expiresAt<=Date.now()){sessionStorage.removeItem(c.storageKey);window.dispatchEvent(new CustomEvent("wts-notification-session-expired"));render();return null;}return v;}
  async function set(adminCode,adminSecret){var c=await cfg();var now=Date.now();var v={adminCode:String(adminCode||"").trim(),adminSecret:String(adminSecret||""),issuedAt:now,lastActivityAt:now,expiresAt:now+c.sessionTimeoutMs};sessionStorage.setItem(c.storageKey,JSON.stringify(v));schedule();render();return v;}
  async function refresh(force){var c=await cfg();var v=await get();if(!v)return false;var now=Date.now();if(!force&&now-lastWrite<60000)return true;v.lastActivityAt=now;v.expiresAt=now+c.sessionTimeoutMs;sessionStorage.setItem(c.storageKey,JSON.stringify(v));lastWrite=now;schedule();render();return true;}
  async function clear(reload){var c=await cfg();sessionStorage.removeItem(c.storageKey);clearTimeout(timer);render();if(reload)location.reload();}
  function mask(code){var v=String(code||"Administrator");return v.length<10?v:v.slice(0,5)+"••••"+v.slice(-4);}
  async function render(){var v=await get();var bar=document.querySelector("#sessionBar"),identity=document.querySelector("#sessionIdentity"),connect=document.querySelector("#connectButton"),dot=document.querySelector("#connectionDot"),state=document.querySelector("#connectionState");if(bar)bar.classList.toggle("hidden",!v);if(identity&&v)identity.textContent="Signed in: "+mask(v.adminCode);if(connect)connect.textContent=v?"Manage session":"Administrator login";if(dot)dot.classList.toggle("online",!!v);if(state)state.textContent=v?"Notification Control connected":"Not connected";}
  async function schedule(){clearTimeout(timer);var v=await get();if(!v)return;timer=setTimeout(async function(){if(!(await get())){render();window.dispatchEvent(new CustomEvent("wts-notification-session-expired"));}},Math.max(1000,v.expiresAt-Date.now()+100));}
  ["pointerdown","keydown","touchstart","scroll"].forEach(function(name){addEventListener(name,function(){refresh(false);},{passive:true});});
  document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible"){render();schedule();}});
  document.addEventListener("DOMContentLoaded",function(){render();schedule();var b=document.querySelector("#signOutButton");if(b)b.addEventListener("click",function(){clear(true);});});
  window.WTSNotificationSession=Object.freeze({get:get,set:set,refresh:function(){return refresh(true);},clear:clear});
})();
