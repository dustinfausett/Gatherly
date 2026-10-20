// Deliberately do not cache authenticated requests or private conversations.
self.addEventListener('push', event => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (!payload) return;
  event.waitUntil(self.registration.showNotification(payload.title || 'Gatherly', {
    body: payload.body, icon: '/icons/icon-192.png', data: { url: payload.url || '/' }, tag: 'gatherly-message',
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    const existing = clients.find(c => c.url.startsWith(self.location.origin));
    if (existing) { await existing.navigate(target.href); return existing.focus(); }
    return self.clients.openWindow(target.href);
  }));
});
