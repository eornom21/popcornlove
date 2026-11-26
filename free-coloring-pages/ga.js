/* Visitor counts for Free Coloring Pages. Put the Google Analytics ID (G-XXXXXXXXXX) in GA_ID to switch it on. */
(function(){
  var GA_ID='G-E9C00BTERY';
  window.dataLayer=window.dataLayer||[];
  window.gtag=function(){dataLayer.push(arguments)};
  window.track=function(name,params){try{if(GA_ID)gtag('event',name,params||{})}catch(e){}};
  if(!GA_ID)return;
  var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id='+GA_ID;document.head.appendChild(s);
  gtag('js',new Date());gtag('config',GA_ID);
})();
