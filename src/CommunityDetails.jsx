import SpaceIcon from './SpaceIcon';
import React from 'react';
import { ArrowLeft, Settings2, Trash2, Users } from 'lucide-react';
import { Avatar } from './components';

export default function CommunityDetails({ community: c, onBack, onModal }) {
  const counts = [
    ['Members',c.member_count], ['Branches',c.subcommunities.length],
    ['Nests to explore',c.circles.filter(g => !g.private && !g.joined).length],
    ['Nests you’ve joined',c.circles.filter(g => g.joined).length],
  ];
  return <div className="community-details">
    <button className="group-back" onClick={onBack}><ArrowLeft size={18} />Back to Tree</button>
    <header className="details-heading"><Avatar name={c.name} id={c.avatar_id} size={76} /><div><span className="eyebrow">TREE DETAILS</span><h1>{c.name}</h1></div></header>
    {c.description && <p className="community-description">{c.description}</p>}
    <dl className="community-details-stats">{counts.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="details-actions"><button className="button secondary" onClick={() => onModal({kind:'members'})}><Users size={18} />View members</button>{c.is_admin && <button className="button secondary" onClick={() => onModal({kind:'space',type:'community',entity:c})}><Settings2 size={18} />Tree settings</button>}{c.role === 'owner' && <button className="button danger-button" onClick={() => onModal({kind:'space',type:'community',entity:c,delete:true})}><Trash2 size={17}/>Delete Tree</button>}</div>
    <p className="details-hierarchy"><SpaceIcon kind="tree" size={24}/>A Tree brings everyone together. Branches organize Nests. Nests are where you chat.</p>
  </div>;
}
