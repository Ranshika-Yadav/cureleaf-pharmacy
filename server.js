'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ROOT=__dirname, DATA=path.join(ROOT,'data'), PUBLIC=path.join(ROOT,'public');
const PORT=Number(process.env.PORT||3000);
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD;
if(!ADMIN_PASSWORD || ADMIN_PASSWORD.length<12){console.error('Set ADMIN_PASSWORD to a unique password of at least 12 characters before starting.');process.exit(1)}
fs.mkdirSync(DATA,{recursive:true});
const sessions=new Map();
const limit=new Map();
function file(name,def=[]){const p=path.join(DATA,name+'.json');if(!fs.existsSync(p))fs.writeFileSync(p,JSON.stringify(def,null,2));return p}
for(const n of ['orders','contacts','subscribers'])file(n);
function read(name){return JSON.parse(fs.readFileSync(file(name),'utf8'))}
function write(name,value){const p=file(name),tmp=p+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(tmp,p)}
function json(res,status,data,extra={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra});res.end(JSON.stringify(data))}
function fail(res,status,error){json(res,status,{error})}
function text(v,max=200){return typeof v==='string'?v.trim().slice(0,max):''}
function email(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)&&v.length<=254}
function cookie(req){const value=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('cureleaf_session='));return value?value.split('=')[1]:''}
function admin(req){const token=cookie(req);const exp=sessions.get(token);if(!exp)return false;if(exp<Date.now()){sessions.delete(token);return false}return true}
function throttle(req,res){const ip=req.socket.remoteAddress||'unknown',now=Date.now();let rec=limit.get(ip);if(!rec||now-rec.start>60000){rec={start:now,count:0};limit.set(ip,rec)}if(++rec.count>120){fail(res,429,'Too many requests');return true}return false}
async function body(req){let bytes=0,chunks=[];for await(const c of req){bytes+=c.length;if(bytes>100000)throw Error('Payload too large');chunks.push(c)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{throw Error('Invalid JSON')}}
function publicProducts(){return read('products').filter(p=>p.active!==false&&p.stock>0)}
async function api(req,res,url){const route=url.pathname,method=req.method;
if(route==='/api/health'&&method==='GET')return json(res,200,{ok:true,service:'cureleaf'});
if(route==='/api/products'&&method==='GET')return json(res,200,{products:publicProducts()});
if(route==='/api/admin/login'&&method==='POST'){
 const b=await body(req),submitted=text(b.password,512);
 const a=crypto.createHash('sha256').update(submitted).digest(),c=crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
 if(!crypto.timingSafeEqual(a,c))return fail(res,401,'Invalid credentials');
 const token=crypto.randomBytes(32).toString('hex');sessions.set(token,Date.now()+8*3600000);
 return json(res,200,{ok:true},{'Set-Cookie':`cureleaf_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.COOKIE_SECURE==='true'?'; Secure':''}`});
}
if(route==='/api/admin/logout'&&method==='POST'){sessions.delete(cookie(req));return json(res,200,{ok:true},{'Set-Cookie':'cureleaf_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'})}
if(route.startsWith('/api/admin/')){
 if(!admin(req))return fail(res,401,'Admin login required');
 if(route==='/api/admin/overview'&&method==='GET')return json(res,200,{orders:read('orders'),contacts:read('contacts'),subscribers:read('subscribers'),products:read('products')});
 if(route==='/api/admin/products'&&method==='PUT'){
  const b=await body(req);if(!Array.isArray(b.products)||b.products.length>200)return fail(res,400,'Invalid catalog');
  const old=read('products');const updated=[];
  for(const p of b.products){const prior=old.find(x=>x.id===Number(p.id));if(!prior)return fail(res,400,'Unknown product');const stock=Number(p.stock),price=Number(p.price);if(!Number.isInteger(stock)||stock<0||stock>100000||!Number.isInteger(price)||price<1||price>1000000)return fail(res,400,'Invalid price or stock');updated.push({...prior,price,stock,active:p.active!==false})}
  if(updated.length!==old.length)return fail(res,400,'Include every product');write('products',updated);return json(res,200,{ok:true});
 }
 const match=route.match(/^\/api\/admin\/orders\/([a-zA-Z0-9-]+)$/);
 if(match&&method==='PATCH'){
  const b=await body(req),statuses=['pending','confirmed','cancelled','fulfilled'];if(!statuses.includes(b.status))return fail(res,400,'Invalid status');
  const orders=read('orders'),o=orders.find(x=>x.id===match[1]);if(!o)return fail(res,404,'Order not found');o.status=b.status;o.updatedAt=new Date().toISOString();write('orders',orders);return json(res,200,{order:o});
 }
 return fail(res,404,'Unknown admin endpoint');
}
if(route==='/api/orders'&&method==='POST'){
 const b=await body(req),customer=text(b.customer,100),mail=text(b.email,254),postcode=text(b.postcode,6);
 if(customer.length<2||!email(mail)||!/^\d{6}$/.test(postcode)||!Array.isArray(b.items)||!b.items.length||b.items.length>30)return fail(res,400,'Invalid customer details or cart');
 const products=read('products'),merged=new Map();for(const x of b.items){const id=Number(x.id),qty=Number(x.quantity);if(!Number.isInteger(id)||!Number.isInteger(qty)||qty<1||qty>20)return fail(res,400,'Invalid quantity');merged.set(id,(merged.get(id)||0)+qty)}
 let total=0,lines=[];for(const [id,quantity] of merged){const p=products.find(x=>x.id===id&&x.active!==false);if(!p||quantity>p.stock)return fail(res,409,'An item is unavailable or exceeds stock');lines.push({id,name:p.name,quantity,unitPrice:p.price,lineTotal:p.price*quantity});total+=p.price*quantity}
 const order={id:'CL-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(3).toString('hex').toUpperCase(),customer,email:mail,postcode,items:lines,total,status:'pending',paymentStatus:'not_collected',createdAt:new Date().toISOString()};
 const orders=read('orders');orders.unshift(order);write('orders',orders);return json(res,201,{order});
}
if(route==='/api/contact'&&method==='POST'){
 const b=await body(req),record={id:crypto.randomUUID(),name:text(b.name||b.fullName||b.customer,100),email:text(b.email,254),message:text(b.message||b.note||b.enquiry,2000),createdAt:new Date().toISOString()};
 if(!record.name||!email(record.email)||!record.message)return fail(res,400,'Name, email and message required');const contacts=read('contacts');contacts.unshift(record);write('contacts',contacts);return json(res,201,{ok:true});
}
if(route==='/api/newsletter'&&method==='POST'){
 const b=await body(req),mail=text(b.email,254).toLowerCase();if(!email(mail))return fail(res,400,'Valid email required');const subs=read('subscribers');if(!subs.some(s=>s.email===mail)){subs.unshift({email:mail,createdAt:new Date().toISOString()});write('subscribers',subs)}return json(res,201,{ok:true});
}
return fail(res,404,'Not found');
}
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{try{
 if(throttle(req,res))return;
 const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/'))return await api(req,res,url);
 if(req.method!=='GET')return fail(res,405,'Method not allowed');
 const requested=url.pathname==='/'?'/index.html':url.pathname;
 const full=path.resolve(PUBLIC,'.'+decodeURIComponent(requested));if(!full.startsWith(PUBLIC+path.sep))return fail(res,403,'Forbidden');
 fs.readFile(full,(err,content)=>{if(err)return fail(res,404,'Page not found');res.writeHead(200,{'Content-Type':types[path.extname(full)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Content-Security-Policy':"frame-ancestors 'none'"});res.end(content)})
}catch(err){console.error(err);fail(res,err.message==='Payload too large'?413:400,err.message||'Bad request')}});
server.listen(PORT,()=>console.log(`Cureleaf running at http://localhost:${PORT} | Admin: http://localhost:${PORT}/admin.html`));
