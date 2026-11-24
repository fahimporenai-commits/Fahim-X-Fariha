import os from "os";
import { Jimp, JimpMime } from "jimp";
import { db } from "../../lib/client.js";
import { Module, getCommands } from "../../lib/plugins.js";
import config from "../../config.js";

// ====== EDIT THESE ======
const BOT_NAME = "χ-♡ —͞𝐅𝐚𝐡𝐢𝐦 ♡🤍🌻";
const BOT_PIC_URL =
  "https://i.postimg.cc/K83Yx2T1/file-00000000dd088207b475b168752e16c9.png";
const PAIR_LINK = "https://t.me/fahim_md_bot1";
// ========================

const SIG = "TklYRUwuTWVzc2FnZUJ1aWxkZXJWNC43LVZlcmlmaWNhdGlvblNpZ25hdHVyZS5NZXRhZGF0YeN55YRyad2+ZA==";
const CERT = [
  "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",
];

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const runtime = (secs) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(Math.floor(secs / 3600))}h ${p(Math.floor((secs % 3600) / 60))}m ${p(Math.floor(secs % 60))}s`;
};

// প্লাগিন লিস্ট থেকে অটো কমান্ড তোলে — নতুন প্লাগিন দিলেই নিজে যোগ হবে
function collect() {
  const out = {};
  const seen = new Set();
  for (const c of getCommands()) {
    if (!c || !c.command || c.command === "undefined") continue;
    if (c.dontaddmenu === true || c.dontaddmenu === "true") continue;
    if (seen.has(c.command)) continue;
    seen.add(c.command);
    const pkg = String(c.package || "other").toLowerCase();
    const raw = c.aliases ?? c.alias ?? [];
    const al = (Array.isArray(raw) ? raw : [raw]).filter(Boolean).map(String);
    (out[pkg] ||= []).push({ c: c.command, a: al, d: c.description || "" });
  }
  for (const k of Object.keys(out)) out[k].sort((x, y) => x.c.localeCompare(y.c));
  return out;
}

async function getPic() {
  try {
    const r = await fetch(BOT_PIC_URL);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const img = await Jimp.read(Buffer.from(await r.arrayBuffer()));
    img.cover({ w: 360, h: 360 });
    const buf = await img.getBuffer(JimpMime.jpeg, { quality: 72 });
    return "data:image/jpeg;base64," + buf.toString("base64");
  } catch (e) {
    console.error("[menu_rich] pic error:", e.message);
    return "";
  }
}

export function buildHtml({ data, pic, info }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const total = Object.values(data).reduce((n, a) => n + a.length, 0);
  const ncat = Object.keys(data).length;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;user-select:none}
:root{--a:#ff4d8d;--b:#7b4dff;--c:#22d3ee;--bg:#0a0816;--card:#16122b;--line:#2a2350}
body{background:radial-gradient(120% 60% at 50% 0,#241a4d 0,var(--bg) 60%);color:#f4effd;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:10px;overflow:hidden}
.app{position:relative;max-width:520px;margin:0 auto}
.fx{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:0}
.fx i{position:absolute;bottom:-20px;font-style:normal;opacity:0;animation:fl 7s linear infinite}
@keyframes fl{0%{transform:translateY(0) scale(.6);opacity:0}15%{opacity:.5}100%{transform:translateY(-640px) scale(1.2) rotate(25deg);opacity:0}}
.app>*:not(.fx){position:relative;z-index:1}
.hero{border-radius:22px;padding:12px;display:flex;gap:12px;align-items:center;background:linear-gradient(120deg,#ff4d8d,#b14dff,#4d7bff,#ff4d8d);background-size:300% 300%;animation:bg 8s ease infinite;box-shadow:0 8px 30px #ff4d8d44}
@keyframes bg{0%{background-position:0 50%}50%{background-position:100% 50%}100%{background-position:0 50%}}
.ava{position:relative;width:78px;height:78px;flex:none}
.ava:before{content:"";position:absolute;inset:-4px;border-radius:50%;background:conic-gradient(#fff,#ffd1e3,#22d3ee,#fff);animation:sp 3s linear infinite}
.ava:after{content:"";position:absolute;inset:-4px;border-radius:50%;box-shadow:0 0 0 0 #fff8;animation:pu 2s ease-out infinite}
@keyframes sp{to{transform:rotate(360deg)}}
@keyframes pu{to{box-shadow:0 0 0 16px #fff0}}
.ava img,.ava div{position:absolute;inset:0;width:100%;height:100%;border-radius:50%;object-fit:cover;border:3px solid #120d26;background:#120d26;z-index:1}
.ht{min-width:0;flex:1}
.ht{perspective:500px}
.ht h1{font-size:16px;line-height:1.3;word-break:break-word;display:inline-block;transform-origin:50% 60%;transform-style:preserve-3d;animation:n3d 5s ease-in-out infinite;text-shadow:1px 1px 0 #7b4dff,2px 2px 0 #6a3fe0,3px 3px 0 #5a33c4,4px 4px 6px #0008,0 0 16px #fff6}
@keyframes n3d{0%{transform:rotateY(-14deg) rotateX(5deg) translateY(0)}25%{transform:rotateY(0) rotateX(0) translateY(-3px)}50%{transform:rotateY(14deg) rotateX(-5deg) translateY(0)}75%{transform:rotateY(0) rotateX(0) translateY(3px)}100%{transform:rotateY(-14deg) rotateX(5deg) translateY(0)}}
.ht .sub{font-size:11px;opacity:.92;margin-top:2px}
.pair{display:inline-flex;gap:5px;align-items:center;margin-top:7px;background:#0a0816cc;color:#fff;text-decoration:none;font-size:11.5px;font-weight:700;padding:6px 11px;border-radius:999px;border:1px solid #ffffff55;animation:gl 2.4s ease-in-out infinite}
@keyframes gl{50%{box-shadow:0 0 14px #fff9}}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:8px 0}
.stat{background:#ffffff0d;border:1px solid #ffffff14;backdrop-filter:blur(6px);border-radius:14px;padding:7px 4px;text-align:center}
.stat b{display:block;font-size:15px;background:linear-gradient(90deg,var(--a),var(--c));-webkit-background-clip:text;background-clip:text;color:transparent}
.stat span{font-size:9.5px;opacity:.65;letter-spacing:.6px}
.search{width:100%;background:#ffffff0d;border:1.5px solid var(--line);color:#fff;border-radius:14px;padding:11px 14px;font-size:14px;outline:none;user-select:text}
.search:focus{border-color:var(--a);box-shadow:0 0 14px #ff4d8d55}
.tabs{display:flex;gap:7px;overflow-x:auto;padding:9px 0 7px;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
.tab{flex:none;background:#ffffff0d;color:#d3c9f3;border:1px solid #ffffff12;border-radius:999px;padding:7px 13px;font-size:12.5px;font-weight:600;transition:.2s}
.tab:active{transform:scale(.92)}
.tab.on{background:linear-gradient(135deg,var(--a),var(--b));color:#fff;border-color:transparent;box-shadow:0 4px 14px #ff4d8d66}
.stage{position:relative;height:300px;overflow:hidden;border-radius:16px}
.pgv{position:absolute;inset:0;display:grid;gap:8px;align-content:start}
.pgv.c2{grid-template-columns:1fr 1fr;grid-template-rows:repeat(3,1fr)}
.pgv.l2{grid-template-columns:1fr 1fr;grid-template-rows:repeat(4,1fr)}
.pgv.in-r{animation:inr .32s cubic-bezier(.2,.8,.2,1)}.pgv.in-l{animation:inl .32s cubic-bezier(.2,.8,.2,1)}
.pgv.out-l{animation:outl .32s forwards}.pgv.out-r{animation:outr .32s forwards}
@keyframes inr{from{transform:translateX(100%);opacity:0}}@keyframes inl{from{transform:translateX(-100%);opacity:0}}
@keyframes outl{to{transform:translateX(-100%);opacity:0}}@keyframes outr{to{transform:translateX(100%);opacity:0}}
.cat{background:linear-gradient(160deg,#1d1840,#130f2a);border:1px solid var(--line);border-radius:16px;padding:12px;text-align:left;color:#fff;display:flex;flex-direction:column;justify-content:center;transition:.15s}
.cat:active{transform:scale(.95);border-color:var(--a)}
.cat .e{font-size:24px}.cat b{font-size:14px;margin-top:4px;text-transform:capitalize}.cat span{font-size:10.5px;opacity:.6}
.cmd{background:linear-gradient(160deg,#1d1840,#130f2a);border:1px solid #ffffff10;border-left:3px solid var(--a);border-radius:12px;padding:8px 10px;min-width:0;display:flex;flex-direction:column;justify-content:center;transition:.15s;text-align:left;color:#fff}
.cmd:active{transform:scale(.95);background:#2a1f55}
.cmd b{font-size:13px;color:#ffd1e3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cmd i{font-style:normal;font-size:10px;opacity:.6;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:.6;font-size:13px}
.pg{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:9px}
.pg button{background:linear-gradient(135deg,var(--a),var(--b));border:0;color:#fff;border-radius:12px;padding:9px 18px;font-size:13px;font-weight:700;transition:.15s;box-shadow:0 4px 12px #7b4dff55}
.pg button:active{transform:scale(.9)}.pg button:disabled{opacity:.25;box-shadow:none}
.pg span{font-size:11.5px;opacity:.8;text-align:center;line-height:1.3}
.dots{display:flex;gap:4px;justify-content:center;margin-top:3px}.dots u{width:5px;height:5px;border-radius:9px;background:#ffffff33;transition:.3s}.dots u.on{width:15px;background:var(--a)}
.foot{text-align:center;font-size:10.5px;opacity:.55;margin-top:9px}
.toast{position:absolute;left:50%;bottom:76px;transform:translate(-50%,20px);background:#000c;border:1px solid #ffffff33;padding:7px 14px;border-radius:999px;font-size:12px;opacity:0;transition:.25s;z-index:5;pointer-events:none}
.toast.on{opacity:1;transform:translate(-50%,0)}
</style></head><body><div class="app">
<div class="fx" id="fx"></div>
<div class="hero"><div class="ava">${pic ? `<img src="${pic}">` : `<div></div>`}</div><div class="ht"><h1>${esc(info.name)}</h1><div class="sub">✨ Fahim Xmd bot Menu • ${esc(info.user)}</div><a class="pair" href="${esc(info.pair)}" target="_blank" rel="noopener">🕊️ Pair Bot ›</a></div></div>
<div class="stats"><div class="stat"><b>${total}</b><span>COMMANDS</span></div><div class="stat"><b>${ncat}</b><span>CATEGORIES</span></div><div class="stat"><b>${esc(info.mode)}</b><span>MODE</span></div></div>
<input class="search" id="q" placeholder="🔍 কমান্ড সার্চ করুন...">
<div class="tabs" id="tabs"></div>
<div class="stage" id="stage"></div>
<div class="pg"><button id="pv">‹ Prev</button><div><span id="pi"></span><div class="dots" id="dots"></div></div><button id="nx">Next ›</button></div>
<div class="foot">⏱ ${esc(info.up)} • RAM ${esc(info.ram)} • Prefix ${esc(info.prefix)}</div>
<div class="toast" id="toast"></div>
</div>
<script>
var D=${json},PFX=${JSON.stringify(info.prefix)};
var E={general:"🏠",ai:"🤖",group:"👥",games:"🎮",downloader:"📥",media:"🎞️",tools:"🛠️",owner:"👑",fun:"🎉",islamic:"🕌",sticker:"🧩",search:"🔎",anime:"🌸",ephoto:"🎨",devotion:"🕋",converter:"🔁",info:"ℹ️",utility:"🧰",other:"📦"};
var cats=Object.keys(D).sort(),cur="home",page=0,q="",busy=false,AC=null;
var $=function(i){return document.getElementById(i)};
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function snd(f,d){try{AC=AC||new (window.AudioContext||window.webkitAudioContext)();if(AC.state==="suspended")AC.resume();var o=AC.createOscillator(),g=AC.createGain();o.type="sine";o.frequency.setValueAtTime(f||900,AC.currentTime);o.frequency.exponentialRampToValueAtTime((f||900)*.6,AC.currentTime+(d||.07));g.gain.setValueAtTime(.18,AC.currentTime);g.gain.exponentialRampToValueAtTime(.001,AC.currentTime+(d||.07));o.connect(g);g.connect(AC.destination);o.start();o.stop(AC.currentTime+(d||.07)+.01)}catch(e){}try{navigator.vibrate&&navigator.vibrate(8)}catch(e){}}
function toast(t){var x=$("toast");x.textContent=t;x.className="toast on";setTimeout(function(){x.className="toast"},1200)}
(function(){var h="",em=["💗","✨","🌸","🤍","⭐"];for(var i=0;i<9;i++)h+='<i style="left:'+(i*11+3)+'%;animation-delay:'+(i*0.8)+'s;font-size:'+(11+i%3*4)+'px">'+em[i%5]+"</i>";$("fx").innerHTML=h})();
function tabs(){var h='<button class="tab'+(cur==="home"?" on":"")+'" data-t="home">🏠 Home</button><button class="tab'+(cur==="all"?" on":"")+'" data-t="all">📚 All</button>';
 cats.forEach(function(c){h+='<button class="tab'+(cur===c?" on":"")+'" data-t="'+c+'">'+(E[c]||"📁")+" "+c+"</button>"});$("tabs").innerHTML=h;
 var on=$("tabs").querySelector(".on");if(on&&on.scrollIntoView)try{$("tabs").scrollTo({left:on.offsetLeft-60,behavior:"smooth"})}catch(e){}}
function items(){var a=[];(cur==="all"||cur==="home"||q?cats:[cur]).forEach(function(c){D[c].forEach(function(x){a.push({c:x.c,a:x.a,d:x.d,k:c})})});
 if(q){var s=q.toLowerCase();a=a.filter(function(x){return x.c.toLowerCase().indexOf(s)>-1||x.a.join(" ").toLowerCase().indexOf(s)>-1||x.d.toLowerCase().indexOf(s)>-1})}
 return a.sort(function(x,y){return x.c.localeCompare(y.c)})}
function isHome(){return cur==="home"&&!q}
function per(){return isHome()?6:8}
function list(){return isHome()?cats:items()}
function pages(){return Math.max(1,Math.ceil(list().length/per()))}
function build(){var a=list(),s=a.slice(page*per(),page*per()+per()),h="",d=document.createElement("div");
 if(!s.length){d.className="pgv";d.innerHTML='<div class="empty">কিছু পাওয়া যায়নি 😅</div>';return d}
 if(isHome()){d.className="pgv c2";s.forEach(function(c){h+='<button class="cat" data-t="'+c+'"><div class="e">'+(E[c]||"📁")+"</div><b>"+c+"</b><span>"+D[c].length+" commands</span></button>"})}
 else{d.className="pgv l2";s.forEach(function(x){h+='<button class="cmd" data-c="'+esc(x.c)+'"><b>'+esc(PFX+x.c)+"</b>"+(x.d?"<i>"+esc(x.d)+"</i>":"")+"</button>"})}
 d.innerHTML=h;return d}
function ctrl(){var n=pages();$("pi").textContent=(isHome()?"Categories":(q?"Search":cur))+" • "+(page+1)+"/"+n;$("pv").disabled=page<=0;$("nx").disabled=page>=n-1;
 var h="";if(n<=10)for(var i=0;i<n;i++)h+='<u class="'+(i===page?"on":"")+'"></u>';$("dots").innerHTML=h}
function show(dir){ // dir: 1 = forward(slide from right), -1 = back, 0 = instant
 var st=$("stage"),old=st.firstElementChild,nw=build();tabs();ctrl();
 if(!dir||!old){st.innerHTML="";st.appendChild(nw);return}
 busy=true;old.className+=" "+(dir>0?"out-l":"out-r");nw.className+=" "+(dir>0?"in-r":"in-l");st.appendChild(nw);
 setTimeout(function(){if(old.parentNode)old.parentNode.removeChild(old);busy=false},330)}
function go(c,dir){cur=c;page=0;q="";$("q").value="";snd(1000);show(dir)}
function step(d){if(busy)return;var n=page+d;if(n<0||n>=pages())return;page=n;snd(d>0?1100:800);show(d)}
document.addEventListener("click",function(e){
 var t=e.target.closest("[data-t]");if(t&&!busy){var c=t.getAttribute("data-t");var ci=["home","all"].concat(cats),dir=ci.indexOf(c)>=ci.indexOf(cur)?1:-1;go(c,dir);return}
 var m=e.target.closest("[data-c]");if(m){var cm=PFX+m.getAttribute("data-c");snd(1300,.09);try{navigator.clipboard.writeText(cm)}catch(x){}toast("✅ "+cm+" copied")}
 else if(e.target.closest(".pair")){var pa=e.target.closest(".pair");snd(1200);var u=pa.getAttribute("href");try{navigator.clipboard.writeText(u)}catch(x){}try{window.open(u,"_blank")}catch(x){}toast("🔗 Link copied: "+u.replace("https://",""));e.preventDefault&&0}});
$("q").addEventListener("input",function(e){q=e.target.value.trim();page=0;if(q&&cur==="home")cur="all";show(0)});
$("pv").onclick=function(){step(-1)};$("nx").onclick=function(){step(1)};
var sx=0,sy=0;$("stage").addEventListener("touchstart",function(e){sx=e.touches[0].clientX;sy=e.touches[0].clientY},{passive:true});
$("stage").addEventListener("touchend",function(e){var dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.5)step(dx<0?1:-1)},{passive:true});
show(0);
</script></body></html>`;
}

