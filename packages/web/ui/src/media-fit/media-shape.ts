// The shape of a picture or a video and how it sits in a box of another shape (#176). A ratio is
// the width over the height: 16:9 is 1.78, a portrait 9:16 video 0.56, a panorama 3.

export const wide = 16 / 9;
/** A vertical video: a phone's clip, a YouTube Short. */
export const tall = 9 / 16;

/**
 * In a 16:9 box, media between these ratios fill it and lose a little at the edges. Anything
 * narrower (a square, a portrait) or wider (a panorama) is shown whole instead.
 */
export const coverMin = 1.3;
export const coverMax = 2.1;

/** No box is wider than this: a strip of a panorama would be a line. */
export const maxBoxRatio = 3;

/** The tallest a link page's preview, a post's single photo or its video gets. */
export const maxHeight = "min(70vh, 640px)";

/** The ratio of a size in pixels, or `undefined` when either side is missing or not positive. */
export const ratio = (
  width: number | null | undefined,
  height: number | null | undefined,
): number | undefined =>
  typeof width !== "number" ||
  typeof height !== "number" ||
  !Number.isFinite(width) ||
  !Number.isFinite(height) ||
  width <= 0 ||
  height <= 0
    ? undefined
    : width / height;

/**
 * Whether media of `ratio` fill a box of ratio `box` (`cover`, cropped a little) or are shown
 * whole inside it (`contain`). The limits are those of the 16:9 box, scaled to the box's own shape.
 */
export const fit = (ratio: number, box: number = wide): "cover" | "contain" => {
  const relative = (ratio / box) * wide;
  return relative < coverMin || relative > coverMax ? "contain" : "cover";
};

/**
 * The ratio of the box reserved for media whose shape is known: their own, so nothing is cropped
 * and nothing moves, up to `maxBoxRatio`. 16:9 when the shape is unknown. The box's height is
 * capped separately (`maxHeight`), which is how a portrait stays on the screen.
 */
export const box = (ratio: number | undefined): number =>
  ratio === undefined ? wide : Math.min(maxBoxRatio, ratio);
