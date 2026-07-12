"use strict";
(() => {
  const cfg=window.WTSRegistryConfig;
  const key=cfg.storageKey;
  let timer=null,lastWrite=0;
  function parse(raw){try{const v=JSON.parse(raw||"null");return v?.adminCode&&v?.adminSecret?v:null;}catch{return null;}}
  function get(){const v=parse(sessionStorage.getItem(key));if(!v)return null;if(!v.expiresAt||v.expiresAt<=Date.now()){sessionStorage.removeItem(key);window.dispatchEvent(new CustomEvent("wts-registry-session-expired"));return null;}return v;}
  function set(adminCode,adminSecret){const now=Date.now();const v={adminCode:String(adminCode||"").trim(),adminSecret:String(adminSecret||""),issuedAt:now,lastActivityAt:now,expiresAt:now+cfg.sessionTimeoutMs};sessionStorage.setItem(key,JSON.stringify(v));schedule();render();return v;}
  function refresh(force=false){const v=get();if(!v)return false;const now=Date.now();if(!force&&now-lastWrite<60000)return true;v.lastActivityAt=now;v.expiresAt=now+cfg.sessionTimeoutMs;sessionStorage.setItem(key,JSON.stringify(v));lastWrite=now;schedule();render();return true;}
  function clear(reload=false){sessionStorage.removeItem(key);clearTimeout(timer);render();if(reload)location.reload();}
  function mask(code){const v=String(code||"Administrator");return v.length<10?v:`${v.slice(0,5)}••••${v.slice(-4)}`;}
  function render(){const v=get();const bar=document.querySelector("#sessionBar");const identity=document.querySelector("#sessionIdentity");const connect=document.querySelector("#connectButton");const dot=document.querySelector("#connectionDot");const state=document.querySelector("#connectionState");if(bar)bar.classList.toggle("hidden",!v);if(identity&&v)identity.textContent=`Signed in: ${mask(v.adminCode)}`;if(connect)connect.textContent=v?"Manage session":"Administrator login";if(dot)dot.classList.toggle("online",!!v);if(state)state.textContent=v?"Registry connected":"Not connected";}
  function schedule(){clearTimeout(timer);const v=get();if(!v)return;timer=setTimeout(()=>{if(!get()){render();window.dispatchEvent(new CustomEvent("wts-registry-session-expired"));}},Math.max(1000,v.expiresAt-Date.now()+100));}
  ["pointerdown","keydown","touchstart","scroll"].forEach(name=>addEventListener(name,()=>refresh(false),{passive:true}));
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"){get();render();schedule();}});
  document.addEventListener("DOMContentLoaded",()=>{render();schedule();document.querySelector("#signOutButton")?.addEventListener("click",()=>clear(true));});
  window.WTSRegistrySession=Object.freeze({get,set,refresh:()=>refresh(true),clear});
})();
