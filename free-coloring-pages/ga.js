/* Visitor counts for Free Coloring Pages (Google Analytics G-E9C00BTERY), with a cookie choice.
   Visitors in Europe (EU, EEA, UK, Switzerland; detected by the browser's time zone) see a bar and
   Analytics loads only after they tap OK. Everyone else gets Analytics unless their browser sends
   Global Privacy Control or they chose "No thanks" under Cookie choices in the footer.
   The choice is kept in localStorage as fcp.consent = "yes" | "no". */
(function(){
  if(location.hostname==='popcornlove.net'||location.hostname==='www.popcornlove.net'){location.replace('https://makeacoloringbook.com'+(location.pathname.replace(/^\/free-coloring-pages/,'')||'/')+location.search+location.hash);return}
  var GA_ID='G-E9C00BTERY',KEY='fcp.consent',loaded=false;
  window.dataLayer=window.dataLayer||[];
  window.gtag=function(){dataLayer.push(arguments)};
  window.track=function(name,params){try{if(loaded)gtag('event',name,params||{})}catch(e){}};
  function get(){try{return localStorage.getItem(KEY)}catch(e){return null}}
  function put(v){try{localStorage.setItem(KEY,v)}catch(e){}}
  var tz='';try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||''}catch(e){}
  var europe=/^Europe\//.test(tz)||/^Atlantic\/(Canary|Madeira|Azores|Reykjavik|Faroe|Faeroe)$/.test(tz)||tz==='Arctic/Longyearbyen';
  var gpc=navigator.globalPrivacyControl===true;
  function load(){
    if(loaded)return;loaded=true;window['ga-disable-'+GA_ID]=false;
    var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id='+GA_ID;document.head.appendChild(s);
    gtag('js',new Date());gtag('config',GA_ID,{allow_google_signals:false,allow_ad_personalization_signals:false});
  }
  function root(){var m=document.querySelector('link[rel="stylesheet"][href$="site.css"],link[rel="stylesheet"][href$="fonts.css"]');return m?m.getAttribute('href').replace(/(site|fonts)\.css$/,''):'/'}
  var bar=null;
  function hide(){if(bar){bar.remove();bar=null}}
  function show(){
    if(bar)return;
    if(!document.getElementById('ckStyle')){var st=document.createElement('style');st.id='ckStyle';st.textContent='#ckBar{position:fixed;left:12px;right:12px;bottom:12px;z-index:97;max-width:720px;margin:0 auto;background:#FFFFFF;color:#1D1B2F;border:2.5px solid #1D1B2F;border-radius:16px;box-shadow:4px 4px 0 #1D1B2F;padding:14px 16px;display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;font:700 14.5px/1.4 Nunito,system-ui,sans-serif}#ckBar p{flex:1 1 300px;margin:0}#ckBar a{color:#1D1B2F}#ckBar .ckB{display:flex;gap:8px}#ckBar button{font:700 15px/1 Fredoka,"Trebuchet MS",sans-serif;padding:11px 16px;border:2.5px solid #1D1B2F;border-radius:12px;background:#fff;color:#1D1B2F;cursor:pointer}#ckBar button.ok{background:#F25C3B;color:#fff}';document.head.appendChild(st)}
    bar=document.createElement('div');bar.id='ckBar';bar.setAttribute('role','dialog');bar.setAttribute('aria-label','Cookie choice');
    bar.innerHTML='<p>We use Google Analytics cookies to count visits, so we know which coloring pages people like. No ads, and nothing is sold. <a href="'+root()+'privacy/">Privacy</a></p><div class="ckB"><button type="button" class="no">No thanks</button><button type="button" class="ok">OK</button></div>';
    bar.querySelector('.ok').onclick=function(){put('yes');hide();load()};
    bar.querySelector('.no').onclick=function(){put('no');hide();window['ga-disable-'+GA_ID]=true};
    document.body.appendChild(bar);
  }
  document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('[data-cookie-choices]');if(a){e.preventDefault();hide();show()}});
  var c=get();
  if(c==='yes')load();
  else if(c==='no'){}
  else if(europe){if(document.body)show();else document.addEventListener('DOMContentLoaded',show)}
  else if(!gpc)load();
})();
