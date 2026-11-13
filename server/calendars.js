import {installCalendarReminders} from './calendar-reminders.js';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { keyVault } from './key-vault.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
export const branchColor = id => {
  // A full hue circle keeps colors stable when other Branches are added.
  let hash = 0; for (const c of id || 'tree') hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 58% 36%)`;
};
const escapeIcs = s => String(s).replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const stamp = s => new Date(s).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
export function calendarIcs(events, name) {
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Churp//Calendars//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH',`X-WR-CALNAME:${escapeIcs(name)}`];
  for (const e of events) lines.push('BEGIN:VEVENT',`UID:${e.id}@churp`, `DTSTAMP:${stamp(e.updated_at)}`,`LAST-MODIFIED:${stamp(e.updated_at)}`,`DTSTART:${stamp(e.start)}`,`DTEND:${stamp(e.end)}`,`SUMMARY:${escapeIcs(e.title)}`,`DESCRIPTION:${escapeIcs(e.description)}`,`LOCATION:${escapeIcs(e.location)}`,`CLASS:${e.visibility === 'private' ? 'PRIVATE' : 'PUBLIC'}`,'END:VEVENT');
  lines.push('END:VCALENDAR');
  // RFC 5545 folds by UTF-8 octets, without splitting a code point.
  return lines.map(line => { let out='', bytes=0; for(const c of line){const n=Buffer.byteLength(c);if(bytes+n>75){out+='\r\n ';bytes=1;}out+=c;bytes+=n;}return out; }).join('\r\n')+'\r\n';
}
// Check existing calendar data before any other managed service can create a master.
export function verifyCalendarVault(db,dataDir) {
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='calendar_events'").get())return;
  const saved=db.prepare('SELECT id,payload FROM calendar_events LIMIT 1').get();
  if(saved)keyVault(dataDir,true).open('calendar',saved.id,saved.payload);
}
export function installCalendars({app,db,dataDir,appUrl,membership,visibleCircle,joined,groupAdmin,refresh,family,notify,now=Date.now,autoProcess=true}) {
  db.exec(`CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id), visibility TEXT NOT NULL CHECK(visibility IN ('public','private')),
    payload TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS calendar_events_group ON calendar_events(group_id);
    CREATE TABLE IF NOT EXISTS calendar_branch_colors (branch_id TEXT PRIMARY KEY REFERENCES subcommunities(id) ON DELETE CASCADE, hue INTEGER NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS calendar_preferences (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      filters TEXT NOT NULL, PRIMARY KEY(user_id,community_id));
    CREATE TABLE IF NOT EXISTS calendar_subscriptions (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL);`);
  const one=(s,...a)=>db.prepare(s).get(...a), all=(s,...a)=>db.prepare(s).all(...a), run=(s,...a)=>db.prepare(s).run(...a);
  const vault=keyVault(dataDir,!!one('SELECT 1 FROM calendar_events LIMIT 1'));
  const reminders=installCalendarReminders({app,db,readEvent:e=>JSON.parse(vault.open('calendar',e.id,e.payload)),family,notify,now,autoProcess});
  function color(id) {
    if(!id)return branchColor(null);
    let row=one('SELECT hue FROM calendar_branch_colors WHERE branch_id=?',id);
    if(!row){let hue=parseInt(digest(id).slice(0,8),16)%360000;
      while(one('SELECT 1 FROM calendar_branch_colors WHERE hue=?',hue))hue=(hue+137508)%360000;
      run('INSERT INTO calendar_branch_colors VALUES (?,?)',id,hue);row={hue};
    }
    return `hsl(${row.hue/1000} 58% 36%)`;
  }
  function tree(uid,cid){if(!one('SELECT 1 FROM communities WHERE id=? AND archived_at IS NULL',cid))fail(404,'Tree not found.');membership(uid,cid);}
  function scope(uid,cid,type,id){if(typeof type!=='string'||typeof id!=='string'||id.length>80)fail(400,'Choose a calendar.');tree(uid,cid);if(type==='tree'&&id===cid)return;
    if(type==='branch'&&one('SELECT 1 FROM subcommunities WHERE id=? AND community_id=?',id,cid))return;
    if(type==='nest'&&visibleCircle(uid,id).community_id===cid)return;
    fail(404,'Calendar not found.');
  }
  function events(uid,cid,type='tree',id=cid){scope(uid,cid,type,id);
    return all(`SELECT e.*,g.subcommunity_id AS branch_id,g.name AS nest_name FROM calendar_events e JOIN groups g ON g.id=e.group_id WHERE g.community_id=?`,cid)
      .filter(e=>(type!=='branch'||e.branch_id===id)&&(type!=='nest'||e.group_id===id)&&(e.visibility==='public'||!!joined(uid,e.group_id)))
      .map(e=>{const {payload,...row}=e;return {...row,...JSON.parse(vault.open('calendar',e.id,payload)),color:color(e.branch_id),reminder:reminders.personal(uid,e),can_manage:!!joined(uid,e.group_id)&&(e.user_id===uid||!!groupAdmin(uid,visibleCircle(uid,e.group_id)))};})
      .sort((a,b)=>a.start.localeCompare(b.start));
  }
  function validate(body){const result={};for(const [key,max] of [['title',160],['description',5000],['location',500]]){
    if(typeof body[key]!=='string'||body[key].length>max||(key==='title'&&!body[key].trim()))fail(400,`Enter a valid ${key}.`);result[key]=body[key].trim();
    }for(const key of ['start','end']){if(typeof body[key]!=='string'||!Number.isFinite(Date.parse(body[key])))fail(400,'Choose valid event dates.');result[key]=new Date(body[key]).toISOString();}
    if(result.end<=result.start)fail(400,'The end must be after the start.');
    if(!['public','private'].includes(body.visibility))fail(400,'Choose public or private.');
    const zone=body.time_zone??'UTC';
    if(typeof zone!=='string'||zone.length>100)fail(400,'Choose a valid event time zone.');
    try{new Intl.DateTimeFormat('en-US',{timeZone:zone});}catch{fail(400,'Choose a valid event time zone.');}
    result.time_zone=zone;
    return result;
  }
  function posting(uid,gid){const g=visibleCircle(uid,gid);if(!joined(uid,gid)||(g.admin_only&&!groupAdmin(uid,g)))fail(403,'Posting permissions are required in this Nest.');return g;}
  app.get('/api/calendar/trees/:cid',(req,res)=>{const cid=req.params.cid;tree(req.user.id,cid);
    const branches=all('SELECT id,name FROM subcommunities WHERE community_id=? ORDER BY name,id',cid).map(b=>({...b,color:color(b.id)}));
    const nests=all('SELECT * FROM groups WHERE community_id=? ORDER BY name,id',cid).filter(g=>{try{visibleCircle(req.user.id,g.id);return true;}catch{return false;}}).map(g=>({id:g.id,name:g.name,branch_id:g.subcommunity_id,can_post:!!joined(req.user.id,g.id)&&(!g.admin_only||!!groupAdmin(req.user.id,g))}));
    res.json({events:events(req.user.id,cid),branches,nests,notification_offsets:reminders.settings(req.user.id).offsets,filters:JSON.parse(one('SELECT filters FROM calendar_preferences WHERE user_id=? AND community_id=?',req.user.id,cid)?.filters||'null'),subscriptions:all('SELECT id,scope_type,scope_id FROM calendar_subscriptions WHERE user_id=? AND community_id=?',req.user.id,cid)});
  });
  app.put('/api/calendar/trees/:cid/filters',(req,res)=>{tree(req.user.id,req.params.cid);const {branches,nests}=req.body;
    if(![branches,nests].every(a=>Array.isArray(a)&&a.length<=1000&&a.every(x=>typeof x==='string'&&x.length<=80)))fail(400,'Choose valid calendar filters.');
    run('INSERT INTO calendar_preferences VALUES (?,?,?) ON CONFLICT(user_id,community_id) DO UPDATE SET filters=excluded.filters',req.user.id,req.params.cid,JSON.stringify({branches:[...new Set(branches)],nests:[...new Set(nests)]}));res.json({ok:true});});
  app.post('/api/calendar/events',(req,res)=>{const g=posting(req.user.id,req.body.group_id),data=validate(req.body),id=randomUUID();
    run('INSERT INTO calendar_events VALUES (?,?,?,?,?,?)',id,g.id,req.user.id,req.body.visibility,vault.seal('calendar',id,JSON.stringify(data)),new Date(now()).toISOString());refresh(g.community_id);res.status(201).json({id});});
  function manage(req){const e=one('SELECT * FROM calendar_events WHERE id=?',req.params.id)||fail(404,'Event not found.');const g=posting(req.user.id,e.group_id);if(e.user_id!==req.user.id&&!groupAdmin(req.user.id,g))fail(403,'Only the creator or a Nest admin can change this event.');return {e,g};}
  app.patch('/api/calendar/events/:id',(req,res)=>{const {e,g}=manage(req),data=validate(req.body);run('UPDATE calendar_events SET visibility=?,payload=?,updated_at=? WHERE id=?',req.body.visibility,vault.seal('calendar',e.id,JSON.stringify(data)),new Date(now()).toISOString(),e.id);refresh(g.community_id);res.json({ok:true});});
  app.delete('/api/calendar/events/:id',(req,res)=>{const {e,g}=manage(req);run('DELETE FROM calendar_events WHERE id=?',e.id);refresh(g.community_id);res.json({ok:true});});
  app.post('/api/calendar/trees/:cid/subscriptions',(req,res)=>{const {scope_type:type,scope_id:id}=req.body;scope(req.user.id,req.params.cid,type,id);const token=randomBytes(32).toString('base64url'),sid=randomUUID();
    run('INSERT INTO calendar_subscriptions VALUES (?,?,?,?,?,?)',sid,digest(token),req.user.id,req.params.cid,type,id);res.status(201).json({id:sid,url:`${appUrl.replace(/\/$/,'')}/calendar/feeds/${token}.ics`});});
  app.delete('/api/calendar/subscriptions/:id',(req,res)=>{run('DELETE FROM calendar_subscriptions WHERE id=? AND user_id=?',req.params.id,req.user.id);res.json({ok:true});});
  app.get('/calendar/feeds/:token.ics',(req,res)=>{res.set('Cache-Control','no-store');res.set('Referrer-Policy','no-referrer');
    const s=one('SELECT s.* FROM calendar_subscriptions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND u.deleted_at IS NULL',digest(req.params.token));if(!s)fail(404,'Subscription not found.');
    family.requireReady(s.user_id);const list=events(s.user_id,s.community_id,s.scope_type,s.scope_id);res.type('text/calendar').send(calendarIcs(list,'Churp calendar'));
  });
  return {events,...reminders};
}
