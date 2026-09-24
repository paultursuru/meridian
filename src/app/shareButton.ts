import { showToast } from '../lib/ui.js';
import { tr } from '../lib/i18n.js';
import { track } from '../lib/analytics.js';
import { button } from './dom';

// renderAt keeps location.href in sync with the search.
export function initShareButton() {
  button('share-btn').addEventListener('click', async () => {
    const url = location.href;
    if (navigator.share) {
      track('share', { method: 'native' });
      try { await navigator.share({ title: document.title, url }); }
      catch { /* user dismissed the share sheet */ }
    } else {
      track('share', { method: 'clipboard' });
      await navigator.clipboard.writeText(url);
      showToast(tr('toast_link_copied'), 'success');
    }
  });
}
