// Loads a built page's IIFE into a fake DOM and exposes its internals for testing.
const fs = require("fs");

function load(file, opts){
  opts = opts || {};
  const h = fs.readFileSync(file, "utf8");
  const m = h.match(/<script>\n\(function\(\)\{[\s\S]*?\n\}\)\(\);\n<\/script>/);
  if (!m) throw new Error("script block not found in " + file);
  let code = m[0].replace(/^<script>/, "").replace(/<\/script>$/, "");
  code = code.replace(/\n\}\)\(\);\s*$/,
    `\nglobal.__T={PORTS:PORTS,LEGS:LEGS,TOTAL_NM:TOTAL_NM,ROUTE_OFF:ROUTE_OFF,ROUTE_TOTAL:ROUTE_TOTAL,
      dr:dr,gcDist:gcDist,pointAt:pointAt,routePoint:routePoint,projectRoute:projectRoute,
      buildTrack:buildTrack,realPoints:realPoints,fmtPos:fmtPos,
      buildHistory:buildHistory,warpSpan:warpSpan,forwardPath:forwardPath,
      draw:drawDynamic,render:render,showPort:showPort,showShip:showShip,clearPort:clearPort,
      setBasemap:setBasemap,zoomBy:zoomBy,applyView:applyView,view:view,fitTo:fitTo,
      stamp:stamp,scheduleSpeed:scheduleSpeed,
      setAis:function(a){ if(typeof ais!=="undefined") ais=a; },
      getShipInfo:function(){ return shipInfo; },
      getShipPos:function(){ return shipPos; }};\n})();`);

  const els = {};
  const store = {};
  const listeners = {};

  function makeDots(){
    let c = [];
    return {
      set innerHTML(v){
        c = [];
        const re = /<circle([^>]*)\/>/g; let mm;
        while ((mm = re.exec(v))){
          const a = {};
          mm[1].replace(/([a-z-]+)="([^"]*)"/g, (_, k, val) => { a[k] = val; });
          c.push({ attrs:a, setAttribute(k,x){this.attrs[k]=x},
                   getAttribute(k){ return this.attrs[k] === undefined ? null : this.attrs[k]; } });
        }
      },
      get innerHTML(){ return this._raw || ""; },
      querySelectorAll(sel){ return sel.includes("data-dot") ? c.filter(x => x.attrs["data-dot"]) : c; },
      _c: () => c
    };
  }
  const portdots = makeDots();
  const fixdots = makeDots();
  els.portdots = portdots;
  els.fixdots = fixdots;

  const mkText = () => ({ attrs:{ "font-size":"142" }, setAttribute(k,v){this.attrs[k]=v},
    getAttribute(k){return this.attrs[k]}, removeAttribute(k){delete this.attrs[k]},
    getComputedTextLength: () => 840 });
  const t1 = mkText(), t2 = mkText();
  const wordmark = { getBBox: () => ({x:0,y:-120,width:1000,height:190}),
    querySelectorAll: () => [t1,t2], attrs:{}, setAttribute(k,v){this.attrs[k]=v} };

  const mk = () => ({ style:{}, innerHTML:"", textContent:"", value:"", attrs:{}, className:"",
    offsetWidth:200, offsetHeight:110,
    setAttribute(k,v){this.attrs[k]=v}, getAttribute(k){return this.attrs[k]},
    addEventListener(t,fn){ listeners[t] = listeners[t] || []; listeners[t].push(fn); this["on"+t]=fn; },
    appendChild(){}, select(){}, querySelectorAll:()=>[],
    classList:{ c:new Set(), add(x){this.c.add(x)}, remove(x){this.c.delete(x)},
                contains(x){return this.c.has(x)} },
    getBoundingClientRect: () => ({ width:opts.w||380, height:opts.h||340, left:0, top:0 }) });

  // Some runtimes already own these names. Deno, for one, defines localStorage and
  // navigator as accessors whose setter quietly discards the assignment, so a plain
  // `global.x = stub` leaves the real implementation in place and the page under
  // test talks to it instead of to us. That failure is silent and looks like a bug
  // in the page. Define the property outright so the stub always wins.
  function setGlobal(name, value){
    Object.defineProperty(global, name, { value, writable:true, configurable:true, enumerable:true });
  }

  setGlobal("document", { getElementById: id => els[id] || (els[id] = mk()),
    createElement: mk, querySelectorAll: () => [],
    querySelector: s => s === ".wordmark" ? wordmark : null,
    fonts:null, hidden:false, addEventListener(t,fn){ listeners[t]=listeners[t]||[]; listeners[t].push(fn); } });
  setGlobal("window", { addEventListener(){} });
  setGlobal("localStorage", opts.noStorage
    ? { getItem(){ throw new Error("blocked"); }, setItem(){ throw new Error("blocked"); } }
    : { getItem: k => store[k] || null, setItem: (k,v) => { store[k] = v; } });
  setGlobal("navigator", {});
  setGlobal("setInterval", () => {});
  setGlobal("setTimeout", () => {});
  setGlobal("fetch", opts.fetch);
  setGlobal("location", { protocol: opts.protocol || "https:", href: "https://example.test/" });

  eval(code);
  const T = global.__T;
  return { T, els, store, listeners, html:h,
           click(attr, val){
             const svg = els.map;
             const target = { getAttribute: k => k === attr ? val : null, parentNode: svg };
             (listeners.click || []).forEach(fn => fn({ target }));
           } };
}

module.exports = { load };
