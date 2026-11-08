/** The locator lines the waveform draws as selected, as "bar:pass" in drawing order. The dock shows no hint for the selection, so this is how tests read it. */
export function selectedLocators(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-slot="dock-locator"][data-state="selected"]')].map((el) => `${el.dataset.bar}:${el.dataset.pass}`)
}
