export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text !== undefined)
    element.textContent = text.replace(
      /[\u202a-\u202e\u2066-\u2069]/gu,
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
  if (className) element.className = className;
  return element;
}
export function button(
  label: string,
  action: () => void | Promise<void>,
  secondary = false,
) {
  const result = el(
    "button",
    label,
    `button${secondary ? " button-secondary" : ""}`,
  );
  result.type = "button";
  result.addEventListener("click", () => {
    void action();
  });
  return result;
}
export type Field = {
  key: string;
  label: string;
  type?: string;
  value?: string;
  optional?: boolean;
  help?: string;
};
export function form(
  fields: Field[],
  label: string,
  action: (values: Record<string, string>) => Promise<void>,
) {
  const result = el("form", undefined, "stack");
  const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
  for (const field of fields) {
    const wrapper = el("label", undefined, "stack field");
    wrapper.append(el("span", field.label));
    const input = field.type === "textarea" ? el("textarea") : el("input");
    if (input instanceof HTMLInputElement) input.type = field.type ?? "text";
    input.setAttribute("aria-label", field.label);
    input.name = field.key;
    input.required = !field.optional;
    input.value = field.value ?? "";
    input.autocomplete = "off";
    input.spellcheck = false;
    wrapper.append(input);
    if (field.help) wrapper.append(el("small", field.help));
    inputs.set(field.key, input);
    result.append(wrapper);
  }
  const submit = el("button", label, "button");
  submit.type = "submit";
  result.append(submit);
  result.addEventListener("submit", (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    const values = Object.fromEntries(
      [...inputs].map(([name, input]) => [name, input.value]),
    );
    void action(values).finally(() => {
      submit.disabled = false;
      for (const input of inputs.values())
        if (input instanceof HTMLInputElement && input.type === "password")
          input.value = "";
    });
  });
  return result;
}
