# Mobile-First Responsive UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every public page readable, navigable, accessible, and visually coherent from 320px mobile screens through desktop without changing routes, API contracts, or the established visual identity.

**Architecture:** Establish mobile-first layout, state, media, and card primitives; make the global chrome deterministic and accessible; then migrate one page family at a time behind Playwright contracts. Existing React Query hooks remain the data boundary, pages select a deliberate fallback or an honest loading/error/empty state, and presentational components receive typed view models rather than owning remote data.

**Tech Stack:** Next.js 15 Pages Router, React 18, TypeScript, Tailwind CSS 3, Framer Motion 8, React Query 3, Vitest, Playwright 1.61.

## Global Constraints

- Run all commands with Node `22.23.1` and Yarn `1.22.22`; do not add a package unless a task explicitly says so (none currently do).
- Preserve all public routes, API response contracts, contact submission behavior, SEO metadata, dark/light themes, and working desktop content.
- Treat `320x568`, `375x667`, `390x844`, and `428x926` as blocking mobile viewports. Also inspect `768x1024`, `1024x768`, and `1440x900` before completion.
- Below `640px`, use `20px` page gutters, stack media above text, keep touch targets at least `44x44px`, inputs at least `48px` high, and never allow `document.documentElement.scrollWidth > window.innerWidth`.
- Keep primary prose at or below `48rem`, general page content at or below `72rem`, major section spacing near `64px`, and related subsection spacing near `48px`.
- Mobile type contract: page title `32/36px`, section title `26/32px`, card title `20/26px`, body `16/26px`, supporting copy `14/22px`.
- Prefer CSS aspect-ratio and responsive layout utilities over window measurement. Do not add new JavaScript viewport-size hooks.
- Respect `prefers-reduced-motion`; content must remain visible and document width must not grow while reveal animations are idle.
- The deterministic browser fixture is the source of truth for database-backed e2e runs. Reuse `.github/workflows/ci.yml:124-207` and `tests/fixtures/seed-postgres.ts`; the representative case remains `/cases/64b000000000000000000009`.
- Follow red-green-refactor per task: add or extend the focused test, observe the expected failure, implement only that slice, run the focused test, then run `yarn typecheck && yarn lint` before committing.
- Keep commits scoped to one task. Do not stage unrelated user changes.

## Planned File Map

| Path | Responsibility |
| --- | --- |
| `src/components/Layouts/PageShell.tsx` | Shared page background, main landmark, header offset, and width boundary |
| `src/components/Layouts/ContentSection.tsx` | Shared `20px` mobile gutters and `72rem` section boundary |
| `src/components/SectionHeader.tsx` | Typed title/eyebrow/description hierarchy |
| `src/components/ViewState.tsx` | Deterministic loading, error, empty, and ready rendering |
| `src/components/BrandLink.tsx` | Stable, non-animated identity used by header/footer |
| `src/components/ProjectCard.tsx` | One responsive project/case card used by listings and mobile home |
| `src/components/SkillGrid.tsx` | Readable one/two-column skill presentation |
| `src/components/ContactMethodCard.tsx` | `tel:` and `mailto:` contact actions with large targets |
| `src/components/Cases/CaseDetailSections.tsx` | Semantic overview, role, details, media, and links sections |
| `src/content/fallbacks.ts` | Typed, intentional identity/page/project/pursuit fallbacks |
| `tests/e2e/helpers/responsive.ts` | Viewport matrix and reusable overflow/target assertions |
| `tests/e2e/mobile-responsive.spec.ts` | Page-family mobile contracts added incrementally |
| `tests/e2e/mobile-visual.spec.ts` | Focused light/dark screenshot baselines |
| `tests/unit/components/view-state.test.ts` | Pure state-selection contract |

---

### Task 1: Add Shared Layout, State, and Fallback Contracts

**Files:**

- Create: `src/components/Layouts/PageShell.tsx`
- Create: `src/components/Layouts/ContentSection.tsx`
- Create: `src/components/SectionHeader.tsx`
- Create: `src/components/ViewState.tsx`
- Create: `src/content/fallbacks.ts`
- Create: `tests/unit/components/view-state.test.ts`
- Modify: `src/hooks/useAboutQuery.tsx`
- Modify: `src/hooks/useLanguagesQuery.tsx`
- Modify: `src/hooks/usePageCardsQuery.tsx`
- Modify: `src/hooks/useProjectsAndCasesQuery.tsx`
- Modify: `src/hooks/usePursuitQuery.tsx`
- Modify: `src/hooks/useProfessionalTimelineQuery.tsx`
- Modify: `src/hooks/useSocialMediaLinksQuery.tsx`
- Modify: `src/hooks/useCollectionQuery.tsx`

**Interfaces:**

- Consumes: existing `InformationCard`, `CaseData`, `Pursuit`, and profile types from `types/DBTypes.ts`; React Query's `isLoading` and `isError` flags.
- Produces: `ViewStatus`, `getViewStatus`, `PageShell`, `ContentSection`, `SectionHeader`, and typed fallback exports used by later tasks.

- [ ] **Step 1: Write the failing state-selection unit test.**

```ts
// tests/unit/components/view-state.test.ts
import { describe, expect, it } from 'vitest';
import { getViewStatus } from '../../../src/components/ViewState';

describe('getViewStatus', () => {
  it.each([
    [{ isLoading: true, isError: false, hasData: false }, 'loading'],
    [{ isLoading: false, isError: true, hasData: false }, 'error'],
    [{ isLoading: false, isError: false, hasData: false }, 'empty'],
    [{ isLoading: false, isError: false, hasData: true }, 'ready'],
  ] as const)('maps %o to %s', (input, expected) => {
    expect(getViewStatus(input)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because `ViewState` does not exist.**

Run: `yarn test:unit tests/unit/components/view-state.test.ts`

Expected: FAIL with a module-resolution error for `src/components/ViewState.tsx`.

- [ ] **Step 3: Implement the small shared primitives.**

```tsx
// src/components/ViewState.tsx
import type { ReactNode } from 'react';

export type ViewStatus = 'loading' | 'error' | 'empty' | 'ready';

export const getViewStatus = ({
  isLoading,
  isError,
  hasData,
}: {
  isLoading: boolean;
  isError: boolean;
  hasData: boolean;
}): ViewStatus => {
  if (isLoading) return 'loading';
  if (isError) return 'error';
  if (!hasData) return 'empty';
  return 'ready';
};

