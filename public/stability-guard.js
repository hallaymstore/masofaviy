(()=>{
  const NativeMO = window.MutationObserver;
  if (!NativeMO) return;
  window.MutationObserver = class SafeMutationObserver extends NativeMO {
    constructor(callback){
      super((mutations, observer)=>{
        const filtered = mutations.filter(m=>{
          const t = m.target;
          if (!t) return true;
          if (t.id === 'sideNav' || t.id === 'bottomNav') return false;
          if (t.closest && t.closest('#sideNav,#bottomNav')) return false;
          return true;
        });
        if (filtered.length) callback(filtered, observer);
      });
    }
  };
})();
