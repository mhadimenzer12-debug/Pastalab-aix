// Cloudflare Worker — déploiement après configuration KV, Mollie et e-mail.
const ORIGIN='https://pastalab-aix.com';
const BASE={bolognaise:[1250,1290],carbonara:[1250,1350],gorgonzola:[1290,1350],pesto:[1290,1350],arrabbiata:[1150,1290],truffe:[1490,1550]};
const EXTRAS={parmesan:200,burrata:350,boeuf:250,poulet:250,parme:350,'truffe-fraiche':390};
const LABELS={bolognaise:'Bolognaise',carbonara:'Carbonara',gorgonzola:'Gorgonzola',pesto:'Pesto tomates cerises & pignons',arrabbiata:'Arrabbiata',truffe:'Crème de truffe'};
const cors={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'POST,GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Content-Type':'application/json'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:cors});
const cents=n=>(n/100).toFixed(2);
async function mollie(id,env){const r=await fetch('https://api.mollie.com/v2/payments/'+encodeURIComponent(id),{headers:{Authorization:'Bearer '+env.MOLLIE_API_KEY}});if(!r.ok)throw Error('Mollie '+r.status);return r.json()}
async function sendEmail(env,to,subject,body){
 const r=await fetch('https://api.resend.com/emails',{
  method:'POST',
  headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
  body:JSON.stringify({from:env.MAIL_FROM,to:[to],subject,text:body})
 });
 if(!r.ok)throw Error('Échec e-mail '+r.status+' : '+(await r.text()).slice(0,250));
}
async function notify(order,env){
 if(!env.RESEND_API_KEY||!env.MAIL_FROM)throw Error('E-mail non configuré');
 const lines=order.items.map(x=>`${x.qty} × ${x.label} — ${cents(x.amount*x.qty)} €`).join('\n');
 const merchantBody=`Commande payée ${order.orderId}\n\n${lines}\n\nTotal : ${cents(order.total)} €\nMode : ${order.delivery}\nNom : ${order.customer.name}\nTéléphone : ${order.customer.phone}\nE-mail : ${order.customer.email}\nAdresse : ${order.customer.address}\nNote : ${order.customer.notes}`;
 await sendEmail(env,'mm.pastalab@gmail.com','Commande Pasta Lab payée — '+order.orderId,merchantBody);
 const customerBody=`Bonjour ${order.customer.name},\n\nMerci pour votre commande chez Pasta Lab !\nVotre paiement a bien été confirmé.\n\nCommande : ${order.orderId}\n\n${lines}\n\nTotal payé : ${cents(order.total)} €\nMode : ${order.delivery==='retrait'?'Retrait sur place':'Livraison'}\n\nÀ très bientôt,\nL’équipe Pasta Lab`;
 // Le mail marchand est déjà parti : ne pas bloquer la confirmation du paiement si le mail client échoue.
 try {await sendEmail(env,order.customer.email,'Confirmation de votre commande Pasta Lab — '+order.orderId,customerBody)}
 catch(e){console.error('Échec confirmation client',order.orderId,String(e))}
}
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(request.method==='GET'&&url.pathname==='/')return json({ok:true,service:'Pasta Lab'});
 if(!env.MOLLIE_API_KEY||!env.ORDERS)return json({error:'Configuration serveur incomplète'},503);
 if(request.method==='POST'&&url.pathname==='/create-payment'){
  if(request.headers.get('Origin')!==ORIGIN)return json({error:'Origine non autorisée'},403);
  let body;try{body=await request.json()}catch{return json({error:'Données invalides'},400)}
  const cart=body.cart;if(!Array.isArray(cart)||cart.length<1||cart.length>50)return json({error:'Panier invalide'},400);
  let subtotal=0;const items=[];
  const DRINKS={coca:['Coca-Cola',250],'coca-zero':['Coca-Cola Zéro',250],oasis:['Oasis Tropical',250],ice_tea:['Ice Tea Pêche',250],cristalline:['Cristalline 50 cl',150],redbull:['Red Bull',350],san_pellegrino:['San Pellegrino 50 cl',250],limonata:['Limonata',300],aranciata:['Aranciata',300],chinotto:['Chinotto',350]};
  const DESSERTS={tiramisu:['Tiramisu',490],panna_cotta:['Panna cotta',450],moelleux:['Moelleux au chocolat',450],mousse:['Mousse au chocolat',590]};
  const FORMULAS={pause:['La Pause Italienne',1390,1,1,0],dolce:['La Dolce Vita',1890,1,1,1],due:['In Due',2790,2,2,0],famiglia:['La Famiglia',4590,4,0,0],grande:['La Grande Famiglia',5490,4,4,0]};
  const SURCHARGE={arrabbiata:0,bolognaise:0,carbonara:0,gorgonzola:100,pesto:100,truffe:300};
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const validPlate=p=>p&&typeof p==='object'&&own(BASE,p.recipe)&&['pates','gnocchis'].includes(p.base)&&(p.base==='gnocchis'?p.pasta===null:['rigatoni','tagliatelles'].includes(p.pasta));
  for(const x of cart){
   if(!x||typeof x!=='object'||!Number.isInteger(x.qty)||x.qty<1||x.qty>20)return json({error:'Quantité invalide'},400);
   let unit,label;
   if(x.type==='plat'){
    if(!validPlate(x)||!Array.isArray(x.extras)||x.extras.length>6||new Set(x.extras).size!==x.extras.length||x.extras.some(e=>!own(EXTRAS,e)))return json({error:'Plat invalide'},400);
    unit=BASE[x.recipe][x.base==='pates'?0:1]+x.extras.reduce((n,e)=>n+EXTRAS[e],0);
    label=LABELS[x.recipe]+' — '+(x.pasta||'Gnocchis')+(x.extras.length?' + '+x.extras.join(', '):'');
   }else if(x.type==='boisson'){
    if(!own(DRINKS,x.id))return json({error:'Boisson invalide'},400);
    [label,unit]=DRINKS[x.id];
   }else if(x.type==='dessert'){
    if(!own(DESSERTS,x.id))return json({error:'Dessert invalide'},400);
    [label,unit]=DESSERTS[x.id];
   }else if(x.type==='formule'){
    if(!own(FORMULAS,x.id))return json({error:'Formule invalide'},400);
    const [name,basePrice,np,nd,ns]=FORMULAS[x.id];
    if(!Array.isArray(x.plates)||x.plates.length!==np||x.plates.some(p=>!validPlate(p))||!Array.isArray(x.drinks)||x.drinks.length!==nd||x.drinks.some(id=>!own(DRINKS,id))||!Array.isArray(x.desserts)||x.desserts.length!==ns||x.desserts.some(id=>!own(DESSERTS,id)))return json({error:'Composition de formule invalide'},400);
    unit=basePrice+x.plates.reduce((n,p)=>n+SURCHARGE[p.recipe]+(p.base==='gnocchis'?100:0),0);
    label=name+' : '+x.plates.map(p=>LABELS[p.recipe]+' '+(p.pasta||'gnocchis')).join(', ')+(nd?' • '+x.drinks.map(id=>DRINKS[id][0]).join(', '):'')+(ns?' • '+x.desserts.map(id=>DESSERTS[id][0]).join(', '):'');
   }else return json({error:'Article inconnu'},400);
   subtotal+=unit*x.qty;items.push({qty:x.qty,amount:unit,label});
  }
  if(subtotal<1||subtotal>200000)return json({error:'Montant de commande invalide'},400);
  const delivery=body.delivery||'retrait';const rules={'retrait':[0,0],'0-5':[2000,390],'5-8':[3000,590],'8-12':[4000,790]};if(!(delivery in rules))return json({error:'Zone invalide'},400);if(subtotal<rules[delivery][0])return json({error:'Minimum de commande non atteint pour cette zone'},400);
  const fee=delivery==='0-5'&&subtotal>=4500?0:rules[delivery][1];const total=subtotal+fee;
  const raw=body.customer||{};const customer={name:String(raw.name||'').trim().slice(0,80),phone:String(raw.phone||'').trim().slice(0,40),email:String(raw.email||'').trim().slice(0,120),address:String(raw.address||'').trim().slice(0,180),notes:String(raw.notes||'').trim().slice(0,300)};
  if(!customer.name||!customer.phone||!/^\S+@\S+\.\S+$/.test(customer.email)||(delivery!=='retrait'&&!customer.address))return json({error:'Coordonnées incomplètes'},400);
  const orderId='PL-'+crypto.randomUUID();const order={orderId,items,customer,delivery,subtotal,fee,total,status:'pending',notified:false,createdAt:new Date().toISOString()};
  const payload={amount:{currency:'EUR',value:cents(total)},description:'PASTA LAB '+orderId,redirectUrl:`${ORIGIN}/?paiement=retour&commande=${encodeURIComponent(orderId)}`,webhookUrl:`${url.origin}/mollie-webhook`,metadata:{orderId}};
  try{const r=await fetch('https://api.mollie.com/v2/payments',{method:'POST',headers:{Authorization:'Bearer '+env.MOLLIE_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await r.json();if(!r.ok||!result.id||!result._links?.checkout?.href)return json({error:'Impossible de créer le paiement'},502);order.paymentId=result.id;await env.ORDERS.put('payment:'+result.id,JSON.stringify(order));return json({ok:true,orderId,total:cents(total),checkoutUrl:result._links.checkout.href})}catch{return json({error:'Service de paiement temporairement indisponible'},502)}
 }
 if(request.method==='POST'&&url.pathname==='/mollie-webhook'){
  const form=await request.formData().catch(()=>null);const id=form?.get('id');if(typeof id!=='string'||!/^tr_[a-zA-Z0-9]+$/.test(id))return new Response('invalid',{status:400});
  const stored=await env.ORDERS.get('payment:'+id);if(!stored)return new Response('unknown',{status:404});const order=JSON.parse(stored);
  try{const payment=await mollie(id,env);if(payment.id!==id||payment.metadata?.orderId!==order.orderId||payment.amount?.currency!=='EUR'||payment.amount?.value!==cents(order.total))return new Response('mismatch',{status:400});
   if(payment.status!=='paid'){order.status=payment.status;await env.ORDERS.put('payment:'+id,JSON.stringify(order));return new Response('ok')}
   order.status='paid';await env.ORDERS.put('payment:'+id,JSON.stringify(order));
   // KV is eventually consistent: for stronger exactly-once guarantees use Durable Objects / a queue.
   if(!order.notified){await notify(order,env);order.notified=true;await env.ORDERS.put('payment:'+id,JSON.stringify(order))}
   return new Response('ok');
  }catch(e){console.error('Webhook failure',String(e));return new Response('retry',{status:500})}
 }
 return json({error:'Route inconnue'},404);
}};
