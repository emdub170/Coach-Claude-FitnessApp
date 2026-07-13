// Single source of truth for the app version. Bump on every release —
// the service worker cache name derives from this, so a bump here is what
// makes installed phones fetch the new assets.
self.APP_VERSION = 'v4';
