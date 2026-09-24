import { el, button } from './dom';

// What the empty app shows: the intro bubble, the demo button and the demo's
// note under the date popover.

export function hideAppDescription() {
  el('app-description').classList.add('hidden');
}

export function showOnboardingNote(show: boolean) {
  el('onboarding-note').classList.toggle('on', show);
}

export function hideOnboardingButton(hide: boolean) {
  el('onboarding-btn').classList.toggle('off', hide);
}

export function initIntro({ onStartDemo }: { onStartDemo: () => void }) {
  button('app-description-close').addEventListener('click', hideAppDescription);
  // Closing the note doesn't leave the demo.
  button('onboarding-note-close').addEventListener('click', () => showOnboardingNote(false));
  el('onboarding-btn').addEventListener('click', (e: MouseEvent) => {
    // A modified click opens the link in a new tab, as any link would.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    // Or the outside-click handler closes the popover the demo just opened.
    e.stopPropagation();
    onStartDemo();
  });
}
