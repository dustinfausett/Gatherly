import React from 'react';
import { ArrowLeft, MessageCircle, Settings2, Users } from 'lucide-react';
import { Avatar } from './components';

export default function CommunityDetails({ community: c, onBack, onModal }) {
  const counts = [
    ['Members',c.member_count], ['Groups',c.subcommunities.length],
    ['Circles to explore',c.circles.filter(g => !g.private && !g.joined).length],
    ['Circles you’ve joined',c.circles.filter(g => g.joined).length],
  ];
  return <div className="community-details">
    <button className="group-back" onClick={onBack}><ArrowLeft size={18} />Back to Community</button>
    <header className="details-heading"><Avatar name={c.name} id={c.avatar_id} size={76} /><div><span className="eyebrow">COMMUNITY DETAILS</span><h1>{c.name}</h1></div></header>
    {c.description && <p className="community-description">{c.description}</p>}
    <dl className="community-details-stats">{counts.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="details-actions"><button className="button secondary" onClick={() => onModal({kind:'members'})}><Users size={18} />View members</button>{c.is_admin && <button className="button secondary" onClick={() => onModal({kind:'space',type:'community',entity:c})}><Settings2 size={18} />Community settings</button>}</div>
    <p className="details-hierarchy"><MessageCircle size={18} />A Community brings everyone together. Groups organize Circles. Circles are where you chat.</p>
  </div>;
}
