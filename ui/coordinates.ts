export interface NativeRectangle {x: number; y: number; width: number; height: number}
export function validNativeRectangle(rectangle: NativeRectangle): boolean {
  return [rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(Number.isFinite) && rectangle.width > 0 && rectangle.height > 0;
}
export function normalizeNativeBounds(child: NativeRectangle, root: NativeRectangle): NativeRectangle | null {
  if (!validNativeRectangle(child) || !validNativeRectangle(root)) return null;
  return {x: child.x - root.x, y: child.y - root.y, width: child.width, height: child.height};
}
