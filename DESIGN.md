# Madagamask design guide

Madagamask should feel fresh, clean, and clear. Achieve this through readable typography, thoughtful spacing, restrained color, and predictable interactions. Keep the interface and its implementation small enough to understand and maintain.

These rules apply to every new screen, element, and visual change. The [README](README.md) defines product scope and the [roadmap](ROADMAP.md) defines implementation milestones.

## Visual direction

- Give each screen a clear purpose and an obvious next action.
- Use generous spacing between sections and tighter spacing within related content.
- Establish hierarchy through type size, weight, alignment, and spacing. Use decoration sparingly.
- Start with neutral surfaces, readable text, subtle borders, and one accent color for primary actions and selection.
- Give success, warning, and error states consistent treatments with text that explains their meaning.
- Use a system font stack. Give balances and amounts clear prominence; keep labels and supporting text comfortably readable.
- Keep corner radii, control heights, icon proportions, and alignment consistent across screens.
- Use motion only when it clarifies a change, keeping it brief and respecting reduced-motion preferences.

Exact colors and measurements should be established together in the first implemented screens, then reused throughout the wallet.

## Small shared foundations

Maintain a compact set of CSS custom properties for colors, spacing, typography, radii, and control sizing. Add a token when it represents a meaningful shared decision. Keep values on a small, deliberate scale.

Begin with one shared stylesheet organized into tokens, base element styles, layout helpers, and reusable interface patterns. Split files when that improves navigation while retaining one source of truth for each pattern.

Style semantic HTML elements for common defaults. Introduce classes for recurring layout and visual roles. Prefer shallow selectors with predictable specificity. Keep dynamic state in semantic attributes or explicit state classes.

CSS should grow with distinct design needs, rather than with the number of screens. Judge its size by the amount of duplication and the clarity of its rules; a shorter file is useful when it remains readable.

## Reuse before adding

Before implementing any new UI:

1. Inspect existing screens, DOM-building helpers, shared classes, and design tokens.
2. Identify the existing pattern that fits the new content or interaction.
3. Compose existing elements and classes first.
4. If a pattern needs a variation, add a small, meaningful modifier to the shared pattern and check its existing uses.
5. Introduce a new pattern only when the need is distinct. Name it by its role so another screen can reuse it.

Keep shared patterns in shared code. Repeated markup and behavior can use small TypeScript functions with explicit inputs and event cleanup. Maintain the same DOM structure for the same interaction across screens.

When two implementations begin to serve the same purpose, consolidate them. When changing a design rule, update the existing rule and its consumers. Remove obsolete selectors, modifiers, and helpers as part of the same change.

## Core patterns

Build these as needed, using them consistently wherever they appear:

| Pattern | Shared behavior and appearance |
| --- | --- |
| Screen shell | Consistent header, content spacing, back navigation, and action placement |
| Buttons | One base treatment with clear primary, secondary, and destructive variants |
| Form fields | Persistent labels, consistent controls, help text, and nearby validation messages |
| List rows | Shared alignment for icons, names, secondary details, amounts, and row actions |
| Detail rows | Consistent label/value presentation for accounts, networks, fees, and permissions |
| Status messages | Consistent loading, empty, pending, success, warning, and error presentation |
| Dialogs and menus | Predictable dismissal, keyboard operation, focus placement, and focus restoration |

Build only the variants needed by actual screens. Keep layout helpers few and general, such as vertical stacks, horizontal rows, and label/value alignment.

## Wallet clarity

Keep account and network context easy to find. The home screen prioritizes balance, address, Send, Receive, Tokens, and Activity.

For confirmations, make the requesting site, action, account, and relevant network prominent. Present amounts and estimated fees with explicit units. Explain permissions in plain language and keep essential warnings visible before approval. Place advanced details behind a consistent disclosure control.

Use precise action labels such as "Send ETH", "Connect", or "Sign message". Distinguish a submitted transaction from a confirmed transaction. Explain uncertainty, including unavailable balances, stale estimates, and unknown transaction effects.

Handle long addresses, site names, token names, and large balances deliberately. Keep full security-relevant values inspectable and provide clear copy feedback. Show untrusted names and other remote text as text content.

## Interaction and accessibility

Use native buttons, inputs, links, headings, and other semantic elements. Provide visible keyboard focus, associated form labels, accessible names for icon controls, and sufficient contrast. Communicate state with text or symbols as well as color.

Preserve focus, cursor position, and entered values during background updates. Clean up event listeners and subscriptions when a screen closes. Make disabled and busy states understandable, and prevent repeated submission while an action is in progress.

Design for the narrow extension popup and the larger onboarding or confirmation window. Let content wrap and layouts adapt. Keep important information and controls reachable when text is enlarged or content is unusually long.

## Review every UI change

- Check which existing elements, classes, and helpers the change reuses.
- Justify each new selector or modifier with a distinct need; consolidate overlapping rules.
- Confirm that spacing, typography, colors, controls, and terminology match existing screens.
- Check affected shared patterns on their other screens.
- Exercise loading, empty, error, disabled, and success states that apply to the change.
- Inspect keyboard navigation, visible focus, enlarged text, and long content.
- Verify the actual interface in Chrome at the supported window sizes. Keep shared styles and assets included in the Firefox package; Firefox visual testing is deferred under the current roadmap.

Keep these checks proportional to the change. Preserve a small set of well-understood patterns as the wallet grows.