export default function ViewState({
  status,
  children,
  loadingLabel = 'Loading content…',
  errorMessage = 'This content could not be loaded right now.',
  emptyMessage = 'No content is available yet.',
}: {
  status: ViewStatus;
  children: ReactNode;
  loadingLabel?: string;
  errorMessage?: string;
  emptyMessage?: string;
}) {
  if (status === 'loading') {
    return <div role="status" className="min-h-24 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800"><span className="sr-only">{loadingLabel}</span></div>;
  }
  if (status === 'error') return <p role="alert" className="text-sm leading-[22px] text-red-700 dark:text-red-300">{errorMessage}</p>;
  if (status === 'empty') return <p className="text-sm leading-[22px] text-gray-600 dark:text-gray-300">{emptyMessage}</p>;
  return <>{children}</>;
}
```

```tsx
// src/components/Layouts/PageShell.tsx
import type { ReactNode } from 'react';

export default function PageShell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <main className={`min-h-screen overflow-x-clip bg-gray-100 pt-[calc(4rem+env(safe-area-inset-top))] text-gray-900 dark:bg-gray-900 dark:text-gray-100 ${className}`}>{children}</main>;
}
```

```tsx
// src/components/Layouts/ContentSection.tsx
import type { ElementType, ReactNode } from 'react';

