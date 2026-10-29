// French typography for generated copy: no line break inside "1 h 30", "37 %",
// "1,4 km", nor before ":" or "?".
export function frTypo(text: string): string {
  return text
    .replace(/(\d) (?=(%|h\b|min\b|km\b|m\b|°C))/g, '$1 ')
    .replace(/(\bh) (?=\d)/g, '$1 ')
    .replace(/ ([:?!;])/g, ' $1');
}
