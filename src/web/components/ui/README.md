# UI primitives

Shared Svelte primitives for the DockScope frontend. Use these instead of
writing per-component rules for buttons, badges, and inputs.

    import { Button, Chip, Field, IconButton, MenuItem, Select } from './ui';
    import { Tab, TabBar, Text, TextButton, TextInput } from './ui';

Every variant here was derived from styling that already existed in the app, so
replacing a local rule with a primitive is a like-for-like swap, not a redesign.

## Button

| Prop                                       | Values                                          | Notes                                               |
| ------------------------------------------ | ----------------------------------------------- | --------------------------------------------------- |
| `variant`                                  | `secondary` (default), `primary`, `ghost`       | Shape and emphasis                                  |
| `tone`                                     | `accent` (default), `success`, `warn`, `danger` | Colour, independent of shape                        |
| `size`                                     | `sm`, `md` (default), `lg`                      | `sm` for inline row actions, `lg` for modal actions |
| `block`                                    | boolean                                         | Full width, for stacked action groups               |
| `title`, `shortcut`                        | strings                                         | Render a styled tooltip; see [Tooltips](#tooltips)  |
| `disabled`, `ariaLabel`, `type`, `onclick` |                                                 | Forwarded to the element                            |

Shape and colour are separate props so semantic actions compose:
`variant="secondary" tone="success"` is the green Up button,
`variant="ghost" tone="danger"` is a destructive action that stays neutral until
hover, and `variant="primary" tone="danger"` is a confirmed destructive submit.

## Chip

| Prop        | Values                                                            |
| ----------- | ----------------------------------------------------------------- |
| `tone`      | `neutral` (default), `accent`, `warn`, `danger`, `success`        |
| `uppercase` | Status badge styling rather than a metadata chip                  |
| `pill`      | Rounded pill with more padding, for prominent counts and statuses |
| `mono`      | Monospace, wraps; for fingerprints and hashes                     |

## TextInput

Bindable: `<TextInput bind:value placeholder="..." />`. Props: `size` (`md`,
`lg`), `invalid`, `mono`, `type`, `disabled`, `ariaLabel`, `onkeydown`.

Use the `oninput` callback instead of `bind:value` when writing into a dynamic
key, such as a record of form-field values.

## Select

Options are data, not `<option>` children, so the control owns its value:

```svelte
<Select bind:value={hostA} options={sources.map((s) => ({ value: s.id, label: s.label }))} />
```

Shares TextInput's surface and sizes (`md`, `lg`) so mixed forms line up.

## Field

Wraps any control with a label and a hint or error message. Pass the control as
children, so it works for inputs, selects, and checkboxes alike.

```svelte
<Field label="Catalog URL" error={problem}>
  <TextInput bind:value={draft} />
</Field>
```

## Text

The typography primitive. Every size maps onto the `--text-*` scale, so an
off-scale value cannot enter through it.

| Prop                       | Values                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `size`                     | `2xs` (8px), `xs` (9), `sm` (10), `base` (11, default), `md` (12), `lg` (13), `xl` (14), `2xl` (15), `3xl` (20) |
| `tone`                     | `primary` (default), `secondary`, `dim`, `accent`, `success`, `warn`, `danger`                                  |
| `weight`                   | `normal` (default), `medium`, `semibold`, `bold`                                                                |
| `as`                       | `span` (default), `div`, `p`, `h2`-`h4`, `label`, `strong`, `small`                                             |
| `mono`, `caps`, `truncate` | Monospace, uppercase with tracking, single-line ellipsis                                                        |

`as` is separate from `size` so a heading stays a heading for assistive
technology while its visual size is chosen independently.

```svelte
<Text as="h3" size="lg" weight="semibold">Catalogs</Text>
<Text size="sm" tone="dim" mono truncate>{fingerprint}</Text>
```

## Tokens

Primitives are built on the variables in `src/web/App.css`. Prefer a token over
a literal value, and add a token rather than hardcoding a new one. The
interactive-surface tokens (`--control-bg`, `--control-border`,
`--radius-control`, `--radius-chip`) exist because those values were previously
inlined in around two dozen places and drifted apart.

## IconButton

Square, icon-only, sized by its box rather than its padding.

| Prop                | Values                                           | Notes                                                                  |
| ------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| `variant`           | `bare` (default), `outline`, `accent`, `surface` | `surface` has a panel background, for controls floating over the graph |
| `size`              | number, default `26`                             | Pixel width and height                                                 |
| `glyphSize`         | number                                           | Font size for glyph children such as `&times;`; ignored for SVG icons  |
| `active`            | boolean                                          | Toggled-on state, rendered amber                                       |
| `danger`            | boolean                                          | Turns red on hover                                                     |
| `title`, `shortcut` | strings                                          | Render a styled tooltip; see [Tooltips](#tooltips)                     |

## TabBar and Tab

```svelte
<TabBar ariaLabel="Plugin views">
  <Tab active={tab === 'installed'} onclick={() => (tab = 'installed')}>Installed</Tab>
</TabBar>
```

`Tab` takes children rather than a label so it can hold an icon plus text.

## Tooltips

Every primitive that takes a `title` renders one: `Button`, `IconButton`,
`Chip`, `Tab`, `Text` and `TextButton`. `Button` and `IconButton` also take a
`shortcut` for a keyboard chip.

Passing `title` to a primitive never produces the browser's own tooltip; mixing
the two would give the same app two tooltip styles with different delays and
positions.

```svelte
<IconButton title="Zoom to fit" shortcut="F" onclick={zoomToFit}>…</IconButton>
```

On anything else, use the action directly:

```svelte
<script>
  import { tooltip } from '../lib/tooltip';
</script>

<span use:tooltip={'Bytes received since the container started'}>…</span>
<span use:tooltip={{ text: 'Play', shortcut: 'Space', placement: 'bottom' }}>…</span>
```

Four pieces, split so the logic worth testing stays free of the DOM:

| File                        | Role                                                       |
| --------------------------- | ---------------------------------------------------------- |
| `lib/tooltip.ts`            | The `use:tooltip` action: listeners, ARIA, reading `title` |
| `lib/tooltipPosition.ts`    | Pure placement maths (flip, clamp, arrow offset)           |
| `lib/tooltipSchedule.ts`    | Pure timing (open delay, warm window)                      |
| `components/Tooltip.svelte` | The single bubble, mounted once at the app root            |

Things worth knowing:

- **One bubble for the whole app**, rendered at the document root. Nesting a
  tooltip beside its trigger breaks the moment an ancestor sets `overflow:
hidden` or a property that creates a containing block, such as the status
  bar's `backdrop-filter`.
- **The action removes `title`** while attached, otherwise the browser's own
  tooltip appears alongside this one. It copies the text to `aria-label` first
  if the element has no other accessible name.
- **Hover and focus both open it**, so keyboard users get the description too.
  Escape, click, blur, scroll and resize all close it.
- **The first one waits 400ms; the next opens instantly** for half a second
  after. That is what makes a row of icon buttons feel like one control strip
  rather than a series of separate delays.
- `pointer-events: none` on the bubble, so it can never sit between the cursor
  and the control it describes.

## What is deliberately not a primitive

`StatusBar` keeps its own control rules. Its buttons are a distinct micro-control
language for a dense 9px bar (a recording toggle with a pulsing dot, a
line-through health-check toggle, 20x18 boxes, an inline link-style button).
Folding them in would either change how they look or add props that only one
component uses.

Layout-only styling stays with its component. Primitives are for the shapes that
repeat across the app, not for every rule.
