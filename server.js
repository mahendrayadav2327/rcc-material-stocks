const express=require('express'),path=require('path'),Database=require('better-sqlite3'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),fs=require('fs');
const app=express(),PORT=process.env.PORT||3000,SECRET=process.env.JWT_SECRET||'CHANGE_THIS_SECRET_IN_PRODUCTION';
const db=new Database(process.env.DB_FILE||path.join(__dirname,'rcc_stocks.db')); db.pragma('journal_mode=WAL');
app.use(express.json({limit:'5mb'})); app.use(express.static(path.join(__dirname,'public')));
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE,password TEXT,role TEXT DEFAULT 'user',permissions TEXT DEFAULT '{}',active INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,model TEXT DEFAULT '',unit TEXT DEFAULT 'Nos',min_stock REAL DEFAULT 0,active INTEGER DEFAULT 1,UNIQUE(name,model));CREATE TABLE IF NOT EXISTS sites(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,active INTEGER DEFAULT 1);CREATE TABLE IF NOT EXISTS suppliers(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,active INTEGER DEFAULT 1);CREATE TABLE IF NOT EXISTS employees(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,file_id TEXT,department TEXT,site TEXT,active INTEGER DEFAULT 1);CREATE TABLE IF NOT EXISTS departments(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE);CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY AUTOINCREMENT,item_id INTEGER,site_id INTEGER,type TEXT,qty REAL,ref TEXT,by_user TEXT,received_by TEXT,model TEXT,notes TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,user TEXT,action TEXT,ref TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE IF NOT EXISTS stock_alerts(id INTEGER PRIMARY KEY AUTOINCREMENT,site_id INTEGER NOT NULL,item_id INTEGER NOT NULL,min_qty REAL NOT NULL DEFAULT 0,active INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(site_id,item_id));`);
for(const col of [['transactions','condition_status',"TEXT DEFAULT 'New'"],['transactions','transaction_date','TEXT'],['transactions','from_site_id','INTEGER'],['transactions','to_site_id','INTEGER'],['transactions','source_name','TEXT']]){try{db.exec(`ALTER TABLE ${col[0]} ADD COLUMN ${col[1]} ${col[2]}`)}catch(e){}}
db.prepare("UPDATE transactions SET transaction_date=COALESCE(transaction_date,created_at) WHERE transaction_date IS NULL").run();
if(!db.prepare('SELECT 1 FROM users LIMIT 1').get())db.prepare('INSERT INTO users(username,password,role,permissions) VALUES(?,?,?,?)').run('admin',bcrypt.hashSync('Admin@123',10),'admin',JSON.stringify({all:true}));
function auth(req,res,next){try{const token=(req.headers.authorization||'').replace('Bearer ','');req.user=jwt.verify(token,SECRET);next()}catch(e){return res.status(401).json({error:'Session expired. Please login again.'})}}
function admin(req,res,next){if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});next()}
function userPerm(req,key){return req.user.role==='admin'||req.user.permissions?.all===true||req.user.permissions?.[key]===true}
function assignedSites(req){
  if(req.user.role==='admin'||req.user.permissions?.all===true)return null;
  return Array.isArray(req.user.permissions?.sites)?req.user.permissions.sites.map(Number).filter(Boolean):[];
}
function canSite(req,siteId){const a=assignedSites(req);return a===null||a.includes(Number(siteId))}
function requirePerm(key){return (req,res,next)=>{if(!userPerm(req,key))return res.status(403).json({error:'Access not permitted for this user'});next()}}
function siteFilter(req, alias='site_id'){
  const a=assignedSites(req);
  if(a===null)return {sql:'',args:[]};
  if(!a.length)return {sql:' AND 1=0',args:[]};
  return {sql:` AND ${alias} IN (${a.map(()=>'?').join(',')})`,args:a};
}
function audit(u,a,r=''){db.prepare('INSERT INTO audit(user,action,ref) VALUES(?,?,?)').run(u,a,r)}
function balance(item,site){
  // Normal stock movements are calculated only from the selected site's rows.
  const normal=db.prepare(`SELECT COALESCE(SUM(CASE
    WHEN type IN ('receive','available') AND site_id=? THEN qty
    WHEN type IN ('issue','damage','return_out') AND site_id=? THEN -qty
    WHEN type='return_in' AND site_id=? THEN qty
    ELSE 0 END),0) b
    FROM transactions
    WHERE item_id=? AND type NOT IN ('transfer_in','transfer_out')`).get(site,site,site,item).b;

  // A transfer is ONE movement with one reference. The database stores an OUT
  // row and an IN row, but stock calculation must count that reference once:
  // source = -qty, destination = +qty. This also prevents duplicate pair rows
  // from adding the quantity twice.
  const transfers=db.prepare(`SELECT COALESCE(SUM(CASE
    WHEN from_site_id=? AND to_site_id<>? THEN -qty
    WHEN to_site_id=? AND from_site_id<>? THEN qty
    ELSE 0 END),0) b
    FROM (
      SELECT ref,item_id,
             MAX(qty) qty,
             MAX(from_site_id) from_site_id,
             MAX(to_site_id) to_site_id
      FROM transactions
      WHERE item_id=?
        AND type IN ('transfer_in','transfer_out')
        AND ref LIKE 'TRANSFER-%'
        AND from_site_id IS NOT NULL
        AND to_site_id IS NOT NULL
        AND from_site_id<>to_site_id
      GROUP BY ref,item_id
    )`).get(site,site,site,site,item).b;

  // Intentionally ignore malformed/legacy transfer rows without a valid
  // TRANSFER-* reference and distinct source/destination. They cannot be
  // safely assigned to a site without risking another double-count.
  return Number(normal)+Number(transfers);
}

function ensureItem(id){return db.prepare('SELECT * FROM items WHERE id=? AND active=1').get(Number(id))}
app.get('/api/health',(q,r)=>r.json({ok:true,version:'V11.1',database:'SQLite',time:new Date().toISOString()}));
app.post('/api/login',(q,r)=>{const u=db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(q.body.username||'').trim());if(!u||!bcrypt.compareSync(q.body.password||'',u.password))return r.status(401).json({error:'Invalid username or password'});const token=jwt.sign({id:u.id,username:u.username,role:u.role,permissions:JSON.parse(u.permissions||'{}')},SECRET,{expiresIn:'12h'});audit(u.username,'Login');r.json({token,user:{id:u.id,username:u.username,role:u.role,permissions:JSON.parse(u.permissions||'{}')}})});
app.get('/api/items',auth,(q,r)=>r.json(db.prepare('SELECT * FROM items WHERE active=1 ORDER BY name,model').all()));
app.post('/api/items',auth,admin,(q,r)=>{try{const x=q.body;if(!x.name)return r.status(400).json({error:'Item name required'});const info=db.prepare('INSERT INTO items(name,model,unit,min_stock) VALUES(?,?,?,?)').run(x.name.trim(),x.model||'',x.unit||'Nos',0);audit(q.user.username,'Create Item',String(info.lastInsertRowid));r.json({ok:true,id:info.lastInsertRowid})}catch(e){r.status(400).json({error:'Material already exists or invalid data'})}});
app.patch('/api/items/:id',auth,admin,(q,r)=>{try{const id=Number(q.params.id),x=q.body,name=String(x.name||'').trim(),model=String(x.model||'').trim(),unit=String(x.unit||'Nos');if(!id||!name)return r.status(400).json({error:'Material name required'});const row=db.prepare('SELECT * FROM items WHERE id=?').get(id);if(!row)return r.status(404).json({error:'Material not found'});db.prepare('UPDATE items SET name=?,model=?,unit=? WHERE id=?').run(name,model,unit,id);audit(q.user.username,'Edit Item',String(id));r.json({ok:true})}catch(e){r.status(400).json({error:'Material already exists or invalid data'})}});
app.delete('/api/items/:id',auth,admin,(q,r)=>{try{const id=Number(q.params.id),row=db.prepare('SELECT * FROM items WHERE id=?').get(id);if(!row)return r.status(404).json({error:'Material not found'});const used=db.prepare('SELECT COUNT(*) c FROM transactions WHERE item_id=?').get(id).c;if(used){db.prepare('UPDATE items SET active=0 WHERE id=?').run(id)}else{db.prepare('DELETE FROM items WHERE id=?').run(id)}db.prepare('UPDATE stock_alerts SET active=0 WHERE item_id=?').run(id);audit(q.user.username,'Delete Item',String(id));r.json({ok:true,inactivated:Boolean(used)})}catch(e){r.status(400).json({error:'Could not delete material'})}});
app.get('/api/sites',auth,(q,r)=>{
  const a=assignedSites(q);
  if(a===null)return r.json(db.prepare('SELECT * FROM sites WHERE active=1 ORDER BY name').all());
  if(!a.length)return r.json([]);
  return r.json(db.prepare(`SELECT * FROM sites WHERE active=1 AND id IN (${a.map(()=>'?').join(',')}) ORDER BY name`).all(...a));
});
app.post('/api/sites',auth,admin,(q,r)=>{try{db.prepare('INSERT INTO sites(name) VALUES(?)').run(q.body.name.trim());audit(q.user.username,'Create Site',q.body.name);r.json({ok:true})}catch(e){r.status(400).json({error:'Site already exists'})}});
app.patch('/api/sites/:id',auth,admin,(q,r)=>{try{const id=Number(q.params.id),name=String(q.body.name||'').trim();if(!id||!name)return r.status(400).json({error:'Site name required'});db.prepare('UPDATE sites SET name=? WHERE id=?').run(name,id);audit(q.user.username,'Edit Site',String(id));r.json({ok:true})}catch(e){r.status(400).json({error:'Site already exists or invalid data'})}});
app.delete('/api/sites/:id',auth,admin,(q,r)=>{try{const id=Number(q.params.id),site=db.prepare('SELECT * FROM sites WHERE id=?').get(id);if(!site)return r.status(404).json({error:'Site not found'});const used=db.prepare('SELECT COUNT(*) c FROM transactions WHERE site_id=? OR from_site_id=? OR to_site_id=?').get(id,id,id).c;if(used){db.prepare('UPDATE sites SET active=0 WHERE id=?').run(id)}else{db.prepare('DELETE FROM sites WHERE id=?').run(id)}audit(q.user.username,'Delete Site',String(id));r.json({ok:true,inactivated:Boolean(used)})}catch(e){r.status(400).json({error:'Could not delete site'})}});
app.get('/api/suppliers',auth,(q,r)=>r.json(db.prepare('SELECT * FROM suppliers WHERE active=1 ORDER BY name').all()));
app.post('/api/suppliers',auth,admin,(q,r)=>{try{const name=String(q.body.name||'').trim();if(!name)return r.status(400).json({error:'Supplier name required'});db.prepare('INSERT INTO suppliers(name) VALUES(?)').run(name);audit(q.user.username,'Create Supplier',name);r.json({ok:true})}catch(e){r.status(400).json({error:'Supplier already exists or invalid data'})}});
app.patch('/api/suppliers/:id',auth,admin,(q,r)=>{try{const id=Number(q.params.id),name=String(q.body.name||'').trim();if(!id||!name)return r.status(400).json({error:'Supplier name required'});const row=db.prepare('SELECT * FROM suppliers WHERE id=?').get(id);if(!row)return r.status(404).json({error:'Supplier not found'});db.prepare('UPDATE suppliers SET name=? WHERE id=?').run(name,id);audit(q.user.username,'Edit Supplier',name);r.json({ok:true})}catch(e){r.status(400).json({error:'Supplier already exists or invalid data'})}});
app.delete('/api/suppliers/:id',auth,admin,(q,r)=>{try{const id=Number(q.params.id),row=db.prepare('SELECT * FROM suppliers WHERE id=?').get(id);if(!row)return r.status(404).json({error:'Supplier not found'});db.prepare('UPDATE suppliers SET active=0 WHERE id=?').run(id);audit(q.user.username,'Delete Supplier',row.name);r.json({ok:true,inactivated:true})}catch(e){r.status(400).json({error:'Could not delete supplier'})}});
app.get('/api/stock',auth,(q,r)=>{const items=db.prepare('SELECT id,name,model,unit FROM items WHERE active=1 ORDER BY name,model').all();const a=assignedSites(q);const sites=a===null?db.prepare('SELECT id,name FROM sites WHERE active=1 ORDER BY name').all():(a.length?db.prepare(`SELECT id,name FROM sites WHERE active=1 AND id IN (${a.map(()=>'?').join(',')}) ORDER BY name`).all(...a):[]);const rows=[];for(const s of sites)for(const i of items)rows.push({...i,site_id:s.id,site:s.name,balance:balance(i.id,s.id)});r.json(rows)});
app.get('/api/stock-alerts',auth,(q,r)=>{const sf=siteFilter(q,'a.site_id');const rows=db.prepare(`SELECT a.id,a.site_id,s.name site,a.item_id,i.name material,i.model,i.unit,a.min_qty FROM stock_alerts a JOIN sites s ON s.id=a.site_id JOIN items i ON i.id=a.item_id WHERE a.active=1${sf.sql} ORDER BY s.name,i.name`).all(...sf.args);r.json(rows.map(x=>({...x,balance:balance(x.item_id,x.site_id),alert:balance(x.item_id,x.site_id)<x.min_qty?1:0})))});
app.post('/api/stock-alerts',auth,admin,(q,r)=>{try{const x=q.body,site=Number(x.site_id),item=Number(x.item_id),min=Number(x.min_qty);if(!site||!item||min<0||!ensureItem(item))return r.status(400).json({error:'Select site, material and valid minimum quantity'});db.prepare('INSERT INTO stock_alerts(site_id,item_id,min_qty) VALUES(?,?,?) ON CONFLICT(site_id,item_id) DO UPDATE SET min_qty=excluded.min_qty,active=1').run(site,item,min);audit(q.user.username,'Add/Update Stock Alert',`${site}/${item}`);r.json({ok:true})}catch(e){r.status(400).json({error:'Stock alert already exists or invalid data'})}});
app.patch('/api/stock-alerts/:id',auth,admin,(q,r)=>{const id=Number(q.params.id),x=q.body;if(x.min_qty===undefined)return r.status(400).json({error:'Minimum quantity required'});db.prepare('UPDATE stock_alerts SET site_id=?,item_id=?,min_qty=?,active=1 WHERE id=?').run(Number(x.site_id),Number(x.item_id),Number(x.min_qty),id);audit(q.user.username,'Edit Stock Alert',String(id));r.json({ok:true})});
app.delete('/api/stock-alerts/:id',auth,admin,(q,r)=>{const id=Number(q.params.id);db.prepare('DELETE FROM stock_alerts WHERE id=?').run(id);audit(q.user.username,'Delete Stock Alert',String(id));r.json({ok:true})});
app.post('/api/transaction',auth,(q,r)=>{
  const x=q.body,qty=Number(x.qty),type=String(x.type||''),site=Number(x.site_id||x.from_site_id||0),toSite=Number(x.to_site_id||0);
  if(!x.item_id||!site||!['receive','issue','return','damage','available'].includes(type)||!qty||qty<=0)
    return r.status(400).json({error:'Valid material, site, transaction type and quantity are required'});
  const perm=type==='return'?'return':type==='damage'?'damage':type==='issue'?'issue':'create';
  if(!userPerm(q,perm))return r.status(403).json({error:'Access not permitted for this transaction type'});
  if(!canSite(q,site)||(toSite&& !canSite(q,toSite)))return r.status(403).json({error:'You are not assigned to the selected site'});
  if(!ensureItem(x.item_id))return r.status(400).json({error:'Material not found'});
  if(['issue','damage','return'].includes(type)&&qty>balance(x.item_id,site))
    return r.status(400).json({error:`Insufficient available stock. Current available: ${balance(x.item_id,site)}`});
  const date=x.transaction_date||new Date().toISOString().slice(0,10),cond=x.condition_status||'New';

  // Return = stock leaves the selected From Site and is received by the selected To Site.
  // Store an OUT + IN pair under one reference so the stock calculation moves exactly once.
  if(type==='return'){
    if(!toSite || toSite===site)
      return r.status(400).json({error:'Return के लिए From और To Site अलग चुनें.'});
    const ref='RETURN-'+Date.now();
    db.transaction(()=>{
      const sql='INSERT INTO transactions(item_id,site_id,type,qty,ref,by_user,received_by,model,notes,condition_status,transaction_date,from_site_id,to_site_id,source_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
      db.prepare(sql).run(x.item_id,site,'return_out',qty,ref,q.user.username,'',x.model||'',x.notes||'',cond,date,site,toSite,'');
      db.prepare(sql).run(x.item_id,toSite,'return_in',qty,ref,q.user.username,x.received_by||'',x.model||'',x.notes||'',cond,date,site,toSite,'');
      audit(q.user.username,'RETURN',ref)
    })();
    return r.json({ok:true,ref});
  }

  const ref=type.toUpperCase()+'-'+Date.now(),isReceive=type==='receive';
  const fromSite=isReceive?null:site,destSite=isReceive?site:null;
  db.prepare('INSERT INTO transactions(item_id,site_id,type,qty,ref,by_user,received_by,model,notes,condition_status,transaction_date,from_site_id,to_site_id,source_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(x.item_id,site,type,qty,ref,q.user.username,x.received_by||'',x.model||'',x.notes||'',cond,date,fromSite,destSite,x.source_name||'');
  audit(q.user.username,type.toUpperCase(),ref);r.json({ok:true,ref})
});
app.post('/api/transfer',auth,requirePerm('transfer'),(q,r)=>{const x=q.body,qty=Number(x.qty),from=Number(x.from_site_id),to=Number(x.to_site_id);if(from===to||!x.item_id||!qty||qty<=0)return r.status(400).json({error:'Select different source/destination sites and valid quantity'});if(!canSite(q,from)||!canSite(q,to))return r.status(403).json({error:'You are not assigned to both selected sites'});const available=balance(x.item_id,from);if(qty>available)return r.status(400).json({error:`Insufficient source stock. Current available: ${available}`});const ref='TRANSFER-'+Date.now(),date=x.transaction_date||new Date().toISOString().slice(0,10),cond=x.condition_status||'New';db.transaction(()=>{const sql='INSERT INTO transactions(item_id,site_id,type,qty,ref,by_user,model,notes,condition_status,transaction_date,from_site_id,to_site_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)';db.prepare(sql).run(x.item_id,from,'transfer_out',qty,ref,q.user.username,x.model||'',x.notes||'',cond,date,from,to);db.prepare(sql).run(x.item_id,to,'transfer_in',qty,ref,q.user.username,x.model||'',x.notes||'',cond,date,from,to);audit(q.user.username,'STOCK TRANSFER',ref)})();r.json({ok:true,ref})});
app.get('/api/transactions',auth,(q,r)=>{const sf=siteFilter(q,'t.site_id');const raw=db.prepare(`SELECT t.*,i.name item,i.model item_model,s.name site,fs.name from_site_name,ts.name to_site_name FROM transactions t JOIN items i ON i.id=t.item_id LEFT JOIN sites s ON s.id=t.site_id LEFT JOIN sites fs ON fs.id=t.from_site_id LEFT JOIN sites ts ON ts.id=t.to_site_id WHERE 1=1${sf.sql} ORDER BY t.id DESC LIMIT 2000`).all(...sf.args);const out=[],seen=new Set();for(const x of raw){if((x.type==='transfer_out'||x.type==='transfer_in')&&String(x.ref||'').startsWith('TRANSFER-')){if(seen.has(x.ref))continue;seen.add(x.ref);const pair=raw.find(y=>y!==x&&y.ref===x.ref&&(y.type==='transfer_out'||y.type==='transfer_in'));const base=x.type==='transfer_out'?x:(pair||x);out.push({...base,type:'transfer',site:base.from_site_name||base.site,from_site_name:base.from_site_name||base.site,to_site_name:base.to_site_name||(pair&&pair.to_site_name)||'-',qty:Number(base.qty),id:base.id});}else out.push(x)}r.json(out)});
app.delete('/api/transactions/:id',auth,admin,(q,r)=>{const id=Number(q.params.id),row=db.prepare('SELECT * FROM transactions WHERE id=?').get(id);if(!row)return r.status(404).json({error:'Transaction not found'});try{db.transaction(()=>{if(['transfer_out','transfer_in','return_out','return_in'].includes(String(row.type))){db.prepare('DELETE FROM transactions WHERE ref=?').run(row.ref)}else{db.prepare('DELETE FROM transactions WHERE id=?').run(id)}audit(q.user.username,'DELETE TRANSACTION',row.ref)})();r.json({ok:true})}catch(e){r.status(400).json({error:'Could not delete transaction'})}});
app.get('/api/summary',auth,(q,r)=>{const items=db.prepare('SELECT COUNT(*) c FROM items WHERE active=1').get().c;const a=assignedSites(q);const tx=a===null?db.prepare('SELECT COUNT(*) c FROM transactions').get().c:(a.length?db.prepare(`SELECT COUNT(*) c FROM transactions WHERE site_id IN (${a.map(()=>'?').join(',')})`).get(...a).c:0);const alerts=a===null?db.prepare('SELECT COUNT(*) c FROM stock_alerts WHERE active=1').get().c:(a.length?db.prepare(`SELECT COUNT(*) c FROM stock_alerts WHERE active=1 AND site_id IN (${a.map(()=>'?').join(',')})`).get(...a).c:0);const alertRows=a===null?db.prepare('SELECT site_id,item_id,min_qty FROM stock_alerts WHERE active=1').all():(a.length?db.prepare(`SELECT site_id,item_id,min_qty FROM stock_alerts WHERE active=1 AND site_id IN (${a.map(()=>'?').join(',')})`).all(...a):[]);const lowStock=alertRows.filter(a=>balance(a.item_id,a.site_id)<a.min_qty).length;const stockRows=[];for(const site of (a===null?db.prepare('SELECT id FROM sites WHERE active=1').all():(a.length?db.prepare(`SELECT id FROM sites WHERE active=1 AND id IN (${a.map(()=>'?').join(',')})`).all(...a):[])))for(const item of db.prepare('SELECT id FROM items WHERE active=1').all())stockRows.push(balance(item.id,site.id));const totalUnits=stockRows.reduce((a,b)=>a+Number(b||0),0);r.json({items,transactions:tx,alerts,lowStock,totalUnits})});
app.get('/api/audit',auth,(q,r)=>r.json(db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 1000').all()));
app.get('/api/users',auth,admin,(q,r)=>r.json(db.prepare('SELECT id,username,role,permissions,active,created_at FROM users ORDER BY username').all()));
app.patch('/api/users/:id',auth,admin,(q,r)=>{try{const id=Number(q.params.id),u=db.prepare('SELECT * FROM users WHERE id=?').get(id);if(!u)return r.status(404).json({error:'User not found'});const username=String(q.body.username||u.username).trim(),role=String(q.body.role||u.role).toLowerCase();if(!username||!['admin','engineer','foreman','storekeeper'].includes(role))return r.status(400).json({error:'Invalid username or role'});const sites=Array.isArray(q.body.sites)?q.body.sites.map(Number).filter(Boolean):JSON.parse(u.permissions||'{}').sites||[];if(role!=='admin'&&!sites.length)return r.status(400).json({error:'At least one site is required'});const old=JSON.parse(u.permissions||'{}'),p=q.body.permissions||old;const perms={read:true,create:p.create===true,issue:p.issue===true,transfer:p.transfer===true,damage:p.damage===true,return:p.return===true,approve:p.approve===true,sites};if(role==='admin')perms.all=true;else delete perms.all;let password=u.password;if(String(q.body.password||''))password=bcrypt.hashSync(String(q.body.password),10);const active=q.body.active===false?0:(q.body.active===true?1:u.active);db.prepare('UPDATE users SET username=?,password=?,role=?,permissions=?,active=? WHERE id=?').run(username,password,role,JSON.stringify(perms),active,id);audit(q.user.username,'Edit User',username);r.json({ok:true})}catch(e){r.status(400).json({error:e.message.includes('UNIQUE')?'Username already exists':'Could not update user'})}});
app.delete('/api/users/:id',auth,admin,(q,r)=>{try{const id=Number(q.params.id),u=db.prepare('SELECT * FROM users WHERE id=?').get(id);if(!u)return r.status(404).json({error:'User not found'});if(id===Number(q.user.id))return r.status(400).json({error:'You cannot delete your own logged-in Admin account'});db.prepare('DELETE FROM users WHERE id=?').run(id);audit(q.user.username,'Delete User',u.username);r.json({ok:true})}catch(e){r.status(400).json({error:'Could not delete user'})}});
app.post('/api/users',auth,admin,(q,r)=>{try{
  const username=String(q.body.username||'').trim(),password=String(q.body.password||'');
  const role=String(q.body.role||'storekeeper').toLowerCase();
  if(!username||password.length<4)return r.status(400).json({error:'Username and password are required (minimum 4 characters)'});
  if(!['admin','engineer','foreman','storekeeper'].includes(role))return r.status(400).json({error:'Invalid role'});
  const sites=Array.isArray(q.body.sites)?q.body.sites.map(Number).filter(Boolean):[];
  if(role!=='admin'&&!sites.length)return r.status(400).json({error:'Admin must assign at least one site'});
  const p=q.body.permissions||{};
  const perms={read:true,create:p.create===true,issue:p.issue===true,transfer:p.transfer===true,damage:p.damage===true,return:p.return===true,approve:p.approve===true,sites};
  if(role==='admin')perms.all=true;
  db.prepare('INSERT INTO users(username,password,role,permissions) VALUES(?,?,?,?)').run(username,bcrypt.hashSync(password,10),role,JSON.stringify(perms));
  audit(q.user.username,'Create User',username);r.json({ok:true})
}catch(e){r.status(400).json({error:e.message.includes('UNIQUE')?'Username already exists':'Could not create user'})}});
app.get('/api/backup',auth,admin,(q,r)=>{const file=path.join(require('os').tmpdir(),'rcc_stocks_backup_'+Date.now()+'.db');db.backup(file).then(()=>{audit(q.user.username,'Database Backup',path.basename(file));r.download(file,path.basename(file),()=>{try{fs.unlinkSync(file)}catch{}})}).catch(e=>r.status(500).json({error:e.message}))});
app.get(/.*/,(q,r)=>r.sendFile(path.join(__dirname,'public','index.html')));app.listen(PORT,()=>console.log(`RCC Material Stocks V11.1 running on http://localhost:${PORT}`));
