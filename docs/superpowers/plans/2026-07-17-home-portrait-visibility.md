# Home Portrait Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the faded home-page background portrait with a responsive, full-opacity portrait panel that keeps Martin's face unobstructed on mobile and desktop.

**Architecture:** First keep Vitest discovery inside the active checkout by extending its default exclusions with `.worktrees`, then remove two test-only timing hazards exposed by the repaired discovery boundary. Finally keep the visual change inside the existing `HeroIntroduction` component and replace its overlapping background layers with a content-driven responsive grid. Add one focused Playwright contract that verifies portrait visibility, 4:5 geometry, non-overlap, full opacity, and the mobile/desktop ordering in both themes.

**Tech Stack:** Next.js 15 Pages Router, React 18, TypeScript, Tailwind CSS 3, `next/image`, Playwright 1.61.

## Global Constraints

- Preserve the existing portrait asset, hero copy, skill labels, social links, routes, and calls to action.
- Do not add, replace, retouch, or generate any image asset.
- Below 768 CSS pixels, render the portrait first as a centered 4:5 card and the copy second.
- At 768 CSS pixels and above, render the copy in the left column and the portrait in the right column.
- Use full image opacity, `object-cover`, and a face-aware vertical position near the upper third of the source image.
- Do not place text, gradients, or other visual layers over Martin's face.
- Keep the hero content-driven; do not add a fixed or minimum viewport-height constraint.
- Preserve the portrait alt text and all existing keyboard focus styles and link accessible names.
- Verify at 390 × 844 and 1440 × 1000 CSS pixels in both light and dark themes.
- Run commands with the repository's Node `>=22.23.1 <23` engine and Yarn 1.22.22. Do not add dependencies.
- Follow red-green-refactor in both tasks: observe the focused regression test fail before modifying production or configuration code, then make only the minimal implementation change.
- Do not stage unrelated user changes.
- Keep Vitest's default `node_modules` and `.git` exclusions while adding the project-local `.worktrees` exclusion.
- Keep the production journal timeout and byte-cap behavior unchanged; stabilize only the test fixture deadline and the boundary-search algorithm.

## Planned File Map

| Path | Responsibility |
| --- | --- |
| `tests/unit/infra/vitest-config.test.ts` | Vitest worktree-exclusion regression contract |
| `vitest.config.ts` | Active-checkout test discovery boundary |
| `tests/unit/journal/age-process.test.ts` | Age subprocess test-fixture timing contract |
| `tests/unit/journal/contracts.test.ts` | Efficient intent-envelope byte-boundary contract |
| `tests/e2e/home-portrait.spec.ts` | Responsive portrait visibility, geometry, theme, and overflow contract |
| `src/components/About/HeroIntroduction.tsx` | Home hero copy and the responsive dedicated portrait panel |

---

### Task 1: Exclude Local Worktrees from Vitest Discovery

**Files:**

- Create: `tests/unit/infra/vitest-config.test.ts`
- Modify: `vitest.config.ts`

**Interfaces:**

- Consumes: Vitest's exported `configDefaults.exclude` array.
- Produces: a `test.exclude` array that preserves Vitest defaults and adds `**/.worktrees/**`.

- [ ] **Step 1: Write the failing Vitest configuration contract.**

Create `tests/unit/infra/vitest-config.test.ts` with this exact content:

```ts
import { describe, expect, it } from 'vitest';
import config from '../../../vitest.config';

describe('vitest config', () => {
  it('excludes ignored local worktrees without removing Vitest defaults', () => {
    const configObject = config as {
      test?: { exclude?: string[] };
    };

    expect(configObject.test?.exclude).toEqual(
      expect.arrayContaining([
        '**/node_modules/**',
        '**/.git/**',
        '**/.worktrees/**',
      ]),
    );
  });
});
```

- [ ] **Step 2: Run the focused test and verify the red state.**

Run:

```bash
npx --yes --package=node@22.23.1 --call 'yarn vitest run tests/unit/infra/vitest-config.test.ts'
```

Expected: FAIL because the current `test.exclude` value is `undefined`.

- [ ] **Step 3: Extend Vitest's default exclusions with the local worktree directory.**

Replace `vitest.config.ts` with this exact content:

```ts
import { configDefaults, defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { src: path.resolve(__dirname) } },
  test: {
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 10_000,
    exclude: [...configDefaults.exclude, '**/.worktrees/**'],
  },
});
```

- [ ] **Step 4: Run the focused test and discovery check.**

