// Le tag Umami des layouts porte data-auto-pageview="false", donc le pageview
// d'arrivee n'est plus envoye tout seul : c'est le role de trackPageview().
//
// Pourquoi couper l'automatique : renderAt() (AppLayout.astro) termine par un
// history.replaceState() pour que le lien de partage reflete l'instant affiche,
// et il tourne a chaque tick du time scrubber. Or Umami traite tout changement
// d'URL comme une nouvelle page vue. Mesure du 2026-08-04 sur la prod : un seul
// drag du scrubber = +92 pages vues. Les sessions reelles montaient a 500+ vues
// pour 3 events, ce qui rend la colonne Views illisible et brule le quota.
//
// data-auto-pageview="false" plutot que data-auto-track="false" : le second
// empeche tout le bloc d'initialisation du script de tourner, y compris les
// events custom ci-dessous. Le premier ne desactive que les deux envois de
// pageview (arrivee + changement d'URL).
//
// Les layouts portent aussi data-performance="false" (2026-08-06). Le defaut
// Umami est actif, donc il faut poser "false" explicitement : retirer
// l'attribut ne suffit pas. Mesure sur l'export de prod : les sends
// performance etaient 68,8 par session (94 % du total), et 96 % d'entre eux
// etaient vides. C'est le meme replaceState() du scrubber qui declenche le
// hook d'historique d'Umami, lequel flushe les web vitals meme quand il n'y a
// rien a envoyer. On passait 78 % du quota mensuel sur des payloads vides,
// soit un plafond a ~1 360 sessions/mois contre ~21 700 sans.
//
// Le vrai correctif reste de debouncer le replaceState a la fin du drag au
// lieu de le faire a chaque tick : ca garderait les web vitals reels. Coupe
// en attendant, parce que ca touche le comportement des liens de partage.
//
// Les events custom (search, share, tab_switch, scrub, install) ne sont pas
// concernes : ils passent par des appels explicites a window.umami.track(nom).

// Le script Umami est en defer et notre bundle aussi : selon l'ordre de
// resolution, window.umami peut ne pas encore exister. On reessaie brievement
// plutot que de supposer un ordre d'execution.
const RETRY_MS = 200;
const MAX_WAIT_MS = 5000;

export function trackPageview() {
  let waited = 0;
  const attempt = () => {
    // track() sans argument envoie exactement le meme payload que le pageview
    // automatique : c'est la meme fonction interne cote Umami.
    if (window.umami) return void window.umami.track();
    waited += RETRY_MS;
    if (waited <= MAX_WAIT_MS) setTimeout(attempt, RETRY_MS);
  };
  attempt();
}
