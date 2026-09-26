// Wordmark.jsx
//
// "tnega", lowercase, in a light weight of the system face. Text, not an
// image: it scales without a second asset, follows the theme's foreground
// colour, and needs no web font (the site loads none; see tailwind.config.js).
// The accessible name is the product's proper name.

import React from 'react';

export default function Wordmark({ className = 'text-[22px]', as: Tag = 'span' }) {
  return (
    <Tag className={`font-light tracking-[0.02em] leading-none select-none ${className}`} aria-label="Tnega">
      <span aria-hidden="true">tnega</span>
    </Tag>
  );
}
