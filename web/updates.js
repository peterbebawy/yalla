// Reload web updates only when doing so will not interrupt a ride or a draft.
(() => {
  let installedVersion=null, pendingVersion=null, checking=false, announced=false;
  function safeToReload() {
    if(document.hidden || document.querySelector('dialog[open]')) return false;
    if(typeof state!=='undefined' && state?.trips?.some(t=>['searching','accepted','arrived','in_progress'].includes(t.status)))return false;
    if(typeof booking!=='undefined' && (booking.pickup||booking.destination||booking.note))return false;
    const inputs=[...document.querySelectorAll('input,textarea')];
    return !inputs.some(el=>el.value!==el.defaultValue && el.value!=='');
  }
  async function checkUpdate() {
    if(checking || document.hidden || (typeof demo!=='undefined' && demo))return;
    checking=true;
    try {
      const base=window.YALLA_CONFIG?.apiBase || '';
      const response=await fetch(base+'/api/version',{cache:'no-store',signal:AbortSignal.timeout(8000)});
      if(!response.ok)return;
      const data=await response.json();
      if(typeof data.version!=='string' || !/^[a-f0-9]{64}$/.test(data.version))return;
      if(installedVersion===null)installedVersion=data.version;
      else if(data.version!==installedVersion)pendingVersion=data.version;
      else pendingVersion=null;
      if(pendingVersion){
        if(safeToReload())window.location.reload();
        else if(!announced && typeof toast==='function'){
          announced=true;toast('في تحديث جديد؛ هيتحمّل بعد انتهاء المشوار أو لما تفتح التطبيق من جديد.');
        }
      }
    } catch(_) { /* Offline or a previous server version: retain the working page. */ }
    finally { checking=false; }
  }
  checkUpdate();
  setInterval(checkUpdate,60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkUpdate();});
})();
