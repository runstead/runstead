interface StartupUiElementBox {
  selector: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface StartupUiOverlapResult {
  count: number;
  overlap?: {
    first: string;
    second: string;
    area: string;
  };
}

interface PlaywrightOverlapPage {
  locator(selector: string): PlaywrightOverlapLocator;
}

interface PlaywrightOverlapLocator {
  first(): PlaywrightOverlapLocator;
  count(): Promise<number>;
  boundingBox(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>;
}

export async function expectPlaywrightNoOverlap(
  page: PlaywrightOverlapPage,
  selectors: string[]
): Promise<StartupUiOverlapResult> {
  const boxes: StartupUiElementBox[] = [];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();

    if ((await locator.count()) === 0) {
      continue;
    }

    const box = await locator.boundingBox();

    if (box === null || box.width <= 0 || box.height <= 0) {
      continue;
    }

    boxes.push({
      selector,
      left: box.x,
      top: box.y,
      right: box.x + box.width,
      bottom: box.y + box.height
    });
  }

  return findStartupUiOverlap(boxes);
}

function findStartupUiOverlap(boxes: StartupUiElementBox[]): StartupUiOverlapResult {
  for (let index = 0; index < boxes.length; index += 1) {
    for (let next = index + 1; next < boxes.length; next += 1) {
      const first = boxes[index];
      const second = boxes[next];

      if (first === undefined || second === undefined) {
        continue;
      }

      const width =
        Math.min(first.right, second.right) - Math.max(first.left, second.left);
      const height =
        Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);

      if (width > 1 && height > 1) {
        return {
          count: boxes.length,
          overlap: {
            first: first.selector,
            second: second.selector,
            area: `${Math.round(width)}x${Math.round(height)}`
          }
        };
      }
    }
  }

  return { count: boxes.length };
}
