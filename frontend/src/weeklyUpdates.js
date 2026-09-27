// weeklyUpdates.js
//
// The Colosseum progress updates, newest first. One entry per week, each one a
// standalone deck under frontend/public/weekly/ that is self-contained enough to
// record from without the site running. A week can instead be a recorded video
// (`video`, a YouTube link), with no deck and no figures; the card then shows
// only what the entry carries.
//
// `figures` is the short list a reader should be able to carry away. Every one
// of them is measured, and the date is the date it was measured on, not the date
// the deck was written, because these move: the pooled rate and the overlap
// share both changed between the first draft of week 1 and its publication.
export const WEEKLY_UPDATES = [
  {
    week: 2,
    // The owner's recorded report for the second week, on YouTube ("Report2"
    // on her channel). No deck and no figures are listed for it here: the
    // video is the report.
    video: 'https://www.youtube.com/watch?v=UwEE3W5RCFU',
    title: 'Week 2 report',
    line: 'The second week\u2019s progress report, recorded as a video.',
  },
  {
    week: 1,
    href: '/weekly/week-1.html',
    // The HTML is the surface the video is recorded from: it animates, it goes
    // full screen, and it moves on the arrow keys. The PDF is the same eight
    // slides printed at the same 1280 by 800, for wherever a file has to be
    // attached instead of a link opened.
    pdf: '/weekly/week-1.pdf',
    dates: '15 to 20 September 2026',
    measured: '20 September 2026',
    title: 'What the order book does not show you',
    // Not "two orders of magnitude": 12.5% over 0.17% is 74, and rounding it up
    // to a hundred to make the sentence land is the thing this project is for.
    line: 'Post-only rejection on Hyperliquid: what a refused order costs the person who '
      + 'sent it, why the venue-wide figure and the figure a single maker sees are about '
      + 'seventy times apart, and two measurements of my own that were wrong.',
    figures: [
      ['0.17%', 'the median maker in the median market, across 40 markets'],
      ['12.5%', 'pooled across all 18,469,277 post-only orders observed'],
      ['100%', 'one address refused on all 252,994 of its orders in one market'],
    ],
  },
];


// The footer's Progress column (SiteLinks.jsx): each week, newest first,
// as a link to its video or its deck. The How It Works page that listed the
// weeks is no longer routed (/how-it-works now redirects), so the footer is
// where the reports are reached from.
export function weeklyLinks() {
  return WEEKLY_UPDATES.map((u) => ({
    key: `week-${u.week}`,
    label: `Week ${u.week} report`,
    note: u.video ? 'recorded video' : u.dates ? `deck, ${u.dates}` : 'deck',
    path: u.video || u.href,
    external: !!u.video,
    plain: !u.video,
  }));
}
