# Mobile-First Responsive UI Design

**Status:** Approved in conversation on 2026-07-16

**Scope:** All public portfolio route types and shared application chrome

**Primary viewport range:** 320–428 CSS pixels

## Objective

Rework the portfolio's mobile presentation so that every public route is easy
to scan, has a clear information hierarchy, and remains visually intact on
small screens. Preserve the portfolio's recognizable dark/light identity,
content, routes, SEO behavior, and desktop experience while replacing the
page-by-page mobile styling with one coherent responsive system.

The primary mobile journey is:

1. Understand who Martin is and what he does.
2. See credible project evidence.
3. Understand relevant experience and capabilities.
4. Contact Martin without friction.

## Current-State Evidence

The design was informed by a code review and rendered audits at 320 × 568 and
390 × 844 CSS pixels. The audit found systemic rather than isolated problems:

- `/experience` reached a 370-pixel document width in a 320-pixel viewport
  while reveal animations were offscreen.
- `/cases` used a fixed 160-pixel side image, leaving too little text width at
  320 pixels; long titles and descriptions were visibly clipped.
- `/showcases` used a five-line mobile hero title that consumed most of the
  initial viewport before project content appeared.
- `/about` presented a large image before any meaningful page context on the
  narrowest viewport.
- The contact page spent substantial initial vertical space on repeated brand
  chrome before the actionable content.
- Several visible controls were below the 44 × 44-pixel touch target baseline,
  including theme controls and compact project links.
- `AnimatedName` selected colors from the unresolved theme value, allowing dark
  text to appear against the dark system theme.
- Page-level loading and empty states were inconsistent. Unavailable read data
  could leave visually blank sections rather than useful fallbacks.

`/showcases` is the strongest existing visual reference: its single-column
mobile cards, clear contrast, and direct calls to action should influence the
rest of the application without being copied mechanically.

## Chosen Direction

Adopt a shared mobile-first responsive system and migrate all public route
types to it.

This approach was selected over:

- **Page-by-page patches:** initially smaller, but they would retain duplicated
  layout decisions and allow the same regressions to return.
- **A full visual redesign:** potentially more dramatic, but it would expand
  scope into brand and desktop redesign without being necessary to solve the
  mobile information and layout problems.

The chosen direction keeps the recognizable visual identity while making
substantial structural changes to mobile layout, typography, navigation,
cards, media, motion, and content ordering.

## Goals

- Support all public route types at 320, 375, 390, and 428 CSS pixels.
- Eliminate horizontal document overflow, clipped text, and component overlap.
- Present meaningful context and the primary action early on every page.
- Use consistent page width, spacing, typography, cards, and states.
- Preserve readable contrast and predictable theme behavior.
- Make all primary controls at least 44 × 44 CSS pixels.
- Respect reduced-motion preferences without hiding content.
- Preserve route contracts, API contracts, SEO metadata, and desktop utility.
- Add automated and visual evidence for the responsive behavior.

## Non-Goals

- Redesigning the backend, persistence, contact journal, deployment, or
  infrastructure layers.
- Changing public URLs or API response schemas.
- Rewriting portfolio content into a new CMS or data model.
- Rebranding the portfolio or replacing its full color identity.
- Removing desktop-only visual richness when it remains usable and performant.
- Adding unrelated features such as authentication, filtering, or analytics.

## Responsive Foundation

### Viewport and breakpoint behavior

Build mobile-first from 320 pixels. The default styles must work without a
breakpoint. Use breakpoints only to add space or columns when the available
width can support them:

- 320–639 pixels: one primary content column.
- 640–767 pixels: optional two-column groups for compact, bounded items.
- 768–1023 pixels: tablet composition.
- 1024 pixels and wider: preserve or refine the desktop composition.

No component may rely on a device-name check or `window.innerWidth` to size its
layout. CSS grid, flexbox, container width, `aspect-ratio`, and responsive image
sizes own presentation. JavaScript may manage interaction state, not core
geometry.

### Page width and spacing

- Use 20-pixel inline page padding below 640 pixels.
- Use a 72-rem shared maximum content width for standard sections and a 48-rem
  maximum line-length container for long prose.
