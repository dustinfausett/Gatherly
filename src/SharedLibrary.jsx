import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, File, FileText, Image as ImageIcon, Mail, Vote, ClipboardCheck, Music, Video } from 'lucide-react';
import { Modal } from './components';
import { api } from './api';
import { useEncryption } from './encryption/EncryptionGate';
import { attachmentUrl, decryptMessages } from './encryption/client';
import { parsePoll } from '../shared/polls';
import { PollCard } from './Polls';
import './shared-library.css';
import { parseRsvp } from '../shared/rsvps';
import { RsvpEnvelope } from './Rsvps';
import { AssignmentCard } from './Assignments';
import { parseAssignments } from '../shared/assignments';
import { activityArtwork } from './activityArtwork';

const categories = [
  { id: 'pictures', label: 'Pictures', Icon: ImageIcon, always: true },
  { id: 'documents', label: 'Documents', Icon: FileText, always: true },
  { id: 'polls', art: activityArtwork.poll, label: 'Polls', Icon: Vote, always: true },
  { id: 'rsvps', art: activityArtwork.rsvp, label: 'RSVPs', Icon: Mail, always: true },
  { id: 'assignments', art: activityArtwork.assignments, label: 'Assignments', Icon: ClipboardCheck, always: true },
  { id: 'videos', label: 'Videos', Icon: Video },
  { id: 'audio', label: 'Audio', Icon: Music },
  { id: 'files', label: 'Other files', Icon: File },
];
function fileCategory(file) {
  const ext = file.name.split('.').at(-1).toLowerCase(), mime = file.mime.toLowerCase();
  if (/^image\/(png|jpeg|gif|webp)$/.test(mime) || /^(png|jpe?g|gif|webp|heic|heif|avif)$/.test(ext)) return 'pictures';
  if (mime.startsWith('video/') || /^(mp4|mov|webm|m4v|avi|mkv|3gp)$/.test(ext)) return 'videos';
  if (mime.startsWith('audio/') || /^(mp3|m4a|aac|wav|ogg|flac|aiff|opus)$/.test(ext)) return 'audio';
  if (mime === 'application/pdf' || mime.startsWith('text/') || /^(pdf|docx?|xlsx?|pptx?|txt|csv|rtf|odt|ods|odp|pages|numbers|key)$/.test(ext)) return 'documents';
  return 'files';
}
const sizeLabel = bytes => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const dateLabel = date => new Date(date).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function useFileUrl(file, getUrl, active = true) {
  const [url, setUrl] = useState(null), [error, setError] = useState('');
  useEffect(() => { if (!active) return; let current = true;
    getUrl(file).then(value => { if (current) { setUrl(value); setError(''); } }).catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [file.id, file.key, getUrl, active]);
  return [url, error];
}
function PictureTile({ item, getUrl, onOpen }) {
  const ref = useRef(null), [visible, setVisible] = useState(false);
  const [url, error] = useFileUrl(item.file, getUrl, visible);
  useEffect(() => {
    if (!('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '100px' });
    observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  return <button type="button" className="shared-picture" ref={ref} onClick={() => onOpen(item)}>
    <span className="shared-picture-thumb">{url ? <img src={url} alt="" loading="lazy" /> : <ImageIcon size={30} />}</span>
    <strong>{item.file.name}</strong><small>{item.sender} · {dateLabel(item.createdAt)}</small>{error && <small>Tap to try opening again.</small>}
  </button>;
}
function PictureView({ item, getUrl }) {
  const [url, error] = useFileUrl(item.file, getUrl), [unreadable, setUnreadable] = useState(false);
  return <div className="shared-picture-view">
    <p className="shared-item-meta">{item.sender} · {dateLabel(item.createdAt)}</p>
    {error ? <p role="alert" className="field-error">{error}</p> : !url ? <p role="status">Opening picture…</p> : <>
      {!unreadable && <img src={url} alt={item.file.name} onError={() => setUnreadable(true)} />}
      {unreadable && <p>This browser can’t display this picture. You can download it to open it on your device.</p>}
      <a className="button secondary" href={url} download={item.file.name}><Download size={17} />Download picture</a>
    </>}
  </div>;
}
function DownloadRow({ item, getUrl }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const Icon = categories.find(c => c.id === item.category).Icon;
  async function download() {
    setBusy(true); setError('');
    try { const url = await getUrl(item.file), link = document.createElement('a'); link.href = url; link.download = item.file.name; document.body.append(link); link.click(); link.remove(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <div className="shared-download"><button type="button" disabled={busy} onClick={download}><span className="shared-file-icon"><Icon size={24} /></span><span><strong>{item.file.name}</strong><small>{item.sender} · {dateLabel(item.createdAt)} · {sizeLabel(item.file.size)}</small></span><Download size={18} />{busy && <span className="visually-hidden">Preparing download…</span>}</button>{error && <p role="alert" className="field-error">{error} Tap the file to try again.</p>}</div>;
}

export default function SharedLibrary({ group, user, version, onClose, onOpenPoll, onOpenRsvp, onOpenAssignments, suspended = false }) {
  const { enabled } = useEncryption();
  const [items, setItems] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [unverified, setUnverified] = useState(0);
  const [category, setCategory] = useState(null), [picture, setPicture] = useState(null), [retry, setRetry] = useState(0);
  const cache = useRef(new Map()), disposed = useRef(false), backButton = useRef(null), lastCategory = useRef(null), categoryButtons = useRef({});
  const getUrl = useCallback(file => {
    if (!enabled) return Promise.resolve(`/api/files/${file.id}`);
    const key = `${file.id}:${file.key}`;
    if (!cache.current.has(key)) {
      const entry = {};
      entry.promise = attachmentUrl(file).then(url => {
        if (disposed.current || cache.current.get(key) !== entry) { URL.revokeObjectURL(url); throw new Error('The shared library was closed.'); }
        entry.url = url; return url;
      }).catch(e => { if (cache.current.get(key) === entry) cache.current.delete(key); throw e; });
      cache.current.set(key, entry);
    }
    return cache.current.get(key).promise;
  }, [enabled]);
  useEffect(() => { disposed.current = false; return () => { disposed.current = true; for (const entry of cache.current.values()) if (entry.url) URL.revokeObjectURL(entry.url); cache.current.clear(); }; }, []);
  useEffect(() => {
    let current = true; setLoading(true); setError('');
    (async () => {
      const found = []; let before = '', invalid = 0, more;
      do {
        const result = await api(`/groups/${group.id}/shared${before ? `?before=${before}` : ''}`);
        if (!current) return;
        const messages = enabled ? await decryptMessages(group.id, result.messages) : result.messages;
        if (!current) return;
        for (const message of messages) {
          if (message.decryptionError) { invalid++; continue; }
          const common = { message, messageId: message.id, createdAt: message.created_at, sender: message.user_id === user.id ? 'You' : message.name };
          if (message.message_kind === 'poll') {
            const poll = parsePoll(message.body);
            if (poll) found.push({ ...common, id: `poll:${message.id}`, category: 'polls', title: poll.title, index: -1 }); else invalid++;
          }
          if (message.message_kind === 'rsvp') {
            const event = parseRsvp(message.body);
            if (event) found.push({ ...common, id: `rsvp:${message.id}`, category: 'rsvps', title: event.title, index: -1 }); else invalid++;
          }
          if (message.message_kind === 'assignments') {
            const list = parseAssignments(message.body);
            if (list) found.push({ ...common, id: `assignments:${message.id}`, category: 'assignments', title: list.title, index: -1 }); else invalid++;
          }
          message.files.forEach((file, index) => found.push({ ...common, id: `file:${file.id}`, category: fileCategory(file), file, index }));
        }
        more = result.has_more && messages.length > 0; before = result.messages[0]?.id;
      } while (more);
      if (current) {
        found.sort((a, b) => b.messageId - a.messageId || a.index - b.index);
        setItems(found); setUnverified(invalid); setPicture(prev => prev && found.some(item => item.id === prev.id) ? prev : null);
      }
    })().catch(e => { if (current) { setError(e.message); if ([403, 404].includes(e.status)) { setItems([]); setPicture(null); } } }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [group.id, enabled, user.id, version, retry]);
  useEffect(() => {
    if (suspended) return;
    if (category || picture) backButton.current?.focus(); else if (lastCategory.current) categoryButtons.current[lastCategory.current]?.focus();
  }, [category, picture, suspended]);
  if (suspended) return null;
  const activeCategory = categories.find(c => c.id === category), shown = items.filter(item => item.category === category);
  return <Modal title={picture ? picture.file.name : activeCategory ? activeCategory.label : 'Shared in this Nest'} subtitle={group.name} onClose={onClose} wide>
    <div className="shared-library">
      {(category || picture) && <button ref={backButton} className="text-button shared-back" type="button" onClick={() => picture ? setPicture(null) : setCategory(null)}><ArrowLeft size={17} />{picture ? 'Back to Pictures' : 'All shared items'}</button>}
      {error && <div className="error-banner" role="alert">{error}<button className="text-button" type="button" onClick={() => setRetry(n => n + 1)}>Try again</button></div>}
      {loading && <p className="shared-loading" role="status">Loading shared items…</p>}
      {!!unverified && <p className="field-error" role="alert">Some shared items could not be decrypted or verified and aren’t shown.</p>}
      {picture ? <PictureView item={picture} getUrl={getUrl} /> : !category ? <div className="shared-categories">{categories.filter(c => c.always || items.some(item => item.category === c.id)).map(({ id, label, Icon, art }) => <button key={id} type="button" ref={el => { categoryButtons.current[id] = el; }} onClick={() => { lastCategory.current = id; setCategory(id); }}><>{art ? <img className="shared-activity-art" src={art} alt="" width="48" height="48" /> : <Icon size={27} />}</><span>{label}</span>{!loading && <small>{items.filter(item => item.category === id).length}</small>}</button>)}</div> : <>
        <p className="shared-sort">Newest first</p>
        {!loading && !shown.length && !error && <p className="shared-empty">No {activeCategory.label.toLowerCase()} have been shared with you in this Nest yet.</p>}
        <div className={category === 'pictures' ? 'shared-pictures' : 'shared-items'}>{shown.map(item => category === 'pictures' ? <PictureTile key={item.id} item={item} getUrl={getUrl} onOpen={setPicture} /> : category === 'polls' ? <div className="shared-poll" key={item.id}><PollCard message={item.message} group={group} user={user} version={version} onOpen={onOpenPoll} /><p className="shared-item-meta">{item.sender} · {dateLabel(item.createdAt)}</p></div> : category === 'rsvps' ? <div className="shared-poll" key={item.id}><RsvpEnvelope message={item.message} group={group} user={user} version={version} onOpen={onOpenRsvp} /><p className="shared-item-meta">{item.sender} · {dateLabel(item.createdAt)}</p></div> : category === 'assignments' ? <div className="shared-poll" key={item.id}><AssignmentCard message={item.message} group={group} user={user} version={version} onOpen={onOpenAssignments} /><p className="shared-item-meta">{item.sender} · {dateLabel(item.createdAt)}</p></div> : <DownloadRow key={item.id} item={item} getUrl={getUrl} />)}</div>
      </>}
    </div>
  </Modal>;
}
