// Use device identity rather than viewport width: a narrow computer window
// should still behave like a computer, and iPad desktop mode stays touch-first.
export function isMobileMessagingDevice(device = globalThis.navigator) {
  return !!device && (device.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(`${device.userAgent || ''} ${device.platform || ''}`) || device.platform === 'MacIntel' && device.maxTouchPoints > 1);
}

export function messageEnterKey(event, { onSend, disabled = false, device } = {}) {
  const native = event.nativeEvent || event;
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || native.isComposing || event.keyCode === 229 || native.keyCode === 229 || isMobileMessagingDevice(device)) return;
  event.preventDefault();
  if (!disabled && !event.repeat && !native.repeat) onSend?.();
}