- Use 64 pixels of vertical separation between major mobile sections and 48
  pixels only between directly related subsections within the same topic.
- Use a small spacing scale for component internals so related information is
  grouped consistently.
- Account for `env(safe-area-inset-top)` and
  `env(safe-area-inset-bottom)` in fixed chrome.

### Typography

Use a compact, fluid hierarchy that does not dominate narrow screens:

- Mobile page title: 32-pixel size with a 36-pixel line height; it increases
  from the tablet breakpoint without changing the mobile value.
- Mobile section title: 26-pixel size with a 32-pixel line height.
- Card title: 20-pixel size with a 26-pixel line height.
- Body copy: 16-pixel size with a 26-pixel line height.
- Supporting copy: 14-pixel size with a 22-pixel line height.

Long words, email addresses, titles, and user-provided descriptions must wrap
within their container. Heading widths must not depend on manual line breaks.

### Interaction and media

- Primary controls and menu items are at least 44 × 44 pixels.
- Mobile primary actions fill the content width below 640 pixels. Adjacent
  secondary actions stack at the same width.
- Images use declared aspect ratios and `next/image` responsive `sizes`.
- Media is placed above text in project cards below 640 pixels.
- Video embeds use a CSS aspect-ratio container and fill its width; they do not
  calculate dimensions from a window hook.
- Fixed chrome must not cover focused controls or anchored content.

### Theme and motion

- Components that depend on the active color mode use the resolved theme,
  including when the configured theme is `system`.
- Initial server and client rendering must not expose an illegible intermediate
  color state.
- Reveal motion is limited to opacity and transforms inside a clipped local
  wrapper; it must not enlarge the document's scrollable width.
- Content is visible immediately when `prefers-reduced-motion: reduce` is set.
- No essential information depends on hover, animation completion, or swiping.

## Component Architecture

The implementation should introduce or consolidate the following focused
primitives. Exact filenames may follow existing repository conventions, but
their responsibilities remain separate.

| Unit | Responsibility | Dependencies |
| --- | --- | --- |
| `SiteHeader` | Brand link, theme action, menu action, active route, safe-area handling | Next router, theme provider |
| `MobileMenu` | Full-screen navigation state, focus management, body scroll lock, route close behavior | `SiteHeader`, motion preference |
| `PageShell` | Page background, chrome offset, shared content width | Theme tokens |
| `ContentSection` | Consistent section spacing and optional semantic label | `PageShell` spacing tokens |
| `SectionHeader` | Eyebrow, title, description, optional action | Typography tokens |
| `ResponsiveReveal` | Safe progressive reveal that cannot affect document width | Framer Motion, reduced-motion preference |
| `ResponsiveMedia` | Stable image/video ratio, responsive sizing, loading surface | `next/image` or embed content |
| `ProjectCard` | Project media, title, summary, optional metadata, one clear action | `ResponsiveMedia`, route data |
| `ContactMethodCard` | Accessible `tel:` or `mailto:` action with label and value | Icon renderer |
| `SkillGrid` | Scannable skill groups with icons and concise labels | Icon renderer |
| `ViewState` | Loading skeleton, empty state, recoverable error, content branch | Query state |

Shared units must accept content through small typed props. They must not fetch
their own unrelated data or infer page-specific ordering. Pages remain
responsible for composing sections and mapping query results into component
props.

The existing `Navbar`, `Footer`, layout wrappers, case cards, and reveal
containers should be consolidated into these boundaries rather than wrapped in
another parallel component system.

## Page Designs

### Shared application chrome

Replace the two isolated floating controls with a compact, persistent mobile
header. Its content row is 64 pixels high plus the top safe-area inset. It
contains a recognizable brand link and separate 44-pixel theme and menu
controls. The header always uses a theme surface at 90 percent opacity with
backdrop blur so its contrast does not depend on scroll position.

The open menu uses a 95-percent-opaque theme surface, identifies the active
route, locks background scrolling, moves focus into the menu, returns focus to
the trigger on close, and closes after route selection. The footer stacks
brand, navigation, company information, and copyright without repeating an
oversized animated page title.