export default function ContentSection({ children, className = '', as: Tag = 'section' }: { children: ReactNode; className?: string; as?: ElementType }) {
  return <Tag className={`mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 lg:px-10 ${className}`}>{children}</Tag>;
}
```

```tsx
// src/components/SectionHeader.tsx
export default function SectionHeader({ title, eyebrow, description, as: Tag = 'h2' }: { title: string; eyebrow?: string; description?: string; as?: 'h1' | 'h2' | 'h3' }) {
  return (
    <header className="max-w-3xl">
      {eyebrow ? <p className="mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow}</p> : null}
      <Tag className={Tag === 'h1' ? 'text-[32px] font-bold leading-9 sm:text-5xl sm:leading-tight' : 'text-[26px] font-bold leading-8 sm:text-4xl sm:leading-tight'}>{title}</Tag>
      {description ? <p className="mt-4 max-w-2xl text-base leading-[26px] text-gray-700 dark:text-gray-300">{description}</p> : null}
    </header>
  );
}
```

Use these exact typed fallbacks; they consolidate the existing page-local values and give every later page a stable source:

```ts
// src/content/fallbacks.ts
import type {
  InformationCard,
  ProfessionalProfileintroduction,
  Pursuit,
} from 'src/types/DBTypes';

export type ProjectSummary = {
  _id: string;
  title: string;
  description: string;
  imageSource: string;
  href?: string;
};

export const fallbackIntroduction: ProfessionalProfileintroduction = {
  _id: 'fallback-introduction',
  name: 'Martin',
  surname: 'Lindblad',
  title: 'Front-end Developer',
  info: 'Stockholm-based front-end developer building accessible, reliable product experiences with React, React Native, Next.js, TypeScript, and modern API integrations.',
  key: 'introduction',
};

export const fallbackPageCards: InformationCard[] = [
  { _id: 'fallback-about', title: 'About', description: 'Read about my background, languages, and professional journey.', link: '/about', key: 'about', type: 'introdcution' },
  { _id: 'fallback-experience', title: 'Experience', description: 'Explore the tools, platforms, and product work behind my experience.', link: '/experience', key: 'experience', type: 'introdcution' },
  { _id: 'fallback-contact', title: 'Contact', description: 'Start a conversation about a role, project, or collaboration.', link: '/contact', key: 'contact', type: 'introdcution' },
];

export const fallbackProjects: ProjectSummary[] = [
  { _id: 'fallback-imaginecare', title: 'ImagineCare', description: 'A healthcare product where I worked with React Native interfaces, API integration, and reliable mobile flows.', imageSource: '/images/cases/imaginecare.webp', href: '/cases' },
  { _id: '657eed6741ee78bde91c1c3e', title: 'Mackmyra', description: 'A React Native marketplace experience for ordering personalized whisky casks.', imageSource: '/images/cases/mackmyra.webp' },
  { _id: '657eef1d41ee78bde91c1c42', title: 'Livsstilsverktyget', description: 'A health research app built around recurring user input, clear flows, and maintainable mobile UI.', imageSource: '/images/cases/livsstilsverktyget.webp' },
];

export const fallbackPursuit: Pursuit = {
  _id: 'fallback-pursuit',
  title: 'Useful product experiences',
  description: 'Building accessible products with dependable operations.',
  leftImageSource: '/images/laptop.webp',
  rightImageSource: '/images/phone.webp',
};
```

- [ ] **Step 4: Make query failures observable.**

For all eight hooks listed above, remove the terminal `.catch(() => undefined)` and add `{ retry: false }` to `useQuery`. Preserve each existing endpoint, return type, collection sort, and query key. For example, `useProjectsAndCasesQuery.tsx` must become:

```tsx
import axios from 'axios';
import { useQuery } from 'react-query';
import { CaseData } from 'src/types/DBTypes';

const getProjectsAndCases = () =>
  axios
    .get<CaseData[]>('/api/projectsAndCases', { headers: { accept: 'application/json' } })
    .then(({ data }) => data);

const useProjectsAndCasesQuery = () =>
  useQuery(['getProjectsAndCases'], getProjectsAndCases, { retry: false });

export default useProjectsAndCasesQuery;
```

Apply the same mechanical error-propagation shape to the other seven hooks; `useProfessionalTimelineQuery` must still sort by `index`, `useAboutQuery` must still select the requested key, and `useCollectionQuery` must still select `data[0]`.

- [ ] **Step 5: Run focused and static checks.**

Run: `yarn test:unit tests/unit/components/view-state.test.ts && yarn typecheck && yarn lint`

Expected: PASS. Confirm lint reports no new hook or import warnings.

- [ ] **Step 6: Commit the primitives.**

```bash
git add src/components/Layouts/PageShell.tsx src/components/Layouts/ContentSection.tsx src/components/SectionHeader.tsx src/components/ViewState.tsx src/content/fallbacks.ts src/hooks tests/unit/components/view-state.test.ts
git commit -m "refactor: add responsive layout and view-state primitives"
```

---

### Task 2: Make Motion and Global Styles Safe at 320px

**Files:**

- Create: `tests/e2e/helpers/responsive.ts`
- Create: `tests/e2e/mobile-responsive.spec.ts`
- Modify: `src/components/Layouts/AnimatedFadeInContainer.tsx`
- Modify: `src/components/ThemeButton.tsx`
- Modify: `src/styles/base.css`

**Interfaces:**

- Consumes: Framer Motion `useReducedMotion`; the exact mobile viewport matrix.
- Produces: a reusable reduced-motion page setup, horizontal-overflow assertion, and minimum-target assertion.

- [ ] **Step 1: Add reusable Playwright assertions.**

```ts
// tests/e2e/helpers/responsive.ts
import { expect, type Locator, type Page } from '@playwright/test';

export const mobileViewports = [
  { name: '320', width: 320, height: 568 },
  { name: '375', width: 375, height: 667 },
  { name: '390', width: 390, height: 844 },
  { name: '428', width: 428, height: 926 },
] as const;

export async function openReducedMotionPage(page: Page, path: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const response = await page.goto(path, { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);
}

export async function expectNoHorizontalOverflow(page: Page) {
  const width = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  expect(width.document, JSON.stringify(width)).toBeLessThanOrEqual(width.viewport);
}

export async function expectMinimumTarget(locator: Locator, size = 44) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(size);
  expect(box!.height).toBeGreaterThanOrEqual(size);
}
```

- [ ] **Step 2: Write the failing overflow/motion test.**

Append this first block to `tests/e2e/mobile-responsive.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { expectMinimumTarget, expectNoHorizontalOverflow, mobileViewports, openReducedMotionPage } from './helpers/responsive';

test.describe('global mobile foundations', () => {
  for (const viewport of mobileViewports) {
    test(`experience fits ${viewport.name}px with reduced motion`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openReducedMotionPage(page, '/experience');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }

  test('theme control meets the minimum target at 320px', async ({ page }) => {
    await page.setViewportSize(mobileViewports[0]);
    await openReducedMotionPage(page, '/showcases');
    await expectMinimumTarget(page.getByRole('button', { name: /switch to/i }));
  });
});
```

- [ ] **Step 3: Run and observe the existing failure.**

Run in the seeded browser-test environment: `yarn test:e2e tests/e2e/mobile-responsive.spec.ts --grep "global mobile foundations"`

Expected before implementation: FAIL at 320px/390px because off-screen reveal transforms enlarge the document and FAIL because the theme button is `40x40px`.

- [ ] **Step 4: Make reveal motion width-safe and reduced-motion-safe.**

In `AnimatedFadeInContainer.tsx`, import `useReducedMotion`, assign `const shouldReduceMotion = useReducedMotion()`, change horizontal initial offsets from `70` to `24`, and use these exact motion props on the animated branch:

```tsx
data-reveal
initial={shouldReduceMotion ? false : 'hidden'}
animate={shouldReduceMotion || isInView ? 'visible' : 'hidden'}
style={{ ...styleProp, contain: 'paint' }}
```

When reduced motion is on, the `visible` transition must use `{ duration: 0, delay: 0 }`. Keep hover/click behavior and `type="Cancel"` behavior intact.

- [ ] **Step 5: Apply mobile tokens and target sizes.**

In `ThemeButton.tsx`, change the button to `min-h-11 min-w-11` and add visible keyboard focus classes. In `base.css`, add:

```css
:root {
  --site-header-height: 4rem;
  --page-gutter: 1.25rem;
  --content-width: 72rem;
  --prose-width: 48rem;
}

body { overflow-wrap: anywhere; }

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
```

Do not rely on `html { overflow-x: hidden; }` as the fix; the Playwright width assertion must pass because content is within the viewport.

- [ ] **Step 6: Run focused and static checks, then commit.**

Run: `yarn test:e2e tests/e2e/mobile-responsive.spec.ts --grep "global mobile foundations" && yarn typecheck && yarn lint`

Expected: PASS at all four viewports.

```bash
git add tests/e2e/helpers/responsive.ts tests/e2e/mobile-responsive.spec.ts src/components/Layouts/AnimatedFadeInContainer.tsx src/components/ThemeButton.tsx src/styles/base.css
git commit -m "fix: make responsive motion width safe"
```

---

### Task 3: Replace Floating Controls with an Accessible Site Header and Menu

**Files:**

- Create: `src/components/BrandLink.tsx`
- Modify: `src/pages/_app.tsx`
- Modify: `src/sections/Navigation/Navbar.tsx`
- Modify: `src/sections/Navigation/Nav.tsx`
- Modify: `src/sections/Navigation/NavMenuItem.tsx`
- Modify: `src/sections/Navigation/Toggle.tsx`
- Modify: `src/sections/Footer/Footer.tsx`
- Modify: `src/components/AnimatedComponents/AnimatedName.tsx`
- Modify: `tests/e2e/mobile-responsive.spec.ts`

**Interfaces:**

- Consumes: Next router `pathname` and `routeChangeComplete`; resolved theme; existing `Logo` SVG.
- Produces: one `64px + safe-area` header, opaque mobile menu, active-route semantics, scroll lock, Escape close, focus trap/return, and static brand identity.

- [ ] **Step 1: Extend the e2e contract before changing the header.**

Append a `mobile navigation` describe block covering this exact sequence at `320x568`:

```ts
test('menu opens accessibly, traps focus, closes, and restores focus', async ({ page }) => {
  await page.setViewportSize(mobileViewports[0]);
  await openReducedMotionPage(page, '/');
  const toggle = page.getByRole('button', { name: 'Open navigation menu' });
  await expectMinimumTarget(toggle);
  await toggle.click();
  await expect(page.getByRole('dialog', { name: 'Site navigation' })).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await expect(page.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('link', { name: 'Contact' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Site navigation' })).toBeHidden();
  await expect(toggle).toBeFocused();
});
```

Also assert that the site header and both theme/menu controls fit within the viewport and meet `44x44px`.

- [ ] **Step 2: Run and confirm the missing dialog/focus/lock failure.**

Run: `yarn test:e2e tests/e2e/mobile-responsive.spec.ts --grep "mobile navigation"`

Expected: FAIL because the current clipped overlay has no dialog semantics, scroll lock, focus trap, or return-focus behavior.

- [ ] **Step 3: Add a stable brand and render the header before page content.**

`BrandLink` must render a single link to `/`, the existing logo at `28x28px`, and `Martin Lindblad` as visible text on `sm` and wider. It must not fetch, animate characters, or create a heading.

In `_app.tsx`, render `<Navbar />`, then `<Component />`, then `<Footer />`. Configure `QueryClient` with `defaultOptions.queries.retry = false`. The `PageShell` top padding owns header clearance.

- [ ] **Step 4: Implement menu state and accessibility in `Navbar.tsx`.**

Replace `useCycle` with `useState(false)`. Use refs for the open button and menu container. On open: save the previously focused element, set `document.body.style.overflow = 'hidden'`, focus the first route, listen for `Escape`, and wrap `Tab`/`Shift+Tab` between focusable menu elements. On close/unmount: restore the prior overflow value, remove listeners, set menu closed, and focus the trigger. Subscribe to `router.events.routeChangeComplete` and close without stealing focus after navigation.

Render this hierarchy:

```tsx
<header data-testid="site-header" className="fixed inset-x-0 top-0 z-50 h-[calc(4rem+env(safe-area-inset-top))] border-b border-gray-200/70 bg-white/90 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-gray-700/70 dark:bg-gray-900/90">
  <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8 lg:px-10">
    <BrandLink />
    <div className="flex items-center gap-2"><ThemeButton /><MenuToggle /></div>
  </div>
</header>
{isOpen ? <div role="dialog" aria-modal="true" aria-label="Site navigation" className="fixed inset-0 z-40 bg-white/[0.97] pt-[calc(4rem+env(safe-area-inset-top))] dark:bg-gray-900/[0.97]"><Navigation /></div> : null}
```

Use Framer Motion only for opacity/vertical movement no greater than `12px`; bypass it when reduced motion is requested.

- [ ] **Step 5: Simplify navigation items and footer identity.**

`Nav.tsx` receives `{ onNavigate, firstItemRef }`, uses `router.pathname`, and renders Home, About, Experience, Showcases, Cases, Contact. `NavMenuItem.tsx` renders one full-width `min-h-14` link, sets `aria-current="page"` for the active route (case detail activates Cases), and calls `onNavigate`. Remove scale-on-hover from the list item.

`Toggle.tsx` becomes a normal in-header `44x44px` button, keeps `aria-expanded`, and adds `aria-controls="site-navigation"`. `Footer.tsx` uses `BrandLink` and no remote identity query. Until Task 10 removes it, update `AnimatedName.tsx` to use `resolvedTheme` so remaining pages are legible under system-dark mode.

- [ ] **Step 6: Verify navigation, public routes, and commit.**

Run: `yarn test:e2e tests/e2e/mobile-responsive.spec.ts --grep "mobile navigation" && yarn test:e2e tests/e2e/public-routes.spec.ts && yarn typecheck && yarn lint`

Expected: PASS. Manually keyboard-test open → six links → close at 320px.

```bash
git add src/components/BrandLink.tsx src/pages/_app.tsx src/sections/Navigation src/sections/Footer/Footer.tsx src/components/AnimatedComponents/AnimatedName.tsx tests/e2e/mobile-responsive.spec.ts
git commit -m "feat: add accessible responsive site navigation"
```

---

### Task 4: Unify Showcases and Cases with One Responsive Project Card

**Files:**

- Create: `src/components/ProjectCard.tsx`
- Modify: `src/pages/showcases.tsx`
- Modify: `src/pages/cases/index.tsx`
- Modify: `tests/e2e/mobile-responsive.spec.ts`
- Delete: `src/components/CaseItem.tsx`

**Interfaces:**

- Consumes: `_id`, optional `caseId`, `title`, `description`, and `imageSource` from API or curated fallback.
- Produces: `ProjectCardProps` and deterministic `/cases/:id` links; vertical `<640px`, horizontal `>=640px`.

- [ ] **Step 1: Add failing projects-list contracts.**

At all four mobile viewports, test `/showcases` and `/cases` for one visible `h1`, no overflow, all cards within the viewport, a `16/10` image frame, and a `View case` link whose box is at least `44px` high. At `768x1024`, assert the first `/cases` card uses a two-column grid.

Use `data-testid="project-card"` and `data-testid="project-media"` for geometry only; keep semantic role assertions for content and links.

- [ ] **Step 2: Run and observe the current 320px clipping failure.**

Run: `yarn test:e2e tests/e2e/mobile-responsive.spec.ts --grep "project listings"`

Expected: FAIL because `CaseItem` reserves a fixed `160px` side image and its content/link clips at 320px.

- [ ] **Step 3: Implement `ProjectCard`.**

```tsx
import Image from 'next/image';
import Link from 'next/link';

export type ProjectCardProps = {
  id: string;
  title: string;
  description: string;
  imageSource?: string;
  href?: string;
  featured?: boolean;
};

export default function ProjectCard({ id, title, description, imageSource, href = `/cases/${id}`, featured = false }: ProjectCardProps) {
  return (
    <article data-testid="project-card" className={`grid min-w-0 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 ${featured ? 'sm:grid-cols-[minmax(0,1.15fr)_minmax(16rem,0.85fr)]' : 'sm:grid-cols-[minmax(13rem,0.8fr)_minmax(0,1.2fr)]'}`}>
      <div data-testid="project-media" className="relative aspect-[16/10] min-w-0 bg-gray-200 dark:bg-gray-700">
        {imageSource ? <Image src={imageSource} alt="" fill sizes="(max-width: 639px) calc(100vw - 40px), 40vw" className="object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-gray-600 dark:text-gray-300">Project preview unavailable</div>}
      </div>
      <div className="flex min-w-0 flex-col p-5 sm:p-6">
        <h2 className="text-xl font-bold leading-[26px]">{title}</h2>
        <p className="mt-3 line-clamp-4 text-base leading-[26px] text-gray-700 dark:text-gray-300">{description}</p>
        <Link data-primary-action href={href} className="mt-5 inline-flex min-h-11 w-fit items-center rounded-lg px-4 font-semibold text-primary outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-primary">View case<span className="sr-only">: {title}</span></Link>
      </div>
    </article>
  );
}
```

If Tailwind's configured line-clamp plugin is absent, omit `line-clamp-4`; do not add a dependency.

- [ ] **Step 4: Migrate both pages.**

Both pages must use `PageShell`, `ContentSection`, `SectionHeader`, `ViewState`, the shared curated project fallbacks, and a one-column `gap-6 sm:gap-8`. Preserve Showcases' editorial introduction but reduce it to a `32/36px` mobile `h1`; preserve the Cases page as the complete index. Use API data when non-empty, curated fallbacks only for project listings, and show the error message alongside fallback content rather than blanking the page.

Remove the local `CaseItem`/`ShowCaseItem`, local fallback arrays, local ID helpers, and all `AnimatedName` imports. Delete `src/components/CaseItem.tsx` only after `rg "components/CaseItem" src` returns no matches.

- [ ] **Step 5: Verify both page families and commit.**

Run: `yarn test:e2e tests/e2e/mobile-responsive.spec.ts --grep "project listings" && yarn test:e2e tests/e2e/public-routes.spec.ts --grep "showcases|cases" && yarn typecheck && yarn lint`

Expected: PASS at mobile and tablet widths.

```bash
git add src/components/ProjectCard.tsx src/pages/showcases.tsx src/pages/cases/index.tsx tests/e2e/mobile-responsive.spec.ts
git rm src/components/CaseItem.tsx
git commit -m "refactor: unify responsive project cards"
```

---

### Task 5: Recompose the Home Page Around the Mobile Reading Order

**Files:**

- Modify: `src/pages/index.tsx`
- Modify: `src/components/About/HeroIntroduction.tsx`
- Modify: `src/sections/Cases/CaseCarouselBlock.tsx`
- Modify: `src/components/CaseCarousel.tsx`
- Modify: `src/components/CaseCarouselItem.tsx`
- Modify: `src/sections/CentralContentPageLinks.tsx`
- Modify: `src/components/PageLinkCard.tsx`
- Modify: `src/sections/Cases/AllShowcasesSection.tsx`
- Modify: `src/sections/MainPage/FrontendDeveloperPursuit.tsx`
- Modify: `tests/e2e/mobile-responsive.spec.ts`

**Interfaces:**

- Consumes: existing home queries plus identity/page/project/pursuit fallbacks.
- Produces: identity → projects → experience links → showcases → pursuit reading order; project cards on mobile and existing rich carousel/video only at `lg`.

- [ ] **Step 1: Add failing home contracts.**

At `320x568` and `390x844`, assert:

1. the hero `h1`, portrait, intro, and both CTAs are visible in source order;
2. CTAs are full-width, stacked, and at least `44px` high;
3. `[data-testid="mobile-featured-projects"]` is visible and the desktop carousel/video is hidden;
4. three page-link cards are one column;
5. pursuit prose appears before pursuit images;
6. the page has no horizontal overflow.

At `1024x768`, assert the desktop project experience is visible and the mobile project list is hidden.

- [ ] **Step 2: Run and confirm current rigid hero/carousel failures.**

Run: `yarn test:e2e tests/e2e/mobile-responsive.spec.ts --grep "home mobile flow"`

Expected: FAIL on CTA geometry, content order, and missing mobile project list.

- [ ] **Step 3: Rebuild the hero as content-driven layout.**

Keep the current portrait, introduction, and CTA labels/links. Remove duplicate brand-name spacer and rigid `min-h-screen`. The hero outer structure must be:

```tsx
<ContentSection className="grid items-center gap-8 pb-12 pt-10 sm:gap-10 md:grid-cols-[minmax(0,1fr)_minmax(16rem,0.75fr)] md:py-20">
  <div className="order-2 min-w-0 md:order-1">
    <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">Frontend and mobile developer</p>
    <h1 className="mt-3 text-[32px] font-bold leading-9 sm:text-5xl sm:leading-tight">React and mobile interfaces built for real users.</h1>
    <p className="mt-5 max-w-2xl text-base leading-[26px] text-gray-700 dark:text-gray-300">{personalInfoData.info}</p>
    <div className="mt-7 grid gap-3 sm:flex">
      <Link href="/showcases" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-700 px-5 font-semibold text-white">View case studies</Link>
      <Link href="/experience" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-gray-400 px-5 font-semibold">See experience</Link>
      <Link href="/contact" className="inline-flex min-h-11 items-center justify-center rounded-lg px-5 font-semibold">Contact Martin</Link>
    </div>
  </div>
  <div className="order-1 mx-auto aspect-[4/5] w-full max-w-sm overflow-hidden rounded-2xl md:order-2">
    <Image src="/images/profilepicture.webp" alt="Portrait of Martin Lindblad" fill priority sizes="(max-width: 767px) calc(100vw - 40px), 36vw" className="object-cover object-bottom" />
  </div>
</ContentSection>
```

- [ ] **Step 4: Split mobile projects from desktop motion.**

In `CaseCarouselBlock`, derive one `projects` array from query data or `fallbackProjects`. Render:

```tsx
<div data-testid="mobile-featured-projects" className="grid gap-6 lg:hidden">
  {projects.slice(0, 3).map((project) => <ProjectCard key={String(project._id)} id={String(project._id)} title={project.title} description={project.description} imageSource={project.imageSource} href={'href' in project ? project.href : undefined} />)}
</div>
<div data-testid="desktop-featured-projects" className="hidden lg:block">
  <div className="relative aspect-video overflow-hidden rounded-2xl">
    <video autoPlay loop muted playsInline className="h-full w-full object-cover"><source src="/assets/man.mp4" type="video/mp4" /></video>
    <div className="absolute inset-0 bg-gradient-to-b from-gray-900/70 to-gray-500/50" />
    <div className="absolute inset-0"><CaseCarousel /></div>
  </div>
</div>
```

The video must use `aspect-video`, `w-full`, and `object-cover`; remove fixed pixel heights. Keep `CaseCarousel` and `CaseCarouselItem` desktop-only and remove mobile-specific sizing assumptions.

- [ ] **Step 5: Normalize supporting home sections.**

`CentralContentPageLinks` must use a one-column grid below `md`, page-card fallbacks, and `ViewState`. `PageLinkCard` must use width-safe reveal motion and a full-card link with at least `44px` height. Reduce `AllShowcasesSection` from `py-24/py-56` to `py-16 sm:py-24` and use `26/32px` mobile heading. In `FrontendDeveloperPursuit`, replace the `{}` default with the typed pursuit fallback, render prose first on mobile, and give every image a stable CSS aspect ratio.

`index.tsx` wraps the sections in `PageShell` and preserves the exact order from the contract.

- [ ] **Step 6: Verify home behavior and commit.**

Run: `yarn test:e2e tests/e2e/mobile-responsive.spec.ts --grep "home mobile flow" && yarn test:e2e tests/e2e/public-routes.spec.ts && yarn typecheck && yarn lint`

Expected: PASS at 320, 390, and 1024 widths.

```bash
git add src/pages/index.tsx src/components/About/HeroIntroduction.tsx src/sections/Cases/CaseCarouselBlock.tsx src/components/CaseCarousel.tsx src/components/CaseCarouselItem.tsx src/sections/CentralContentPageLinks.tsx src/components/PageLinkCard.tsx src/sections/Cases/AllShowcasesSection.tsx src/sections/MainPage/FrontendDeveloperPursuit.tsx tests/e2e/mobile-responsive.spec.ts
git commit -m "feat: recompose home for mobile reading"
```

---

### Task 6: Reorder About Around Context, Profile, Languages, and Timeline

**Files:**

- Modify: `src/pages/about.tsx`
- Modify: `src/components/WorkShowcase.tsx`
- Modify: `tests/e2e/mobile-responsive.spec.ts`

**Interfaces:**

- Consumes: about introduction, languages, and professional timeline queries.
- Produces: context-before-image mobile order, accessible text-based proficiency, and a one-column timeline.

- [ ] **Step 1: Add failing About contracts.**

At `320x568` and `390x844`, assert the page's first content landmarks are `h1` → introductory paragraph → meeting image; the image frame is approximately `16:10`; every language card exposes its language and textual proficiency; timeline articles are one column; no overflow exists. Also assert exactly one `h1`.

- [ ] **Step 2: Run and observe the image-first/heading failure.**

Run: `yarn test:e2e tests/e2e/mobile-responsive.spec.ts --grep "about mobile flow"`

Expected: FAIL because the current large image precedes the explanatory context and animated identity creates an extra heading.

- [ ] **Step 3: Recompose `about.tsx`.**

Use `PageShell` and four `ContentSection`s:

1. `SectionHeader as="h1"` with the current About title/context, followed by the stable `aspect-[16/10]` meeting image;
2. a profile card with current portrait/details and readable `text-base leading-[26px]` paragraphs;
3. Languages with `ViewState`, cards in `grid-cols-1 sm:grid-cols-2`, visible text such as `Native`, `Professional`, or `Conversational`, and decorative stars marked `aria-hidden="true"`;
4. Experience timeline with `ViewState` and the current `WorkShowcase` data.

Remove `AnimatedName`, the local full-screen spacing, and image-first ordering. Use fallback only for the primary identity/profile; languages and timeline must show honest empty/error state when their collections are absent.

- [ ] **Step 4: Make `WorkShowcase` a semantic vertical timeline.**

Render an ordered list. Each item is an `article` with `h3`, date/supporting metadata, and body copy. At mobile widths use one column and a left border/marker; at `md` and wider, allow the existing alternating visual rhythm. Do not position copy off-canvas for animation.

- [ ] **Step 5: Verify and commit.**

Run: `yarn test:e2e tests/e2e/mobile-responsive.spec.ts --grep "about mobile flow" && yarn test:e2e tests/e2e/public-routes.spec.ts --grep "about" && yarn typecheck && yarn lint`

Expected: PASS.

```bash
git add src/pages/about.tsx src/components/WorkShowcase.tsx tests/e2e/mobile-responsive.spec.ts
git commit -m "feat: improve about mobile hierarchy"
```

---

### Task 7: Simplify Experience into Readable Sections and Skill Grids

**Files:**

- Create: `src/components/SkillGrid.tsx`
- Modify: `src/pages/experience.tsx`
- Modify: `tests/e2e/mobile-responsive.spec.ts`

**Interfaces:**

- Consumes: the existing static experience copy and skill arrays without content changes.
- Produces: `SkillGrid` with readable labels and one/two-column responsive behavior.

- [ ] **Step 1: Add failing Experience contracts.**

At all four mobile viewports, assert one `h1`, no overflow, each `[data-testid="skill-grid"]` uses one column at 320px, every skill label is visible without truncation, and each experience content block has a width no greater than its section. At `428px`, allow two columns only when every label's bounding box remains inside its item.

- [ ] **Step 2: Run and observe the dense-grid/overflow failure.**

Run: `yarn test:e2e tests/e2e/mobile-responsive.spec.ts --grep "experience mobile flow"`

Expected: FAIL on current multi-column skill density and off-canvas widths.

- [ ] **Step 3: Implement `SkillGrid`.**

```tsx
import type { ReactNode } from 'react';

export type SkillItem = { label: string; icon: ReactNode };

export default function SkillGrid({ title, items }: { title: string; items: SkillItem[] }) {
  return (
    <section aria-labelledby={`skill-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <h2 id={`skill-${title.toLowerCase().replace(/\s+/g, '-')}`} className="text-[26px] font-bold leading-8">{title}</h2>
      <ul data-testid="skill-grid" className="mt-5 grid min-w-0 grid-cols-1 gap-3 min-[400px]:grid-cols-2">
        {items.map(({ label, icon }) => <li key={label} className="flex min-h-14 min-w-0 items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"><span aria-hidden="true" className="shrink-0">{icon}</span><span className="min-w-0 text-sm font-medium leading-[22px]">{label}</span></li>)}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Recompose the page without changing copy.**

Retain the existing `ExperienceSectionData`, mobile, web, and other skill arrays exactly. Replace `Layout`/`AnimatedName` with `PageShell`, begin with a compact `ContentSection` and one `SectionHeader as="h1"`, render prose sections in a `max-w-3xl space-y-6 text-base leading-[26px]`, and render each existing skill array through `SkillGrid`. Use one column below `md`; only use side-by-side prose/media at `md` and wider. Every image uses an aspect-ratio wrapper and `sizes`.

- [ ] **Step 5: Verify and commit.**

Run: `yarn test:e2e tests/e2e/mobile-responsive.spec.ts --grep "experience mobile flow" && yarn test:e2e tests/e2e/public-routes.spec.ts --grep "experience" && yarn typecheck && yarn lint`

Expected: PASS at 320, 375, 390, and 428 widths.

```bash
git add src/components/SkillGrid.tsx src/pages/experience.tsx tests/e2e/mobile-responsive.spec.ts
git commit -m "feat: simplify responsive experience sections"
```

---

### Task 8: Make Contact Direct, Tappable, and Screen-Reader Friendly

**Files:**

- Create: `src/components/ContactMethodCard.tsx`
- Modify: `src/pages/contact.tsx`
- Modify: `src/components/ContactForm.tsx`
- Modify: `src/components/Form.tsx`
- Modify: `tests/e2e/mobile-responsive.spec.ts`

**Interfaces:**

- Consumes: existing `/api/contact` payload and submission result; current phone/email strings.
- Produces: direct contact actions, stable form dimensions, and `aria-live` submission feedback.

- [ ] **Step 1: Add failing Contact contracts.**

At `320x568` and `390x844`, assert one `h1`; the title starts within `120px` below the site header; phone uses `tel:`; email uses `mailto:`; both contact cards and submit button are at least `44px` high; every input/textarea is full-width and at least `48px` high; labels are associated; status is in an `aria-live` region; no overflow exists.

- [ ] **Step 2: Run and observe spacer/target/status failures.**

Run: `yarn test:e2e tests/e2e/mobile-responsive.spec.ts --grep "contact mobile flow"`

Expected: FAIL because of the repeated animated brand spacer, undersized controls, and non-live status message.

- [ ] **Step 3: Add the contact action component.**

```tsx
import Link from 'next/link';
import type { ReactNode } from 'react';

export default function ContactMethodCard({ href, label, value, icon }: { href: string; label: string; value: string; icon: ReactNode }) {
  return <Link data-contact-method href={href} className="flex min-h-14 min-w-0 items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-primary dark:border-gray-700 dark:bg-gray-800"><span aria-hidden="true" className="shrink-0">{icon}</span><span className="min-w-0"><span className="block text-sm leading-[22px] text-gray-600 dark:text-gray-300">{label}</span><span className="block break-words font-semibold">{value}</span></span></Link>;
}
```

- [ ] **Step 4: Recompose the page and harden the form presentation.**

`contact.tsx` uses `PageShell`, a top `ContentSection` with `SectionHeader as="h1"`, an invitation paragraph, a one-column contact-method grid that becomes two columns at `sm`, then `ContactForm`. Remove `AnimatedName` and `min-h-screen` spacer behavior.

In `ContactForm.tsx`, keep current details but render them through `ContactMethodCard`; do not duplicate address strings in unrelated headings. In `Form.tsx`, preserve the request body, endpoint, native required-field validation, success/error logic, and duplicate-submit protection. Apply `w-full min-h-12` to text inputs, `w-full min-h-32` to textarea, `min-h-12 w-full sm:w-auto` plus `data-primary-action` to submit, visible focus rings, and this status container:

```tsx
<div aria-live="polite" aria-atomic="true" role="status" className="min-h-[22px] text-sm leading-[22px]">
  {statusMessage}
</div>
```

- [ ] **Step 5: Verify contact flow and commit.**

Run: `yarn test:e2e tests/e2e/mobile-responsive.spec.ts --grep "contact mobile flow" && yarn test:e2e tests/e2e/public-routes.spec.ts --grep "contact" && yarn test:unit && yarn typecheck && yarn lint`

Expected: PASS; existing form tests remain green.

```bash
git add src/components/ContactMethodCard.tsx src/pages/contact.tsx src/components/ContactForm.tsx src/components/Form.tsx tests/e2e/mobile-responsive.spec.ts
git commit -m "feat: improve mobile contact experience"
```

---

### Task 9: Rebuild Case Detail as Semantic, CSS-Responsive Sections

**Files:**

- Create: `src/components/Cases/CaseDetailSections.tsx`
- Modify: `src/pages/cases/[id]/index.tsx`
- Create: `src/pages/404.tsx`
- Modify: `tests/e2e/mobile-responsive.spec.ts`

**Interfaces:**

- Consumes: existing `CasePageProps`/`CaseData`, representative seeded case, and current link/media fields.
- Produces: Overview, My role, Project details, Media, and Links sections; CSS-sized media; deterministic loading/not-found state.

- [ ] **Step 1: Add failing case-detail contracts.**

At all four mobile viewports, visit `/cases/64b000000000000000000009` and assert:

- one `h1` (`Legacy Portfolio Case`);
- a compact back link within the first content section;
- visible headings `Overview`, `My role`, `Project details`, `Media`, `Links` in source order;
- one-column detail grids below `640px`;
- video/image wrappers are inside the viewport and use a `16/9` ratio;
- project links stack and each is at least `44px` high;
- no horizontal overflow.

Add a not-found request test by visiting `/cases/ffffffffffffffffffffffff`, asserting HTTP `404`, a stable `role="alert"`, and a link back to Cases. This validates Next's blocking static-path not-found result without inventing a client-side API call.

- [ ] **Step 2: Run and observe fixed-height/duplicate-heading failures.**

Run: `yarn test:e2e tests/e2e/mobile-responsive.spec.ts --grep "case detail mobile flow"`

Expected: FAIL due to window-measured/fixed media, duplicate animated-name heading, and missing semantic section labels.

- [ ] **Step 3: Implement focused detail section components.**

`CaseDetailSections.tsx` exports `OverviewSection`, `RoleSection`, `ProjectDetailsSection`, `MediaSection`, and `LinksSection`, each with typed props drawn from `CaseData`. Requirements:

- overview/role copy uses `max-w-3xl text-base leading-[26px]`;
- project metadata is a semantic `<dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">`;
- media uses `<div className="aspect-video w-full overflow-hidden rounded-2xl [&_iframe]:h-full [&_iframe]:w-full">`; render the existing `react-youtube` player without numeric `height`/`width` opts, or `Image fill` when the case provides image media;
- links render a stacked `flex-col gap-3 sm:flex-row`, each link `min-h-11`; every `http://` or `https://` path opens with `target="_blank" rel="noreferrer"`, while internal `/...` paths stay in the same tab;
- no component reads `window.innerWidth` or sets pixel media dimensions.

- [ ] **Step 4: Recompose the detail page and states.**

Remove `useWindowDimensions`, `AnimatedName`, repeated `h1`s, and fixed `h-96`. Use `PageShell`; then a compact hero `ContentSection` containing the back link, `SectionHeader as="h1"`, and supporting description. Render the five detail components in order. Map the existing API data to typed props in the page.

The case is generated through `getStaticPaths` with `fallback: 'blocking'`, so do not add a client-side fetch or synthetic loading spinner. Retain a defensive `caseData === null` error branch in the component, but let `buildCaseStaticProps` continue returning `{ notFound: true }` for unknown IDs. Add `src/pages/404.tsx` using `PageShell`, `ContentSection`, `<p role="alert">This page could not be found.</p>`, and a `Back to all cases` link. Do not invent project-detail fallback data.

- [ ] **Step 5: Verify detail behavior and commit.**

Run: `yarn test:e2e tests/e2e/mobile-responsive.spec.ts --grep "case detail mobile flow" && yarn test:e2e tests/e2e/public-routes.spec.ts --grep "legacy case ID" && yarn typecheck && yarn lint`

Expected: PASS for seeded and intercepted-not-found cases.

```bash
git add src/components/Cases/CaseDetailSections.tsx src/pages/cases/[id]/index.tsx src/pages/404.tsx tests/e2e/mobile-responsive.spec.ts
git commit -m "feat: rebuild responsive case detail"
```

---

### Task 10: Remove Obsolete Layout Code and Lock the Full Responsive Matrix

**Files:**

- Create: `tests/e2e/mobile-visual.spec.ts`
- Modify: `tests/e2e/mobile-responsive.spec.ts`
- Modify: `tests/e2e/public-routes.spec.ts`
- Modify: `src/components/SocialMediaLink.tsx`
- Modify: `src/components/SocialMediaLinks.tsx`
- Modify: `src/styles/base.css`
- Delete: `src/components/AnimatedComponents/AnimatedName.tsx`
- Delete if unreferenced: `src/components/Layouts/Layout.tsx`
- Delete if unreferenced: `src/components/Layouts/PageLayoutContainer.tsx`
- Create via Playwright: `tests/e2e/mobile-visual.spec.ts-snapshots/*`

**Interfaces:**

- Consumes: all migrated public routes, both themes, reduced-motion behavior, deterministic browser fixture.
- Produces: route-wide mobile regression coverage and reviewed visual baselines.

- [ ] **Step 1: Add the final route matrix.**

Extend `mobile-responsive.spec.ts` with a loop over `/`, `/about`, `/experience`, `/contact`, `/showcases`, `/cases`, and `/cases/64b000000000000000000009` at all four mobile viewports. For each route: open with reduced motion, assert its main marker, `expectNoHorizontalOverflow`, verify the site header is within the viewport, and evaluate all visible links/buttons so no primary action is smaller than `44x44px`. Exempt inline prose links only by selecting `[data-primary-action], header button, nav a, form button, [data-testid="project-card"] a, [data-contact-method]` rather than every anchor.

Add focused tests for:

- dark system theme with `localStorage.theme = 'system'` and `colorScheme: 'dark'` before navigation;
- normal motion with all reveal elements scrolled into view and still no overflow;
- open-menu route navigation closing the dialog and returning body overflow;
- `320px` long Swedish/English labels staying within their containers.

- [ ] **Step 2: Run and fix only residual responsive defects.**

Run: `yarn test:e2e tests/e2e/mobile-responsive.spec.ts`

Expected initially: any remaining undersized `SocialMediaLink` or stale page marker fails. Update `SocialMediaLink`/`SocialMediaLinks` to expose named `44x44px` links and use resolved theme-independent styles. Update `public-routes.spec.ts` only when a heading level changed intentionally; retain the same route and user-facing marker text.

- [ ] **Step 3: Remove obsolete identity/layout code.**

Run:

```bash
rg -n "AnimatedName|Layouts/Layout|PageLayoutContainer|darkColors|lightColors" src
```

Expected before deletion: zero page/component imports; only the obsolete files/keyframes themselves may remain. Remove `AnimatedName.tsx` and the `darkColors`/`lightColors` keyframes. Delete `Layout.tsx` and `PageLayoutContainer.tsx` only if `rg` confirms no imports. Do not delete shared animation/layout components still used by `Stepper`, `ImageSlider`, or desktop-only carousel behavior.

- [ ] **Step 4: Add deterministic focused screenshots.**

Create `mobile-visual.spec.ts` with reduced motion and fixed `390x844` viewport. Capture:

- home hero in light mode;
- open mobile menu in light and dark mode;
- experience skill grid in dark mode;
- showcases first two project cards in light mode;
- seeded case detail hero/media in light mode;
- contact intro/form in dark mode.

Use named screenshots, hide nondeterministic timestamps if any, and scope screenshots to `main`, `header + dialog`, or the specific section instead of full-page where content height is data-sensitive.

Run: `yarn playwright test tests/e2e/mobile-visual.spec.ts --update-snapshots`

Expected: new snapshot PNGs. Open every new PNG and inspect 320/390-equivalent content density, clipping, contrast, headings, and focus states before accepting it. Then run `yarn playwright test tests/e2e/mobile-visual.spec.ts` without `--update-snapshots`; expected PASS.

- [ ] **Step 5: Run the complete verification ladder.**

```bash
node --version
yarn --version
yarn typecheck
yarn lint
yarn test:unit
yarn test:integration
yarn test:e2e
yarn build:production
```

Expected versions: `v22.23.1` and `1.22.22`. Expected result: every command exits `0`; Playwright reports no console/page errors and all visual snapshots match.

- [ ] **Step 6: Perform the manual visual/accessibility audit.**

Inspect `320x568`, `390x844`, `768x1024`, `1024x768`, and `1440x900` in both themes where contrast changes. Keyboard-check header/menu and form; verify focus visibility, Escape, focus return, body unlock, semantic heading order, image fallback, query empty/error messages, slow loading, contact submission feedback, and reduced motion. Record any finding as a new failing automated test before fixing it.

- [ ] **Step 7: Commit cleanup and regression coverage.**

```bash
git add src tests/e2e
git commit -m "test: lock responsive UI regression coverage"
```

---

## Completion Review

Before declaring the goal complete, compare the implementation line-by-line against `docs/superpowers/specs/2026-07-16-mobile-first-responsive-ui-design.md` and verify:

- every public page uses the shared mobile gutters and header offset;
- identity → projects → experience → contact remains obvious on mobile;
- Showcases and Cases use the same project-card contract;
- the case page uses semantic lists/details and CSS-sized media;
- API failures are distinguishable from empty collections and never produce accidental blank sections;
- no primary action is below `44x44px` and no input is below `48px`;
- reduced motion displays all content without document-width growth;
- desktop-only rich motion starts at `1024px`, with mobile receiving the simpler static presentation;
- all automated and manual checks above have current evidence.

Only after this review passes should the implementation branch be handed to the `finishing-a-development-branch` skill.
