import {birdWords} from '../shared/bird-words';
import React from 'react';
// Plain text stays plain text. Only explicit HTTP(S) URLs become links.
export default function MessageText({text}){return birdWords(String(text||'')).split(/(https?:\/\/[^\s<>]+)/g).map((part,i)=>{
 if(!/^https?:\/\//.test(part))return part;
 const url=part.replace(/[.,!?;:]+$/,'');try{new URL(url);}catch{return part;}
 return <React.Fragment key={i}><a className="message-link" href={url} target="_blank" rel="noopener noreferrer">{url}</a>{part.slice(url.length)}</React.Fragment>;
});}
