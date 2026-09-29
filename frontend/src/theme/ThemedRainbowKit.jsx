// theme/ThemedRainbowKit.jsx
//
// RainbowKit's provider, following the site theme. Used by main.jsx for the
// whole site and by a signing link's page load (sign/SignRoot.jsx) with its own
// wallet config, so the two wallet modals cannot look different.
//
// The accent is the --accent role, written out because RainbowKit takes a
// colour string, not a CSS variable.

import React from 'react';
import { RainbowKitProvider, lightTheme, darkTheme } from '@rainbow-me/rainbowkit';
import { useTheme } from './ThemeProvider';

export default function ThemedRainbowKit({ children }) {
  const { dark } = useTheme();
  const theme = dark
    ? darkTheme({ accentColor: 'rgb(208, 164, 255)', accentColorForeground: 'rgb(24, 8, 40)', borderRadius: 'small' })
    : lightTheme({ accentColor: 'rgb(118, 40, 200)', accentColorForeground: 'white', borderRadius: 'small' });
  return <RainbowKitProvider theme={theme}>{children}</RainbowKitProvider>;
}
