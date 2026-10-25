import React,{useId} from 'react';
import { getAvatar } from '../shared/avatars';
// Display crops keep the generated artwork intact, without including neighbors.
const columns=[[0,337],[342,616],[648,923],[962,1254]];
const rows=[[17,287],[287,532],[532,776],[776,1008],[1008,1241]];
export default function AvatarPortrait({choice='blue',className=''}){
  const clip=useId();
  const avatar=getAvatar(choice) || getAvatar('blue'),[left,right]=columns[avatar.column],[top,bottom]=rows[avatar.row];
  return <svg className={`avatar-portrait ${className}`} data-avatar-choice={avatar.id} viewBox={`${left} ${top} ${right-left} ${bottom-top}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" overflow="hidden"><defs><clipPath id={clip}><rect x={left} y={top} width={right-left} height={bottom-top}/></clipPath></defs><image href="/brand/avatars/churp-portraits.png" width="1254" height="1254" clipPath={`url(#${clip})`}/></svg>;
}
