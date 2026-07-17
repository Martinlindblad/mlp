# Home Portrait Visibility Design

**Status:** Approved in conversation and visual comparison on 2026-07-17

**Scope:** The opening hero on `/`

## Objective

Make Martin immediately recognizable on the home page without weakening the
hero copy or calls to action. Preserve the existing portrait asset, content,
theme support, routes, and social links.

## Current-State Evidence

The portrait is currently rendered as a full-hero background with 20 percent
opacity on mobile, 35 percent on small screens, and 75 percent only at the
large breakpoint. A nearly opaque horizontal gradient covers most of the same
area. In rendered checks at 390 × 844 and 1440 × 1000 CSS pixels, the combined
layers hid Martin's face behind the copy and dark surface. The use of
`object-contain` in a wide full-screen container also left unused space on
desktop instead of creating a deliberate portrait composition.

The source image is a sharp 1080 × 1440 portrait and does not need editing or
replacement.

## Considered Directions

1. **Dedicated portrait panel — selected.** Give the copy and portrait separate
   layout areas. This produces the most reliable visibility and keeps text
   contrast independent of the photograph.
2. **Editorial full-bleed photograph.** Keep the photograph as the hero
   background but constrain the dark overlay to the copy area. This is more
   dramatic but remains sensitive to text length and viewport shape.
3. **Vertically stacked story.** Place a wide portrait crop above the hero copy
   at every viewport. This is strongest on mobile but uses more vertical space
   and is less balanced on desktop.

The user selected the dedicated portrait panel in the visual companion and
confirmed the same choice in conversation.

## Chosen Composition

Replace the overlapping background layers with one responsive hero grid.

- The copy and portrait are siblings, so no text or gradient covers Martin's
  face.
- Below 768 pixels, the portrait appears first as a centered 4:5 card, followed
  by the copy and calls to action.
- At 768 pixels and above, the copy occupies the left column and the portrait
  occupies the right column.
- The portrait uses full opacity, `object-cover`, and a face-aware vertical
  position near the upper third of the source image.
- The portrait panel has a restrained radius, border, and shadow that work in
  both themes. These treatments frame the image without tinting it.
- The hero uses content-driven height rather than forcing the portrait and copy
  into a rigid full-screen overlay.

The existing name link remains above the hero grid. The role eyebrow, heading,
description, skill chips, calls to action, and social links retain their current
content and order within the copy column.

## Responsive Behavior

### Mobile

- Use the existing page padding and a maximum portrait width of 24 rem.
- Keep the full 4:5 portrait visible before the role statement.
- Stack primary actions when the available width cannot fit them without
  crowding.
- Avoid a viewport-height constraint that would crop either the portrait or the
  actions on short devices.

### Tablet and desktop

- Switch to two columns from 768 pixels when both copy and portrait remain
  readable.
- Bound the full hero to the existing 80-rem maximum width.
- Keep the copy column wider than the portrait column and maintain a clear gap
  between them.
- Limit the portrait panel height through its 4:5 aspect ratio instead of
  stretching it to the viewport.

## Image Delivery and Accessibility

- Continue using `next/image` with `priority` because the portrait is above the
  fold.
- Provide responsive `sizes` matching the full-width mobile card and desktop
  column.
- Preserve the descriptive alt text, "Portrait of Martin Lindblad."
- Do not encode essential text into the photograph or depend on the photograph
  for color contrast.
- Preserve keyboard focus styles and the accessible names of all hero links.

## Verification

The implementation must be verified at 390 × 844 and 1440 × 1000 CSS pixels in
both light and dark themes. At each size:

- Martin's face is unobstructed and visibly brighter than in the current hero.
- The portrait does not overlap the name, copy, actions, navigation, or social
  links.
- No horizontal document overflow is introduced.
- The portrait retains a stable 4:5 frame without distortion.
- All existing hero links remain present and operable.

Automated coverage should assert the responsive portrait structure and the
absence of the former faded background treatment. Existing type, lint, and
public-route checks must continue to pass.

## Non-Goals

- Replacing, retouching, or generating a new portrait.
- Rewriting hero copy or changing destination routes.
- Redesigning the global navigation, subsequent home-page sections, or the
  broader responsive system.
