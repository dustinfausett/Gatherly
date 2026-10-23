import React from 'react';
import { LockKeyhole } from 'lucide-react';

// Display the approved artwork without altering the original PNGs.
// Square viewports trim the spare canvas and keep the two icons optically aligned.
const frames = { tree: '115 100 700 700', nest: '965 170 750 750' };

export default function SpaceIcon({ kind = 'nest', size = 20, locked = false }) {
  return <span className={`space-icon ${locked ? 'is-private' : ''}`} aria-hidden="true" title={locked ? 'Private Nest' : undefined}>
    {locked && <LockKeyhole className="space-lock" size={Math.max(10, Math.round(size * .65))} />}
    {kind === 'branch' ? <img className="space-art space-art-branch" src="/brand/previews/churp-branch-proposed.png" width={size} height={size} alt="" draggable={false} /> : <svg className={`space-art space-art-${kind}`} viewBox={frames[kind]} width={size} height={size} fill="none" focusable="false">
      <image href="/brand/previews/churp-tree-nest-icons.png" width="1774" height="887" />
    </svg>}
  </span>;
}