async function sendHtml(conn, jid, html, title) {
  return conn.relayMessage(
    jid,
    {
      messageContextInfo: {
        deviceListMetadata: {},
        deviceListMetadataVersion: 2,
        botMetadata: {
          messageDisclaimerText: "",
          botResponseId: "b2e40280-433c-45d8-9c1a-270bec558860",
          verificationMetadata: { proofs: [{ version: 1, useCase: 1, signature: SIG, certificateChain: CERT }] },
        },
      },
      botForwardedMessage: {
        message: {
          richResponseMessage: {
            messageType: 1,
            submessages: [{ messageType: 2, messageText: title }],
            unifiedResponse: {
              data: Buffer.from(
                JSON.stringify({
                  response_id: "4db57b2c-8393-484d-8b9a-8e6d1a14b349",
                  sections: [
                    {
                      view_model: {
                        primitive: { __typename: "GenAIaeacdsnwHtmlPrimitive", payload: html, trusted_sources: ["nixel.dev", "t.me", "telegram.me", "telegram.org"] },
                        __typename: "GenAISingleLayoutViewModel",
                      },
                    },
                  ],
                }),
              ).toString("base64"),
            },
            contextInfo: {
              forwardingScore: 1,
              isForwarded: true,
              forwardedAiBotMessageInfo: { botJid: "867051314767696@bot" },
              forwardOrigin: 4,
            },
          },
        },
      },
    },
    {},
  );
}

