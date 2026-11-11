// Content of the Lausanne page. Every figure comes from a run of the app's
// shade engine over the centre's streets, with each roof measured against the
// street's own altitude (swissBUILDINGS3D + swissALTI3D): change a number only
// from a new run.
//
// One block per season. `season` picks the one on the page: switch it to 'ete'
// in spring, once the summer block is written from summer figures.

import type { CityPage } from './types';

export const lausanne: CityPage = {
  slug: 'lausanne',
  name: 'Lausanne',
  lang: 'fr',
  computedOn: '2026-10-30',
  season: 'hiver',
  seasons: {
    hiver: {
      title: 'Itinéraires au soleil à Lausanne',
      metaTitle: 'Itinéraires au soleil à Lausanne en hiver : MeridianWay',
      metaDescription: 'Le 21 décembre, une rue du centre de Lausanne reçoit en moyenne 1 h 30 de soleil. Les heures, les quartiers, les endroits et les marchés de Bô Noël les plus ensoleillés, calculés avec les hauteurs de bâtiments swisstopo.',
      lede: [
        { text: 'Le 21 décembre, ' },
        { text: 'une rue du centre de Lausanne reçoit en moyenne 1 h 30 de soleil direct', strong: true },
        { text: ', d\'après les hauteurs de bâtiments swisstopo et le relief de la ville. MeridianWay trouve le chemin à pied qui en garde le plus.' },
      ],
      defaultMode: 'sun',
      glance: {
        heading: 'Le soleil à Lausanne le 21 décembre',
        shade: {
          title: 'Côté ombre',
          items: [
            { label: 'Rues du centre sans soleil de la journée', value: 'plus d\'une sur trois (37 %)', bar: 37 },
            { label: 'Rues du centre à l\'ombre à 12 h 30', value: '73 %', bar: 73 },
            { label: 'Heures les plus sombres', value: 'avant 10 h et après 15 h 30' },
            { label: 'Quartiers les plus à l\'ombre', value: 'Saint-François, Chauderon' },
          ],
        },
        sun: {
          title: 'Côté soleil',
          items: [
            { label: 'Soleil moyen d\'une rue du centre', value: '1 h 30, plus de 2 h 30 à la mi-février' },
            { label: 'Rues du centre au soleil au meilleur moment', value: '31 % vers 13 h 30 (68 % le 21 juin)', bar: 31 },
            { label: 'Meilleures heures pour le soleil', value: 'de 12 h 15 à 14 h 45' },
            { label: 'Quartiers les plus ensoleillés', value: 'la Gare, Ouchy' },
          ],
        },
      },
      routes: {
        heading: 'Un trajet au soleil à Lausanne',
        items: [
          {
            from: { label: 'Gare de Lausanne', lat: 46.51699, lng: 6.62917 },
            to: { label: 'Place de la Riponne', lat: 46.52419, lng: 6.63319 },
            when: { monthDay: '12-21', time: '12:30', label: 'le 21 décembre à 12 h 30' },
            summary: 'Le chemin au soleil garde deux fois plus de soleil que le plus court, pour 5 minutes de marche en plus.',
            sunny: { label: 'Chemin au soleil', minutes: 20, km: '1,4' },
            other: { label: 'Chemin le plus court', minutes: 15, km: '1,0' },
          },
        ],
      },
      spots: {
        heading: 'Les 6 endroits les plus ensoleillés de Lausanne en hiver',
        intro: 'Heures de soleil le 21 décembre, entre 9 h et 16 h : avant et après, le soleil est trop bas pour compter.',
        items: [
          { name: 'Quai de Belgique', where: 'Ouchy, au bord du lac', hours: '7 h, toute la journée' },
          { name: 'Place de la Navigation', where: 'Ouchy, face au lac', hours: '7 h' },
          { name: 'Promenade Derrière-Bourg', where: 'en plein centre, près de Saint-François', hours: '6 h' },
          { name: 'Parc de Milan', where: 'près de Montriond', hours: '6 h' },
          { name: 'Parc de Mon-Repos', where: 'à l\'est du centre', hours: '4 h 30' },
          { name: 'Esplanade de Montbenon', where: 'à l\'ouest du centre', hours: '4 h 30' },
        ],
      },
      // Last edition of Bô Noël: remove this block and its FAQ entry once it is over.
      markets: {
        anchor: 'bo-noel',
        heading: 'Le soleil sur les marchés de Bô Noël',
        intro: 'Bô Noël a lieu du 20 novembre au 31 décembre 2026. Heures de soleil par jour et par ciel dégagé, en moyenne sur chaque place.',
        items: [
          { name: 'Esplanade de la Cathédrale', where: 'Village des Enfants', hours: '2 h' },
          { name: 'Place de la Riponne', where: 'Place des Lumières, avec la grande roue', hours: 'de 1 h 30 à 2 h' },
          { name: 'Place des Pionnières', where: 'Marché des Papilles', hours: 'presque rien en décembre', shade: true },
          { name: 'Place Saint-François', where: 'Grand Marché', hours: 'presque rien', shade: true },
          { name: 'Place Pépinet', where: 'Marché des Artisans', hours: 'presque rien', shade: true },
        ],
        tip: 'Sur l\'esplanade et à la Riponne, le soleil arrive vers midi : environ la moitié de la surface est au soleil de 13 h à 14 h 30. Le Grand Marché de Saint-François reste à l\'ombre, mais la promenade Derrière-Bourg, à quelques minutes à pied, garde environ 6 h de soleil.',
        note: 'Calcul de MeridianWay, sans lien avec l\'organisation de Bô Noël. Les nuages et les chalets ne sont pas comptés, et les autres sites (Portes de Saint-François, Bel-Air, Flon) ne sont pas calculés.',
        link: { label: 'Programme et horaires de Bô Noël', href: 'https://bo-noel.ch/' },
      },
      faq: [
        {
          q: 'Où trouver le soleil à Lausanne en hiver ?',
          a: 'Au bord du lac : le quai de Belgique et la place de la Navigation, à Ouchy, ont le soleil de 9 h à 16 h le 21 décembre, et dans le centre, la promenade Derrière-Bourg en garde environ 6 h.',
        },
        {
          q: 'À quelle heure les rues de Lausanne sont-elles le plus au soleil en hiver ?',
          a: 'Entre 12 h 15 et 14 h 45 : le 21 décembre, au moins une rue du centre sur quatre est au soleil pendant cette plage, contre moins d\'une sur six avant 10 h et après 15 h 30.',
        },
        {
          q: 'Combien de soleil reçoit une rue du centre de Lausanne en hiver ?',
          a: 'En moyenne 1 h 30 le 21 décembre et plus de 2 h 30 à la mi-février, et le jour le plus court, plus d\'une rue sur trois n\'en reçoit pas du tout.',
        },
        {
          q: 'Comment trouver un itinéraire au soleil à Lausanne ?',
          a: 'MeridianWay compare plusieurs chemins à pied selon la position du soleil et les ombres des bâtiments (données swisstopo) : entre la gare et la Riponne à 12 h 30 en décembre, le chemin au soleil en garde deux fois plus que le plus court, pour 5 minutes de marche en plus.',
        },
        {
          q: 'Quel marché de Bô Noël est le plus au soleil ?',
          a: 'L\'esplanade de la Cathédrale et la place de la Riponne, avec environ 2 h de soleil par ciel dégagé, surtout entre 13 h et 15 h. Le Grand Marché de la place Saint-François reste presque toute la journée à l\'ombre, mais la promenade Derrière-Bourg, à quelques minutes à pied, garde environ 6 h de soleil.',
        },
      ],
      method: 'Calculés le 28 octobre 2026 par le moteur de MeridianWay sur 102 km de rues, trottoirs et chemins du centre de Lausanne, de la gare à la Riponne et de Chauderon à la Cité. Chaque bâtiment compte pour la hauteur de son toit au-dessus de la rue (swissBUILDINGS3D et swissALTI3D de swisstopo), les arbres viennent d\'OpenStreetMap, sans leurs feuilles en hiver. Le soleil compte à partir de 5° au-dessus de l\'horizon. Les marchés de Bô Noël ont été calculés le 30 octobre 2026 pour le 20 novembre, le 1er et le 21 décembre, en comptant aussi les crêtes autour de la ville. Chiffres arrondis.',
    },
  },
};
