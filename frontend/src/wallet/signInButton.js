// signInButton.js
//
// The one look for a "Sign in" button: the web header's, a solid foreground
// block with the page colour for text, bold, 4px corners. The header, the
// mobile menu sheet, the sign-in modal and the /signin page all take it from
// here, so a visitor sees the same button for the same action wherever it is.
// Height, width and text size are the caller's, because those follow the
// space the button sits in; the look does not.

export const SIGN_IN_BUTTON = 'rounded bg-fg text-page font-bold hover:opacity-90 transition-opacity disabled:opacity-60';
