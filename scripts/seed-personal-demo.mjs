// Explicit, isolated fictional data only. Never runs during app startup/deploy.
import {resolve,join} from 'node:path';
import {existsSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/database.js';
import {passwordHash} from '../server/security.js';
if(process.env.NODE_ENV==='production'||process.env.RAILWAY_ENVIRONMENT_ID)throw new Error('Demo seeding is forbidden in production/Railway.');
const arg=process.argv.indexOf('--data-dir'),dir=arg>=0?process.argv[arg+1]:null;
if(process.env.CHURP_DEMO_SEED!=='1'||!dir||!resolve(dir).startsWith('/tmp/churp-demo-'))throw new Error('Use CHURP_DEMO_SEED=1 and --data-dir /tmp/churp-demo-<name>.');
if(existsSync(join(dir,'gatherly.sqlite')))throw new Error('Choose a new demo directory. Existing databases are never modified.');
mkdirSync(join(dir,'uploads'),{recursive:true});const db=openDatabase(join(dir,'gatherly.sqlite')),hashed=await passwordHash('Churp demo only!'),owner=randomUUID(),tree=randomUUID(),people=[owner,...Array.from({length:299},()=>randomUUID())];
db.exec('BEGIN');try{
 people.forEach((id,index)=>db.prepare("INSERT INTO users(id,username,name,password,avatar_style,avatar_choice,birth_date) VALUES (?,?,?,?,'portrait',?,'1990-01-01')").run(id,index?'demo_member_'+String(index).padStart(3,'0'):'demo_owner',index?'Fictional Member '+String(index).padStart(3,'0'):'Fictional Demo Owner',hashed,['blue','gold','pink','owl'][index%4]));
 db.prepare('INSERT INTO communities(id,name,description,owner_id) VALUES (?,?,?,?)').run(tree,'Fictional Meadow Congregation','Fictional 300-person pilot. No real personal data or SMS.',owner);
 people.forEach((id,i)=>{db.prepare('INSERT INTO community_members VALUES (?,?,?)').run(tree,id,i===0?'owner':i<4?'admin':'member');db.prepare('UPDATE users SET last_community_id=? WHERE id=?').run(tree,id);});
 for(const [index,name] of ['Youth','Families','Service','Music'].entries()){
  const branch=randomUUID(),nest=randomUUID();db.prepare('INSERT INTO subcommunities(id,community_id,name) VALUES (?,?,?)').run(branch,tree,name);db.prepare('INSERT INTO scoped_admins VALUES (?,?,?)').run('subcommunity',branch,people[index+4]);db.prepare('INSERT INTO groups(id,community_id,subcommunity_id,name) VALUES (?,?,?,?)').run(nest,tree,branch,name+' Nest');
  people.filter((id,i)=>i===0||i%4===index).forEach(id=>{db.prepare('INSERT INTO group_members(group_id,user_id) VALUES (?,?)').run(nest,id);db.prepare('INSERT OR IGNORE INTO collection_members VALUES (?,?)').run(branch,id);});
 }
 const house=randomUUID();db.prepare('INSERT INTO birdhouses VALUES (?,?,?)').run(house,owner,'Fictional friends');people.slice(1,31).forEach((peer,i)=>{const id=randomUUID();db.prepare('INSERT INTO personal_contacts VALUES (?,?,?,?,?,?)').run(id,owner,'Fictional friend '+String(i+1).padStart(2,'0'),null,peer,Date.now());db.prepare('INSERT INTO birdhouse_contacts VALUES (?,?)').run(house,id);});
 db.exec('COMMIT');console.log(`Created 300 fictional members in ${resolve(dir)}.\nDemo login: demo_owner / Churp demo only!\nRun locally with DATA_DIR=${resolve(dir)} npm run dev. No SMS provider or phone numbers were added.`);
}catch(e){db.exec('ROLLBACK');throw e;}finally{db.close();}
