import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {readScheduled} from './scheduled-client';
import {conversationParts} from '../shared/scheduling';
export {conversationParts,activeScheduledPart} from '../shared/scheduling';

export function useScheduledSends({version,channel=null,targetId=null,enabled=true}={}){
 const scope=JSON.stringify([channel,targetId,enabled]),[state,setState]=useState({}),[revision,setRevision]=useState(0),cache=useRef(new Map());
 const reload=()=>setRevision(n=>n+1);
 useEffect(()=>{window.addEventListener('churp-scheduled-changed',reload);return()=>window.removeEventListener('churp-scheduled-changed',reload);},[]);
 useEffect(()=>{
  if(!enabled||(channel&&!targetId))return;
  let active=true,running=false;
  const load=async()=>{if(running)return;running=true;try{
   const result=await api(`/scheduled${channel?`?channel=${encodeURIComponent(channel)}&target_id=${encodeURIComponent(targetId)}`:''}`),selected=result.sends.filter(row=>!channel||conversationParts(row,channel,targetId).length);
   const rows=await Promise.all(selected.map(async row=>{try{
    const key=JSON.stringify([row.draft_ciphertext,row.send_at,row.entries,row.recurrence]),old=cache.current.get(row.id),draft=old?.key===key?old.draft:await readScheduled(row);
    cache.current.set(row.id,{key,draft});return {...row,draft};
   }catch(error){return {...row,draftError:error.message};}}));
   if(active){const ids=new Set(selected.map(row=>row.id));for(const id of cache.current.keys())if(!ids.has(id))cache.current.delete(id);setState({scope,rows,error:''});}
  }catch(error){if(active)setState(old=>({...old,scope,rows:old.scope===scope?old.rows:null,error:error.message}));}finally{running=false;}};
  load();const timer=setInterval(load,3000);window.addEventListener('focus',load);
  return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',load);};
 },[scope,version,revision]);
 return {rows:enabled&&state.scope===scope?state.rows:null,error:enabled&&state.scope===scope?state.error:'',reload};
}