Run:

```bash
npx --yes --package=node@22.23.1 --call 'yarn vitest run tests/unit/infra/vitest-config.test.ts'
npx --yes --package=node@22.23.1 --call 'yarn vitest list tests/unit --filesOnly'
```

Expected: the focused test PASSes, the list command exits 0, and no listed
path starts with `.worktrees/`.

- [ ] **Step 5: Run the repaired baseline.**

Run:

```bash
npx --yes --package=node@22.23.1 --call 'yarn test:unit'
npx --yes --package=node@22.23.1 --call 'yarn typecheck'
npx --yes --package=node@22.23.1 --call 'yarn lint'
```

Expected: all commands PASS without collecting tests below `.worktrees`.

- [ ] **Step 6: Commit the test-discovery repair.**

```bash
git add tests/unit/infra/vitest-config.test.ts vitest.config.ts
git commit -m "test: exclude local worktrees from Vitest"
```

---

### Task 2: Stabilize the Repaired Journal Unit Baseline

**Files:**

- Modify: `tests/unit/journal/age-process.test.ts`
- Modify: `tests/unit/journal/contracts.test.ts`

**Interfaces:**

- Consumes: the existing fake-age fixture, `INTENT_MAX_BYTES`, `intentEnvelopeJson`, and `canonicalIntentText`.
- Produces: the same journal behavior assertions without a load-sensitive subprocess deadline or an O(n²) allocation loop.

- [ ] **Step 1: Reproduce the two baseline failures.**

Run:

```bash
npx --yes --package=node@22.23.1 --call 'yarn test:unit'
```

Expected: FAIL in the existing age-process success case with `journal
encryption unavailable` under full-suite load and/or in `rejects the first
valid outbound intent envelope above the byte cap` at the 10,000 ms timeout.
Record whichever of the two timing failures reproduce; Task 1's report is the
authoritative original RED evidence for both failures.

- [ ] **Step 2: Give non-timeout fake-age cases the production-equivalent deadline.**

In `createTestAgeProcess` inside `tests/unit/journal/age-process.test.ts`, change
only the default operation timeout from 500 to 3,000 milliseconds:

```ts
  return createAgeProcess({
    executable: fixturePath,
    operationTimeoutMs: 3_000,
    killAfterMs: 100,
    ciphertextLimitBytes: 65_536,
    plaintextLimitBytes: 32_768,
    ...options,
  });
```

Keep the dedicated timeout test's explicit 50-millisecond override and the
abort test's explicit 1,000-millisecond override unchanged.

- [ ] **Step 3: Replace the linear byte-boundary scan with binary search.**

Inside `rejects the first valid outbound intent envelope above the byte cap`
in `tests/unit/journal/contracts.test.ts`, replace the mutable candidates and
linear `for` loop with this exact boundary search:

```ts
    let lowerBound = 1;
    let upperBound = INTENT_MAX_BYTES;

    while (lowerBound < upperBound) {
      const candidateBytes = Math.floor((lowerBound + upperBound) / 2);
      const candidate = {
        ...intent,
        ciphertext: base64Ciphertext(candidateBytes),
      };
      const size = Buffer.byteLength(canonicalIntentText(candidate), 'utf8');

      if (size <= INTENT_MAX_BYTES) {
        lowerBound = candidateBytes + 1;
      } else {
        upperBound = candidateBytes;
      }
    }

    const firstOverCap = {
      ...intent,
      ciphertext: base64Ciphertext(lowerBound),
    };
    const lastUnderCap = {
      ...intent,
      ciphertext: base64Ciphertext(lowerBound - 1),
    };
```

Keep the four existing assertions after the search unchanged; they prove the
search found the exact valid boundary and production serialization still
rejects the first over-cap envelope.

- [ ] **Step 4: Run the focused journal tests.**

Run:

```bash
npx --yes --package=node@22.23.1 --call 'yarn vitest run tests/unit/journal/age-process.test.ts tests/unit/journal/contracts.test.ts --reporter=verbose'
```

Expected: 30 tests PASS. The boundary test completes well below its 10-second
timeout and every age-process behavior remains covered.

- [ ] **Step 5: Run the full repaired baseline.**

Run:

```bash
npx --yes --package=node@22.23.1 --call 'yarn test:unit'
npx --yes --package=node@22.23.1 --call 'yarn typecheck'
npx --yes --package=node@22.23.1 --call 'yarn lint'
```

Expected: all commands PASS with no test files collected below `.worktrees`.