### Home (`/`)

The initial viewport presents the role eyebrow, primary statement, concise
summary, and primary project action before secondary content. On the narrowest
screens actions stack vertically. Skill chips follow the summary without
pushing every action below a full-screen hero.

The portrait remains part of the visual identity, but its crop and gradient
must keep text readable in both themes. Avoid a rigid `min-h-screen` composition
when content height exceeds the available small-screen height; use dynamic
viewport units only where they improve rather than constrain layout.

On mobile, replace the full-screen background-video coverflow with a vertical
stack of up to three featured project cards. Every project remains
understandable without swiping. Desktop retains the video/carousel treatment
at 1024 pixels and wider.

Page-link cards become one column on mobile. The showcases callout becomes a
shorter transition section rather than another near-full-screen hero. The final
pursuit section places prose before its supporting image pair.

### About (`/about`)

Present a page eyebrow/title and short introduction before the first large
image. Use a stable landscape ratio for the meeting image. Follow it with a
profile summary card that pairs the portrait, location/role summary, and the
first useful biographical context.

Split the biography into readable paragraphs rather than one centered text
block. Language proficiency becomes a compact card list with textual labels in
addition to the star representation. The professional timeline uses a vertical
mobile composition with date/company metadata before title and description.

### Experience (`/experience`)

Use a shorter hero with the cases action, title, summary, and a restrained stack
logo group. Each experience area is one column below 768 pixels: title, concise
overview, concrete strengths, scannable technology group, then media.

Replace the current dense icon/text pairs with `SkillGrid`. At 320 pixels it is
one column; it may become two columns only when each item retains a readable
label. Preserve the substantive content, but divide long prose into paragraphs
or short evidence points so readers can scan it without hiding essential
information behind interaction.

### Showcases (`/showcases`)

Keep the existing editorial direction while reducing the mobile page title so
the first project appears sooner. Use a 16:10 project-media ratio and the shared
`ProjectCard`. Each card has a visible title, concise summary, and one clear
action. Curated fallback cases remain available when live data is empty.

### Cases (`/cases`)

Treat this route as the complete project index. Below 640 pixels every case is
a vertical card with 16:10 media above content. Titles wrap normally, summaries
do not disappear behind overflow, and the card action is a real 44-pixel
target. From 640 pixels the same card uses its compact horizontal variant.

`/showcases` and `/cases` retain distinct editorial purposes but share the base
card implementation so narrow-screen fixes cannot diverge.

### Case detail (`/cases/[id]`)

Start with a compact breadcrumb/back action and a responsive hero rather than a
fixed 384-pixel image block. Present content in this order:

1. Overview.
2. My role.
3. Project details.
4. Media.
5. External links and the showcases return action.

The overview image and prose stack on mobile. Role items are semantic list
items with visible markers. Detail cards use one column first. Video fills a
CSS aspect-ratio wrapper. Link actions stack and fill available width on mobile.
The route must render deterministic loading/not-found behavior instead of an
indefinite loader.

### Contact (`/contact`)

Remove the large repeated-brand spacer above the contact purpose. Lead with the
page title, concise invitation, and two accessible contact method cards. Phone
and email use `tel:` and `mailto:` links with safe wrapping.

Place the form directly after the contact methods. Inputs are at least 48 pixels
high, textarea and labels retain adequate spacing, and the submit button is
full-width below 640 pixels. Pending, success, validation, and server-error
states remain in the form region, use `aria-live` where appropriate, and never
change the page width.

## Data and View-State Flow

Preserve all API endpoints, query hooks, serializers, and route contracts. The
UI flow is:

1. A page invokes the existing query hook or receives static props.
2. The page maps query/static data into a small view model.
3. `ViewState` selects loading, error, empty, fallback, or content rendering.
4. Presentational components receive only the data needed to render their
   section.

Use deterministic local fallback content for identity and curated-project
surfaces that must remain useful without live read data. For collection-only
sections where a fallback would be misleading, show a concise empty or
recoverable-error state. Loading skeletons reserve the final component's
approximate space to limit layout shift.

