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
