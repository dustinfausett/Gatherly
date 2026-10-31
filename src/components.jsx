import React, { useEffect, useId, useRef, useState } from 'react';
import { X, Camera, LoaderCircle, Check, ImagePlus } from 'lucide-react';
import { upload } from './api';
import { Bird } from './BirdJourney';
import AvatarPortrait from './AvatarPortrait';

export function Logo({ compact = false }) {
  return <div className={`logo churp-logo ${compact ? 'compact' : ''}`}><img src={compact ? '/brand/churp-nest.webp' : '/brand/churp-logo.webp'} alt="Churp" /></div>;
}
export function Avatar({ name = '?', id, birdId, portrait, size = 40, className = '', square = false }) {
  const palette = ['sage', 'rose', 'sand', 'lilac', 'blue'];
  const color = palette[Array.from(name).reduce((n,c) => n + c.charCodeAt(0), 0) % palette.length];
  return <span className={`avatar ${color} ${square ? 'square' : ''} ${className}`} style={{ width: size, height: size, fontSize: size * .34 }}>
    {portrait ? <AvatarPortrait choice={portrait}/> : birdId ? <Bird birdId={birdId} className="avatar-bird"/> : id ? <img src={`/api/files/${id}`} alt="" /> : name.trim().split(/\s+/).slice(0,2).map(x => x[0]).join('').toUpperCase()}
  </span>;
}
export function Modal({ title, subtitle, children, onClose, wide = false }) {
  const ref = useRef(),titleId=useId();
  useEffect(() => {
    const previous = document.activeElement;
    const focusable = () => [...ref.current.querySelectorAll('button,input,textarea,select,a[href]')].filter(x => !x.disabled && x.offsetParent !== null);
    (focusable().find(x => x.tagName === 'INPUT') || focusable()[0])?.focus();
    const key = e => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const items = focusable(), first = items[0], last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
      <button className="icon-button modal-close" aria-label="Close dialog" onClick={onClose}><X size={20} /></button>
      <h2 id={titleId}>{title}</h2>{subtitle && <p className="muted modal-subtitle">{subtitle}</p>}{children}
    </section>
  </div>;
}
export function Form({ children, onSubmit, submit = 'Save changes', footer, className = '' }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <form className={`form ${className}`} onSubmit={async e => {
    e.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { await onSubmit(new FormData(e.currentTarget)); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }}>
    <fieldset disabled={busy}>{children}</fieldset>
    {error && <div role="alert" className="error-banner">{error}</div>}
    <div className="form-footer">{footer}<button className="button primary" type="submit" disabled={busy}>{busy ? <LoaderCircle size={17} className="spin" /> : null}{submit}</button></div>
  </form>;
}
export function Field({ label, hint, children, ...props }) {
  const id = useId();
  const accessibility = { 'aria-labelledby': id, ...(hint ? { 'aria-describedby': `${id}-hint` } : {}) };
  return <label className="field"><span id={id}>{label}</span>{children ? React.cloneElement(children, accessibility) : <input {...props} {...accessibility} />}{hint && <small id={`${id}-hint`}>{hint}</small>}</label>;
}
export function AvatarEditor({ name, value, onChange }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <div className="avatar-editor"><Avatar name={name} id={value} size={68} square />
    <div><label className={`button secondary small ${busy ? 'disabled' : ''}`}><Camera size={15} />{busy ? 'Uploading…' : 'Change photo'}<input type="file" className="visually-hidden" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy} onChange={async e => {
      const f = e.target.files[0]; if (!f) return;
      setBusy(true); setError('');
      try { const result = await upload(f); if (!result.mime.startsWith('image/')) throw new Error('Choose a PNG, JPEG, GIF, or WebP image.'); onChange(result.id); }
      catch (err) { setError(err.message); } finally { setBusy(false); e.target.value = ''; }
    }} /></label><small>PNG, JPG, GIF or WebP · up to 15 MB</small>{value && <button type="button" className="text-button" onClick={() => onChange(null)}>Remove photo</button>}{error && <p className="field-error" role="alert">{error}</p>}</div>
  </div>;
}
export function Toggle({ checked, onChange, label, description }) {
  return <label className="toggle-row"><span><strong>{label}</strong>{description && <small>{description}</small>}</span><input className="visually-hidden" type="checkbox" aria-label={label} checked={checked} onChange={e => onChange(e.target.checked)} /><span className={`toggle ${checked ? 'checked' : ''}`} aria-hidden="true"><span /></span></label>;
}
export function Empty({ icon: Icon = ImagePlus, title, children, action }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={30} strokeWidth={1.5} /></span><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function Toast({ toast }) { return toast ? <div className={`toast ${toast.error ? 'bad' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <X size={18} /> : <Check size={18} />}{toast.message}</div> : null; }
export const formatTime = date => new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const formatDay = date => new Date(date).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
