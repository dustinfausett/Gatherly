import React, { useRef } from 'react';
import { Field } from './components';
import { FIRST_NAME_TOKEN, personalizeMessage } from '../shared/personalization';
import {isMobileMessagingDevice,messageEnterKey} from './message-keyboard';

export default function PersonalizedMessageField({ label, value, onChange, rows = 5, required = false, onDesktopEnter, sendDisabled = false }) {
  const input = useRef(null);
  return <div className="personalized-message-field">
    <Field label={label}><textarea ref={input} enterKeyHint={onDesktopEnter&&!isMobileMessagingDevice()?'send':'enter'} onKeyDown={onDesktopEnter?event=>messageEnterKey(event,{onSend:onDesktopEnter,disabled:sendDisabled}):undefined} value={value} onChange={event => onChange(event.target.value)} maxLength={10000} rows={rows} required={required}/></Field>
    <button type="button" className="text-button" disabled={value.length + FIRST_NAME_TOKEN.length > 10000} onClick={() => {
      const start = input.current?.selectionStart ?? value.length, end = input.current?.selectionEnd ?? value.length;
      onChange(value.slice(0, start) + FIRST_NAME_TOKEN + value.slice(end));
      requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(start + FIRST_NAME_TOKEN.length, start + FIRST_NAME_TOKEN.length); });
    }}>Insert first name</button>
    <p className="small-text muted">Use <strong>{FIRST_NAME_TOKEN}</strong> for the first word of each person’s name. You can review their individual messages before sending.</p>
  </div>;
}
export function RecipientMessagePreview({ body, name }) {
  try { return <p className="message-preview personalized-recipient-preview">{personalizeMessage(body,name)}</p>; }
  catch(error) { return <p className="error-banner" role="alert">{error.message}</p>; }
}