Errors must be contained to their section. A failed optional query must not
blank the page, hide navigation, or prevent static portfolio information from
rendering. The contact submission flow keeps its existing idempotency and
server behavior; only its visual state presentation changes.

## Accessibility and Interaction Requirements

- Use one page-level `h1` and preserve logical heading order.
- Use semantic `main`, `nav`, `section`, `article`, `footer`, lists, links, and
  buttons according to behavior.
- All controls have visible focus treatment in both themes.
- The menu supports keyboard open, traversal, Escape close, and focus return.
- Background content is not interactive while the modal menu is open.
- Icon-only controls have accurate accessible names.
- Color is not the only indicator for active, success, error, or proficiency
  state.
- Text and meaningful controls meet WCAG AA contrast targets.
- Touch targets meet the 44 × 44-pixel baseline without overlapping.
- Reduced-motion mode exposes all content immediately.

## Testing and Verification

### Automated responsive coverage

Extend Playwright coverage with deterministic mobile projects or parameterized
tests at:

- 320 × 568
- 375 × 667
- 390 × 844
- 428 × 926

Cover `/`, `/about`, `/experience`, `/contact`, `/showcases`, `/cases`, and one
representative `/cases/[id]` fixture. The case-detail fixture must use the
repository's deterministic test data path rather than a production dependency.

For every route and viewport, assert:

- `document.documentElement.scrollWidth <= window.innerWidth` after content and
  reveal states settle;
- primary headings, summaries, and actions are visible and not clipped;
- project titles and long contact values remain within their cards;
- navigation can open/close, locks background scroll, identifies the current
  route, and restores focus;
- primary interactive targets meet the 44-pixel minimum;
- reduced-motion content is immediately visible.

Add focused visual screenshot baselines for the home hero, open menu, experience
section, project cards, case detail, and contact form. Capture both dark and
light theme where contrast or imagery differs materially. Screenshot tests must
disable nondeterministic motion and use deterministic content.

### Existing quality gates

Run and pass the repository's relevant checks under Node 22.23.1:

- TypeScript typecheck.
- ESLint and Prettier checks.
- Unit tests.
- Existing public-route and asset e2e tests.
- New responsive e2e and visual tests.
- Production build.

### Manual visual audit

After automated checks pass, render every public route at 320 and 390 pixels in
the local browser. Verify the initial viewport, mid-page section transitions,
footer, open navigation, light/dark/system theme, reduced motion, long content,
and form states. Also spot-check tablet, 1024-pixel desktop, and 1440-pixel
desktop to prove the mobile work did not regress larger layouts.

## Acceptance Criteria

The design is complete only when all of the following are demonstrated:

1. Every named public route type renders without horizontal overflow at all
   four required mobile widths.
2. No title, description, email address, image, video, button, or card is
   visibly clipped or overlaps adjacent content.
3. Every page presents its purpose and primary next action before unrelated
   decorative or repeated content.
4. Shared header, menu, footer, spacing, typography, cards, and view states are
   used consistently.
5. All primary controls meet the touch-target baseline and have keyboard focus
   styles.
6. System theme resolves to legible colors, and reduced motion never leaves
   content hidden.
7. Loading, empty, fallback, and recoverable error states preserve useful page
   structure.
8. New responsive tests and screenshots pass alongside existing checks and the
   production build.
9. Manual mobile and desktop visual audits find no remaining broken layout or
   information-presentation regression in scope.

## Implementation Boundary and Sequence

The implementation plan should proceed from shared foundations outward:

1. Add responsive test harness and reproduce the known failures.
2. Establish global tokens, shell, header/menu, footer, theme, and motion.
3. Introduce shared section, media, project-card, skill-grid, contact-card, and
   view-state primitives.
4. Migrate home and project presentation.
5. Migrate About and Experience.
6. Migrate Contact and case detail.
7. Complete responsive/visual regression coverage and the full verification
   matrix.

Do not bundle backend, database, infrastructure, or unrelated content-system
changes into this work.