- [ ] **Step 6: Commit the journal test stabilization.**

```bash
git add tests/unit/journal/age-process.test.ts tests/unit/journal/contracts.test.ts
git commit -m "test: stabilize journal unit baseline"
```

---

### Task 3: Build and Verify the Dedicated Portrait Panel

**Files:**

- Create: `tests/e2e/home-portrait.spec.ts`
- Modify: `src/components/About/HeroIntroduction.tsx`

**Interfaces:**

- Consumes: `/images/profilepicture.webp`, `useAboutQuery('introduction')`, `SocialMediaLinks`, and the existing `/showcases`, `/experience`, and `/contact` routes.
- Produces: stable `home-hero`, `home-hero-copy`, and `home-portrait` test IDs plus a responsive 4:5 portrait panel.

- [ ] **Step 1: Write the failing responsive Playwright contract.**

Create `tests/e2e/home-portrait.spec.ts` with this exact content:

```ts
import { expect, test } from '@playwright/test';

type Rect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

const viewports = [
  { height: 844, layout: 'stacked', name: 'mobile', width: 390 },
  { height: 1000, layout: 'columns', name: 'desktop', width: 1440 },
] as const;

const themes = ['light', 'dark'] as const;

function rectanglesOverlap(left: Rect, right: Rect): boolean {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}

for (const viewport of viewports) {
  for (const theme of themes) {
    test(`${viewport.name} ${theme} hero keeps the portrait visible and separate`, async ({
      page,
    }) => {
      await page.setViewportSize({
        height: viewport.height,
        width: viewport.width,
      });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      const hero = page.getByTestId('home-hero');
      const copy = page.getByTestId('home-hero-copy');
      const portrait = page.getByTestId('home-portrait');
      const portraitImage = portrait.locator('img');

      await expect(hero).toBeVisible();
      await expect(copy).toBeVisible();
      await expect(portrait).toBeVisible();
      await expect(portraitImage).toBeVisible();

      const copyBox = await copy.boundingBox();
      const portraitBox = await portrait.boundingBox();
      expect(copyBox).not.toBeNull();
      expect(portraitBox).not.toBeNull();

      const copyRect = copyBox as Rect;
      const portraitRect = portraitBox as Rect;
      expect(rectanglesOverlap(copyRect, portraitRect)).toBe(false);
      expect(portraitRect.width / portraitRect.height).toBeCloseTo(0.8, 1);

      if (viewport.layout === 'stacked') {
        expect(portraitRect.y + portraitRect.height).toBeLessThanOrEqual(
          copyRect.y,
        );
      } else {
        expect(copyRect.x + copyRect.width).toBeLessThanOrEqual(
          portraitRect.x,
        );
      }

      const imageStyle = await portraitImage.evaluate((image) => {
        const style = window.getComputedStyle(image);
        return {
          objectFit: style.objectFit,
          opacity: style.opacity,
        };
      });

      expect(imageStyle).toEqual({ objectFit: 'cover', opacity: '1' });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    });
  }
}
```

- [ ] **Step 2: Run the focused test and verify the red state.**

Run:

```bash
yarn test:e2e tests/e2e/home-portrait.spec.ts
```

Expected: FAIL because `getByTestId('home-hero-copy')` and
`getByTestId('home-portrait')` do not exist in the current hero.

- [ ] **Step 3: Replace the overlapping background hero with the dedicated portrait grid.**

Replace `src/components/About/HeroIntroduction.tsx` with this exact content:

```tsx
import SocialMediaLinks from '../SocialMediaLinks';

import Link from 'next/link';
import Image from 'next/image';
import useAboutQuery from '../../hooks/useAboutQuery';
import { ProfessionalProfileintroduction } from 'src/types/DBTypes';

const fallbackIntroduction = {
  name: 'Martin',
  surname: 'Lindblad',
  title: 'Front-end Developer',
  info: 'Stockholm-based front-end developer building accessible, reliable product experiences with React, React Native, Next.js, TypeScript, and modern API integrations.',
  key: 'introduction',
} as ProfessionalProfileintroduction;

export default function Hero() {
  const { data: personalInfo } = useAboutQuery('introduction');
  const personalInfoData =
    (personalInfo as unknown as ProfessionalProfileintroduction | undefined) ??
    fallbackIntroduction;

  return (
    <main
      data-testid="home-hero"
      className="bg-white text-gray-950 dark:bg-gray-950 dark:text-white"
    >
      <div className="mx-auto w-full max-w-7xl px-6 pb-16 pt-24 sm:px-10 md:pb-20 lg:px-24">
        <Link
          href="/"
          className="text-2xl font-extrabold tracking-wide text-gray-950 dark:text-white md:text-4xl"
        >
          Martin <span className="font-light text-blue-600">Lindblad</span>
        </Link>

        <div className="grid items-center gap-10 pt-10 md:grid-cols-[minmax(0,1.15fr)_minmax(16rem,0.85fr)] md:gap-12 md:pt-16">
          <div
            data-testid="home-hero-copy"
            className="order-2 min-w-0 md:order-1"
          >
            <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
              Front-end Developer in Stockholm
            </p>
            <h1 className="max-w-3xl break-words text-3xl font-extrabold leading-tight text-gray-950 dark:text-white sm:text-5xl lg:text-6xl">
              React and mobile interfaces built for real users.
            </h1>
            <p className="max-w-2xl break-words py-6 text-base leading-7 text-gray-700 dark:text-gray-200 md:text-lg">
              {personalInfoData?.info || fallbackIntroduction.info}
            </p>
            <div className="flex max-w-full flex-wrap gap-2 pb-6 text-sm font-medium text-gray-800 dark:text-gray-100">
              {['React', 'React Native', 'Next.js', 'TypeScript'].map(
                (skill) => (
                  <span
                    key={skill}
                    className="rounded-full border border-gray-300 bg-white/80 px-3 py-1 dark:border-gray-700 dark:bg-gray-900/80"
                  >
                    {skill}
                  </span>
                ),
              )}
            </div>
            <div className="grid gap-3 sm:flex sm:flex-wrap sm:gap-4">
              <Link
                href="/showcases"
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-300 dark:bg-blue-500 dark:hover:bg-blue-400"
              >
                View case studies
              </Link>
              <Link
                href="/experience"
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-gray-400 bg-white/70 px-5 py-3 text-sm font-semibold text-gray-950 transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-gray-300 dark:border-gray-600 dark:bg-gray-900/70 dark:text-white dark:hover:bg-gray-900"
              >
                See experience
              </Link>
              <Link
                href="/contact"
                className="inline-flex min-h-11 items-center justify-center rounded-md px-5 py-3 text-sm font-semibold text-gray-800 underline-offset-4 transition hover:underline focus:outline-none focus:ring-4 focus:ring-gray-300 dark:text-gray-100"
              >
                Contact Martin
              </Link>
            </div>
            <SocialMediaLinks />
          </div>

          <div
            data-testid="home-portrait"
            className="relative order-1 mx-auto aspect-[4/5] w-full max-w-sm overflow-hidden rounded-2xl border border-gray-200 bg-gray-100 shadow-2xl shadow-gray-950/20 dark:border-gray-800 dark:bg-gray-900 dark:shadow-black/50 md:order-2 md:max-w-md"
          >
            <Image
              alt="Portrait of Martin Lindblad"
              className="object-cover object-[50%_35%]"
              src="/images/profilepicture.webp"
              fill
              priority
              sizes="(max-width: 767px) calc(100vw - 48px), (max-width: 1279px) 42vw, 448px"
            />
          </div>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Run the focused test and verify the green state.**

Run:

```bash
yarn test:e2e tests/e2e/home-portrait.spec.ts
```

Expected: all four viewport/theme cases PASS.

- [ ] **Step 5: Run static and regression checks.**

Run:

```bash
yarn typecheck
yarn lint
yarn test:e2e tests/e2e/public-routes.spec.ts tests/e2e/assets.spec.ts
```

Expected: all commands PASS. The public home marker and local portrait asset
remain available.

- [ ] **Step 6: Perform visual verification.**

Render `/` at 390 × 844 and 1440 × 1000 in both light and dark themes. Confirm:

- Martin's entire face is visible at full opacity.
- No text, gradient, navigation, or action overlaps the portrait.
- Mobile shows portrait then copy; desktop shows copy left and portrait right.
- The 4:5 crop remains natural and the page has no horizontal overflow.

Expected: all four renders match the approved dedicated-portrait-panel
direction in `docs/superpowers/specs/2026-07-17-home-portrait-visibility-design.md`.

- [ ] **Step 7: Commit the implementation.**

```bash
git add tests/e2e/home-portrait.spec.ts src/components/About/HeroIntroduction.tsx
git commit -m "fix: make home portrait clearly visible"
```
