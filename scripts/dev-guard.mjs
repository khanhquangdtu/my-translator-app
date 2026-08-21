/**
 * Clears a production build before `next dev` runs on top of it.
 *
 * `next build` and `next dev` share the `.next` directory but write
 * incompatible things into it. Starting the dev server after a build leaves it
 * reading production manifests that point at files dev never emits, and the
 * result is a page that 500s with `ENOENT: .next/server/app/page.js` — an error
 * that says nothing about its actual cause and survives every reload.
 *
 * `BUILD_ID` is written only by `next build`, so its presence is an exact
 * signal. Deleting `.next` costs one slower first compile and removes a trap
 * that otherwise fires every time someone runs the build gate and then goes
 * back to developing.
 */
import { existsSync, rmSync } from 'node:fs';

if (existsSync('.next/BUILD_ID')) {
  rmSync('.next', { recursive: true, force: true });
  console.log('[dev] cleared a production .next — next dev cannot reuse one');
}
