(()=>{
'use strict';
const paths={
  home:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/>',
  lessons:'<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 7.5h8M8 11.5h8M8 15.5h5"/>',
  subjects:'<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5A2.5 2.5 0 0 1 20 21.5z"/>',
  assignments:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 2.5 2.5L16 9"/>',
  messages:'<path d="M4 5.5h16v11H9l-5 4z"/><path d="M8 10h8M8 13h5"/>',
  attendance:'<circle cx="10" cy="8" r="3"/><path d="M4.5 19c.7-3.1 2.6-4.7 5.5-4.7 1.3 0 2.4.3 3.3.9"/><path d="m15.5 16.5 1.8 1.8 3.2-3.5"/>',
  manage:'<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><path d="M17 14v6M14 17h6"/>',
  schedule:'<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M7 3v4M17 3v4M3.5 9h17"/><path d="M8 13h3M8 16h5"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.7-3.2 2.6-4.8 5.5-4.8s4.8 1.6 5.5 4.8"/><path d="M16 6.5a2.5 2.5 0 0 1 0 5M16 14.3c2.2.3 3.7 1.8 4.3 4.2"/>',
  announcements:'<path d="M5 14h3l7 4V6l-7 4H5z"/><path d="M18 9c1 1 1 5 0 6"/><path d="M8 14l1 5"/>',
  profile:'<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.8 3.1-5.7 7-5.7s6.2 1.9 7 5.7"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
  search:'<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
  bell:'<path d="M6.5 17h11l-1.3-1.8V10a4.2 4.2 0 1 0-8.4 0v5.2z"/><path d="M10 20h4"/>',
  bolt:'<path d="m13 2-8 12h6l-1 8 9-13h-6z"/>',
  signal:'<path d="M5 16v3M10 12v7M15 8v11M20 4v15"/>',
  theme:'<path d="M20 14.5A8 8 0 1 1 9.5 4 6.3 6.3 0 0 0 20 14.5z"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  refresh:'<path d="M19 7v5h-5"/><path d="M18 12a6.5 6.5 0 1 0-1.7 4.4"/>',
  back:'<path d="m14.5 5-7 7 7 7"/><path d="M8 12h11"/>',
  send:'<path d="m3 11 18-8-8 18-2-8z"/><path d="m11 13 5-5"/>',
  teacher:'<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.7-3.2 2.5-4.8 5.5-4.8 1.5 0 2.7.4 3.6 1.1"/><path d="M15 8h6M18 5v6"/>',
  user:'<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.8 3.1-5.7 7-5.7s6.2 1.9 7 5.7"/>',
  mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6"/>',
  'mic-off':'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 10.5 4M12 17v4M9 21h6"/><path d="M4 4l16 16"/>',
  camera:'<rect x="3" y="6" width="14" height="12" rx="2"/><path d="m17 10 4-2v8l-4-2z"/>',
  hand:'<path d="M7 12V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v6c0 4-2.5 7-6.5 7H11c-2.7 0-4.3-1.3-5.5-3L3 14.5A1.5 1.5 0 0 1 5.4 13z"/>',
  screen:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="m14 9 3-3m0 0v3m0-3h-3"/>',
  mute:'<path d="M5 10v4h4l4 4V6l-4 4z"/><path d="m17 9 4 4m0-4-4 4"/>',
  captions:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 10a2.5 2.5 0 1 0 0 4M18 10a2.5 2.5 0 1 0 0 4"/>',
  leave:'<path d="M9 4H5v16h4M13 8l4 4-4 4M8 12h9"/>',
  lock:'<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  play:'<path d="m9 7 8 5-8 5z"/>',
  eye:'<path d="M2.8 12s3.2-5.5 9.2-5.5S21.2 12 21.2 12 18 17.5 12 17.5 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.5"/>',
  heart:'<path d="M20.5 9.5c0 5-8.5 10-8.5 10s-8.5-5-8.5-10A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8.5 2.5z"/>',
  upload:'<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v5h16v-5"/>',
  download:'<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 19h16"/>',
  check:'<path d="m5 12 4 4 10-10"/>',
  live:'<circle cx="12" cy="12" r="3"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4"/>',
  record:'<circle cx="12" cy="12" r="5"/>',
  stop:'<rect x="7" y="7" width="10" height="10" rx="1"/>',
  'hand-wave':'<path d="M8 12V6.5a1.4 1.4 0 0 1 2.8 0V11 4.8a1.4 1.4 0 0 1 2.8 0V11 6a1.4 1.4 0 0 1 2.8 0v6-3a1.4 1.4 0 0 1 2.8 0v5c0 4-2.8 7-7 7H11c-2.5 0-4.4-1.2-5.6-3.2L3.8 15A1.4 1.4 0 0 1 6 13.4z"/><path d="M4 6 2.5 4.5M20 5l1.5-1.5M4 10H2"/>'
};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let ok=true;
try{ok=!!document.createElementNS&&!!window.SVGSVGElement&&!!document.createElementNS('http://www.w3.org/2000/svg','svg').createSVGRect}catch{ok=false}
if(!ok)document.documentElement.classList.add('legacy-icons');
function icon(name,fallback='•',label=''){
  const body=paths[name];
  if(!body)return '<span class="pi pi-fallback"><span class="pi-emoji">'+esc(fallback)+'</span></span>';
  return '<span class="pi"'+(label?' role="img" aria-label="'+esc(label)+'"':' aria-hidden="true"')+'><svg class="pi-svg" viewBox="0 0 24 24" focusable="false" aria-hidden="true">'+body+'</svg><span class="pi-emoji" aria-hidden="true">'+esc(fallback)+'</span></span>';
}
function set(el,name,fallback,label){
  if(!el)return;
  el.innerHTML=icon(name,fallback,label);
  el.dataset.piMounted='1';
}
function mount(root=document){
  const nodes=[];
  if(root?.nodeType===1&&root.matches?.('[data-pi]'))nodes.push(root);
  root?.querySelectorAll?.('[data-pi]').forEach(x=>nodes.push(x));
  nodes.forEach(el=>{if(el.dataset.piMounted==='1')return;set(el,el.dataset.pi,el.dataset.piFallback||'•',el.getAttribute('aria-label')||el.title||'')});
}
window.PIcons={icon,set,mount,supported:ok};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>mount(document));else mount(document);
new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(n=>{if(n.nodeType===1)mount(n)}))).observe(document.documentElement,{childList:true,subtree:true});
})();