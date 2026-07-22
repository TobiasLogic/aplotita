const THEMES = [
  { value: 'teal', label: 'Aplótita Teal', accent: '#36D0D0' },
  { value: 'night', label: 'Night Blue', accent: '#3B6EA5' },
  { value: 'desert', label: 'Desert Red', accent: '#C24B3E' },
  { value: 'rust', label: 'Rust Orange', accent: '#C16A2E' },
  { value: 'pear', label: 'Pear Green', accent: '#A2C037' },
];

let current = THEMES[0];

export function themeOptions() {
  return THEMES.map((t) => ({ value: t.value, label: t.label }));
}

export function setTheme(value) {
  const found = THEMES.find((t) => t.value === value);
  if (found) current = found;
  return current;
}

export function currentTheme() {
  return current;
}

export function accent() {
  return current.accent;
}
