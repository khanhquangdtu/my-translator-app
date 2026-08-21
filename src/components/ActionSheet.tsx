/**
 * The stand-in for `Alert.alert` with more than two buttons.
 *
 * Three places on mobile popped a native alert as an action menu: the Library's
 * long-press (Rename / Share / Delete), the archive's export-format chooser
 * (.md / .txt / .srt), and the plain confirmations. The web has no equivalent —
 * `window.confirm` takes exactly two buttons and no styling — so the two-button
 * cases go to `ConfirmDialog` and the menus come here, onto the bottom sheet
 * the app already uses for its overflow menu.
 */
'use client';

import { Sheet, SheetGroup, SheetItem, SheetSeparator } from './Sheet';

export type ActionSheetOption = {
  label: string;
  glyph?: string;
  meta?: string;
  danger?: boolean;
  onSelect: () => void;
};

export function ActionSheet({
  visible,
  title,
  options,
  onClose,
}: {
  visible: boolean;
  title?: string;
  options: ActionSheetOption[];
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      {title ? <SheetGroup>{title}</SheetGroup> : null}
      {options.map((option) => (
        <SheetItem
          key={option.label}
          glyph={option.glyph ?? ''}
          label={option.label}
          meta={option.meta}
          danger={option.danger}
          onPress={() => {
            // Close first: the selected action often opens another overlay, and
            // two sheets animating over each other reads as a glitch.
            onClose();
            option.onSelect();
          }}
        />
      ))}
      <SheetSeparator />
      <SheetItem glyph="" label="Cancel" onPress={onClose} />
    </Sheet>
  );
}
