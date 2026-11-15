// Content of the Geneva page. Every figure comes from a run of the app's
// shade engine over the centre's streets, with each roof measured against the
// street's own altitude (swissBUILDINGS3D + swissALTI3D): change a number only
// from a new run.
//
// One block per season. `season` picks the one on the page: switch it to 'ete'
// in spring, once the summer block is written from summer figures.

import type { CityPage } from './types';

export const geneve: CityPage = {
  slug: 'geneve',
  name: 'Genève',
  lang: 'fr',
  computedOn: '2026-10-29',
  season: 'hiver',
  seasons: {
    hiver: {
      title: 'Itinéraires au soleil à Genève',
      metaTitle: 'Itinéraires au soleil à Genève en hiver : MeridianWay',
      metaDescription: 'Le 21 décembre, les parcs Mon-Repos et Perle du Lac ont 6 h de soleil, le parc La Grange 5 h, la promenade de la Treille plus de 4 h 30 et le parc des Bastions environ 3 h 30. Les heures, les quartiers et les endroits les plus ensoleillés de Genève, calculés avec les hauteurs de bâtiments swisstopo.',
      lede: [
        { text: 'Le 21 décembre, ' },
        { text: 'une rue du centre de Genève reçoit en moyenne plus d\'une heure et demie de soleil direct', strong: true },
        { text: ', d\'après les hauteurs de bâtiments swisstopo. MeridianWay trouve le chemin à pied qui en garde le plus.' },
      ],
      defaultMode: 'sun',
      glance: {
        heading: 'Le soleil à Genève le 21 décembre',
        shade: {
          title: 'Côté ombre',
          items: [
            { label: 'Rues du centre sans soleil de la journée', value: 'une sur trois (34 %)', bar: 34 },
            { label: 'Heures les plus sombres', value: 'avant 9 h et après 16 h' },
            { label: 'Quartiers les plus à l\'ombre', value: 'les Rues Basses (pratiquement pas de soleil direct), les Eaux-Vives, les Pâquis' },
            { label: 'Le Salève cache le soleil levant', value: 'jusque vers 8 h 45' },
          ],
        },
        sun: {
          title: 'Côté soleil',
          items: [
            { label: 'Soleil moyen d\'une rue du centre', value: 'plus de 1 h 30, plus de 2 h 30 à la mi-février' },
            { label: 'Rues du centre au soleil au meilleur moment', value: '28 % vers 13 h 45 (66 % le 21 juin)', bar: 28 },
            { label: 'Meilleures heures pour le soleil', value: 'de 10 h 45 à 14 h 45' },
            { label: 'Quartiers les plus ensoleillés', value: 'Cornavin, Saint-Gervais' },
          ],
        },
      },
      routes: {
        heading: 'Un trajet au soleil à Genève',
        items: [
          {
            from: { label: 'Gare Cornavin', lat: 46.20985, lng: 6.14153 },
            to: { label: 'Place du Bourg-de-Four', lat: 46.20032, lng: 6.14914 },
            when: { monthDay: '12-21', time: '12:30', label: 'le 21 décembre à 12 h 30' },
            summary: 'Le chemin au soleil garde deux fois plus de soleil que le chemin le plus à l\'ombre, pour le même temps de marche.',
            sunny: { label: 'Chemin au soleil', minutes: 20, km: '1,5' },
            other: { label: 'Chemin le plus à l\'ombre', minutes: 20, km: '1,5' },
          },
        ],
      },
      spots: {
        heading: 'Les 7 endroits les plus ensoleillés de Genève en hiver',
        intro: 'Heures de soleil le 21 décembre, entre 9 h et 16 h : avant et après, le soleil est trop bas pour compter.',
        items: [
          { name: 'Quai du Mont-Blanc', where: 'rive droite, au bord du lac', hours: 'près de 7 h' },
          { name: 'Île Rousseau', where: 'sur le Rhône, au pont des Bergues', hours: '6 h' },
          { name: 'Parcs Mon-Repos et Perle du Lac', where: 'rive droite, au bord du lac', hours: '6 h' },
          { name: 'Parc des Eaux-Vives', where: 'rive gauche, au bord du lac', hours: '6 h' },
          { name: 'Parc La Grange', where: 'rive gauche, à côté du parc des Eaux-Vives', hours: '5 h' },
          { name: 'Plaine de Plainpalais', where: 'au sud-ouest de la Vieille-Ville', hours: '5 h' },
          { name: 'Bains des Pâquis', where: 'la jetée, aux Pâquis', hours: '5 h' },
        ],
      },
      faq: [
        {
          q: 'Où trouver le soleil à Genève en hiver ?',
          a: 'Au bord du lac : le quai du Mont-Blanc a près de 7 h de soleil le 21 décembre, l\'île Rousseau et les parcs Mon-Repos et Perle du Lac environ 6 h, et la plaine de Plainpalais 5 h.',
        },
        {
          q: 'À quelle heure les rues de Genève sont-elles le plus au soleil en hiver ?',
          a: 'Entre 10 h 45 et 14 h 45 : le 21 décembre, plus d\'une rue du centre sur cinq est au soleil pendant cette plage, contre une sur sept au plus avant 9 h et après 16 h.',
        },
        {
          q: 'Combien de soleil reçoit une rue du centre de Genève en hiver ?',
          a: 'En moyenne plus d\'une heure et demie le 21 décembre et plus de 2 h 30 à la mi-février, et le jour le plus court, une rue sur trois n\'en reçoit pas du tout. Dans les Rues Basses, il n\'y a pratiquement pas de soleil direct.',
        },
        {
          q: 'Comment trouver un itinéraire au soleil à Genève ?',
          a: 'MeridianWay compare plusieurs chemins à pied selon la position du soleil et les ombres des bâtiments (données swisstopo) : entre la gare Cornavin et la place du Bourg-de-Four à 12 h 30 en décembre, le chemin au soleil garde deux fois plus de soleil que le chemin le plus à l\'ombre, pour le même temps de marche.',
        },
        {
          q: 'Quel parc de Genève est le plus au soleil en hiver ?',
          a: 'Les parcs Mon-Repos et Perle du Lac, sur la rive droite, et le parc des Eaux-Vives, sur la rive gauche, avec environ 6 h de soleil le 21 décembre. Le parc La Grange, voisin des Eaux-Vives, en a environ 5 h.',
        },
        {
          q: 'Le parc des Bastions et la promenade de la Treille sont-ils au soleil en hiver ?',
          a: 'Le parc des Bastions n\'a qu\'environ 3 h 30 de soleil le 21 décembre. La promenade de la Treille, en terrasse juste au-dessus, en a plus de 4 h 30. Même au bord du lac, le Jardin anglais en a moins de 3 h : les immeubles du quai Général-Guisan se dressent entre lui et le soleil.',
        },
      ],
      method: 'Calculés le 29 octobre 2026 par le moteur de MeridianWay sur 142 km de rues du centre de Genève, de Cornavin à Plainpalais et des Pâquis aux Eaux-Vives, toutes les 15 minutes le 21 décembre. Chaque bâtiment compte pour la hauteur de son toit au-dessus de la rue (swissBUILDINGS3D et swissALTI3D de swisstopo), les crêtes comptent jusqu\'à 40 km (Copernicus côté France), et les arbres viennent d\'OpenStreetMap, sans leurs feuilles en hiver. Le soleil compte à partir de 5° au-dessus de l\'horizon. Le modèle de swisstopo représente souvent un îlot entier comme un seul bâtiment, à la hauteur de sa partie la plus haute : les chiffres sont donc plutôt du côté de l\'ombre. Chiffres arrondis.',
    },
  },
};
