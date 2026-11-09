// Mirror the native visibility state, rather than handling a second hotkey.
// This respects rebinding, replay controls and native suppression while typing.
export function nativeHudHidden() {
  const surfaces = document.querySelectorAll('.game-ui');
  return surfaces.length > 0 && surfaces[surfaces.length - 1].classList.contains('hidden');
}
