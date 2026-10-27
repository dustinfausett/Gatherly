import React,{useEffect,useState} from 'react';
import {Field} from './components';
import {api} from './api';
export function useNestScope(tree){
 const [state,setState]=useState({tree:'',nests:[],loaded:false,error:''});
 useEffect(()=>{let active=true;setState({tree,nests:[],loaded:!tree,error:''});if(tree)api(`/contacts/recipient-scopes?tree_id=${encodeURIComponent(tree)}`).then(r=>{if(active)setState({tree,nests:r.nests,loaded:true,error:''});}).catch(e=>{if(active)setState({tree,nests:[],loaded:true,error:e.message});});return()=>{active=false;};},[tree]);
 return state.tree===tree?state:{tree,nests:[],loaded:false,error:''};
}
export function NestFilter({scope,nest,onChange}){return <><Field label="Nest (optional)"><select value={nest} disabled={!scope.loaded} onChange={e=>onChange(e.target.value)}><option value="">{scope.loaded?'All Nests / no filter':'Loading Nests…'}</option>{scope.nests.map(n=><option key={n.id} value={n.id}>{n.name}</option>)}</select></Field>{scope.error&&<p className="error-banner" role="alert">{scope.error}</p>}</>;}
