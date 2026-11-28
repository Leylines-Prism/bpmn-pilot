// Exemple « Plat du jour » de la fenêtre DMN (bouton Ouvrir un exemple d'une table vide, et aide).
//
// Le modèle vient du dossier starter des exemples officiels de dmn-js
// (https://github.com/bpmn-io/dmn-js-examples, licence MIT), copié dans examples/dish.dmn avec
// le type integer remplacé par number. Trois décisions reliées : la saison d'après la
// température, le nombre d'invités d'après le type de jour, puis le plat d'après les deux.
// En français, les noms et les valeurs sont traduits ; les expressions (season, guestCount…)
// restent les noms des variables. Chaque règle reçoit une annotation qui dit pourquoi.

import xml from './examples/dish.dmn?raw'
import { lang } from '../i18n/lang.js'

export const EXAMPLE_DECISION = 'dish-decision'

const FR = [
  ['name="Dish"', 'name="Plat du jour"'],
  ['name="Dish Decision"', 'name="Choisir le plat"'],
  ['name="Season decision"', 'name="Déterminer la saison"'],
  ['name="Guest Count"', 'name="Estimer le nombre d\'invités"'],
  ['name="Type of day"', 'name="Type de jour"'],
  ['label="Type of day"', 'label="Type de jour"'],
  ['name="Weather in Celsius"', 'name="Température (°C)"'],
  ['label="Weather in Celsius"', 'label="Température (°C)"'],
  ['name="Host"', 'name="Hôte"'],
  ['name="Guest Type"', 'name="Type d\'invités"'],
  ['label="Season"', 'label="Saison"'],
  ['label="season"', 'label="Saison"'],
  ['label="How many guests"', 'label="Nombre d\'invités"'],
  ['label="Guest count"', 'label="Nombre d\'invités"'],
  ['label="Dish"', 'label="Plat"'],
  ['"Winter"', '"Hiver"'],
  ['"Summer"', '"Été"'],
  ['"Spring"', '"Printemps"'],
  ['"Spareribs"', '"Travers de porc"'],
  ['"Pasta"', '"Pâtes"'],
  ['"Light salad"', '"Salade légère"'],
  ['"Beans salad"', '"Salade de haricots"'],
  ['"Stew"', '"Ragoût"'],
  ['"Steak"', '"Steak"'],
  ['"Weekday"', '"Semaine"'],
  ['"Holiday"', '"Férié"'],
  ['"Weekend"', '"Week-end"'],
  ['Week day or week end', 'Jour de semaine, férié ou week-end'],
]

// Annotation de chaque règle de la table du plat, en anglais et en français.
const NOTES = {
  'row-495762709-1': ['Winter, small group: a hearty dish', 'Hiver, petit groupe : un plat consistant'],
  'row-495762709-2': ['Winter, large group: easy to cook in quantity', 'Hiver, grand groupe : facile à cuisiner en quantité'],
  'row-495762709-3': ['Summer, large group: light and quick', 'Été, grand groupe : léger et rapide'],
  'row-495762709-7': ['Summer, small group', 'Été, petit groupe'],
  'row-445981423-3': ['Spring, small group', 'Printemps, petit groupe'],
  'row-445981423-4': ['Spring, large group', 'Printemps, grand groupe'],
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

export function exampleDishXml() {
  const fr = lang === 'fr'
  let out = xml
  for (const [id, [en, f]] of Object.entries(NOTES)) {
    out = out.replace(`<rule id="${id}">`, `<rule id="${id}">\n        <description>${esc(fr ? f : en)}</description>`)
  }
  if (fr) for (const [from, to] of FR) out = out.split(from).join(to)
  return out
}