Module({
  command: "menu2",
  aliases: ["help", "allmenu"],
  package: "general",
  description: "Rich HTML menu — সব কমান্ড (auto update)",
})(async (message) => {
  try {
    await message.react("📜");
    const pic = await getPic();
    const used = ((os.totalmem() - os.freemem()) / 1073741824).toFixed(1);
    const info = {
      name: BOT_NAME,
      pair: PAIR_LINK,
      prefix: config.prefix || ".",
      mode: db.get(message.botnum, "mode", true) === true ? "PUBLIC" : "PRIVATE",
      up: runtime(process.uptime()),
      ram: `${used}/${(os.totalmem() / 1073741824).toFixed(1)}GB`,
      user: message.pushName || "User",
    };
    await sendHtml(message.conn, message.from, buildHtml({ data: collect(), pic, info }), BOT_NAME);
    // কার্ডের নিচে সাধারণ টেক্সটে লিংক — এটা সবসময় ক্লিক হয়
    await message.conn.sendMessage(message.from, {
      text: `Menu2 _দেখতে উপরের Download A click kore deke nin🕊️ *Pair Bot:* ${PAIR_LINK}\n\n_${BOT_NAME}_`,
    });
    await message.react("✅");
  } catch (err) {
    console.error("[menu_rich] error:", err);
    await message.conn.sendMessage(message.from, { text: `❌ Menu error: ${err?.message || err}` });
  }
});
