#!/usr/bin/env python3
"""Build a weekly progress deck.

    python build.py 1

Writes ../public/weekly/week-<n>.html, a single self-contained file: the
heading face and the panel screenshots are embedded, so the deck opens with no
network and can be recorded from a laptop with the wifi off.

To add week 2, write weeks/week_2.py with the same three names (TITLE,
DESCRIPTION, SLIDES) and run this with a 2. Nothing here changes, and the entry
on the site is one object in WEEKLY_UPDATES in frontend/src/HowItWorksPage.jsx.

The PDF companion is Chrome's own print of the same file, which is why the
print rules in the stylesheet below matter:

    chrome --headless=new --no-pdf-header-footer \
      --print-to-pdf=../public/weekly/week-1.pdf ../public/weekly/week-1.html

The HTML is the surface to record from: it animates, it takes the arrow keys,
and f puts it full screen. The PDF is for wherever a file has to be attached.
"""

import importlib
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
OUT_DIR = HERE.parent / "public" / "weekly"

sys.path.insert(0, str(HERE))


from deckassets import FONT_B64

CSS = """
:root{
  --paper:#FBF9F5; --ink:#2F2A26; --soft:#6B6259; --faint:#9A9188;
  --rule:rgba(47,42,38,.12);
  --rose:#E0A9A2; --sage:#A9BFA8; --sky:#A6BDD4; --ochre:#DEBC86; --lilac:#B9AECD;
}
@font-face{
  font-family:'DeckHand'; font-style:normal; font-weight:600; font-display:block;
  src:url(data:font/woff2;base64,__FONT__) format('woff2');
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%}
body{
  background:var(--paper); color:var(--ink);
  font:400 17px/1.62 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;
  /* Committed light. The deck is a recording surface and a viewer's dark
     preference must not repaint it mid-take. */
  color-scheme:light;
}
.hand{font-family:'DeckHand',ui-rounded,'Segoe Print','Bradley Hand',cursive;font-weight:600}

/* Paper: a faint grain and a soft vignette, not a texture image. */
body::before{
  content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
  background:
    radial-gradient(120% 90% at 50% -10%,rgba(255,255,255,.9),transparent 60%),
    radial-gradient(90% 70% at 100% 110%,rgba(185,174,205,.10),transparent 60%),
    radial-gradient(80% 60% at 0% 100%,rgba(169,191,168,.10),transparent 60%);
}

.deck{position:relative;z-index:1;height:100%;overflow:hidden}
.slide{
  position:absolute;inset:0;display:grid;place-items:center;
  grid-template-columns:minmax(0,1fr);
  padding:72px 84px 96px;
  opacity:0;visibility:hidden;transform:translateY(14px);
  transition:opacity .5s ease,transform .5s ease,visibility 0s linear .5s;
}
.slide.on{opacity:1;visibility:visible;transform:none;transition:opacity .5s ease,transform .5s ease,visibility 0s}
.inner{width:min(1080px,100%);min-width:0;max-height:100%;overflow:auto;scrollbar-width:thin}
/* The title carries one column of text, so it is set to a column width rather
   than left hanging at the full 1080 with half the slide empty beside it. */
.slide[data-kind="title"] .inner{width:min(820px,100%)}

.kicker{
  font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--faint);
  margin:0 0 14px;font-weight:600;
}
h1.hand{font-size:clamp(40px,6.4vw,76px);line-height:1.04;margin:0 0 18px;letter-spacing:.01em}
h2.hand{font-size:clamp(30px,4.4vw,52px);line-height:1.08;margin:0 0 26px;letter-spacing:.01em}
.sub{font-size:clamp(16px,1.9vw,21px);color:var(--soft);margin:0 0 26px;max-width:46ch}
.foot{font-size:13.5px;color:var(--faint);margin:0;max-width:52ch}
p{margin:0 0 14px}
b{font-weight:650}

.cols{display:grid;grid-template-columns:1.15fr .85fr;gap:38px;align-items:start}
.cols p{max-width:54ch;color:var(--soft)}
.cols .who p,.note-card p{max-width:none}

.note-card{
  border:1px solid var(--rule);border-radius:18px;padding:22px 24px;
  background:rgba(255,255,255,.62);
}
.note-h{font-family:'DeckHand',cursive;font-size:23px;color:var(--ink);margin:0 0 4px}
.note-card p+.note-h{margin-top:16px}

.who{border-left:3px solid var(--sky);padding-left:18px}
.who:nth-child(2){border-left-color:var(--rose)}
.who-h{font-family:'DeckHand',cursive;font-size:25px;color:var(--ink);margin:0 0 8px}
.who-t{color:var(--ink);font-weight:500}
.aside{margin-top:26px;font-size:14.5px;color:var(--faint);max-width:76ch}

.figs{display:grid;grid-template-columns:repeat(3,1fr);gap:26px}
.fig{border-top:3px solid var(--sage);padding-top:16px}
.fig:nth-child(2){border-top-color:var(--ochre)}
.fig:nth-child(3){border-top-color:var(--lilac)}
.fig-n{font-family:'DeckHand',cursive;font-size:clamp(40px,5.6vw,64px);line-height:1;color:var(--ink)}
.fig-l{font-size:15.5px;font-weight:600;margin-top:10px}
.fig-s{font-size:13.5px;color:var(--soft);margin-top:6px}

.stack{display:grid;grid-template-columns:repeat(2,1fr);gap:22px}
.st{border:1px solid var(--rule);border-radius:18px;padding:20px 22px;background:rgba(255,255,255,.55)}
.st-h{font-family:'DeckHand',cursive;font-size:25px;margin:0 0 6px}
.st p:not(.st-h){color:var(--soft);font-size:15px;margin:0}

.shot-img{
  display:block;margin:0 auto;max-width:100%;max-height:56vh;width:auto;height:auto;
  border-radius:16px;
  border:1px solid var(--rule);box-shadow:0 18px 44px rgba(47,42,38,.13);
}
.cap{font-size:13.5px;color:var(--faint);margin-top:14px;max-width:80ch}

/* Enter animation, staggered. Suppressed for reduced motion and never a reason
   for content to be missing: the end state is the default. */
.slide.on .inner>*{animation:rise .52s cubic-bezier(.2,.7,.3,1) both}
.slide.on .inner>*:nth-child(2){animation-delay:.06s}
.slide.on .inner>*:nth-child(3){animation-delay:.12s}
.slide.on .inner>*:nth-child(4){animation-delay:.18s}
@keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}

.bar{
  position:fixed;left:0;right:0;bottom:0;z-index:3;
  display:flex;align-items:center;gap:14px;
  padding:14px 22px;background:linear-gradient(to top,rgba(251,249,245,.95),rgba(251,249,245,0));
}
.dots{display:flex;gap:7px;flex:1}
.dot{width:8px;height:8px;border-radius:50%;background:rgba(47,42,38,.18);border:0;padding:0;cursor:pointer}
.dot.on{background:var(--ink)}
.nav{display:flex;gap:8px}
.nav button{
  min-width:38px;height:34px;border-radius:10px;border:1px solid var(--rule);
  background:rgba(255,255,255,.7);color:var(--ink);cursor:pointer;font-size:15px;
}
.nav button:disabled{opacity:.35;cursor:default}
.count{font-size:12.5px;color:var(--faint);font-variant-numeric:tabular-nums}

@media (max-width:820px){
  /* At this width a slide no longer fits its own height, and centring it meant
     the top and bottom of the longer slides were clipped away by the deck's
     overflow rather than reachable. Each slide scrolls instead, anchored at the
     top, with room at the bottom for the bar that sits over it. */
  .slide{padding:40px 20px 104px;align-items:start;overflow-y:auto;-webkit-overflow-scrolling:touch}
  .cols,.figs,.stack{grid-template-columns:1fr;gap:22px}
  body{font-size:15.5px}
  .inner{max-height:none;overflow:visible}
  .shot-img{max-height:none}
  h2.hand{margin-bottom:20px}
}
@media (prefers-reduced-motion:reduce){
  .slide,.slide.on .inner>*{transition:none;animation:none}
}
/* Printing is how the PDF companion is made: every slide laid out in order at
   the same 1280 by 800 the deck is recorded at, one to a page. */
@page{size:1280px 800px;margin:0}
@media print{
  body::before{display:none}
  .bar{display:none}
  .deck{height:auto;overflow:visible}
  .slide{
    position:static;opacity:1;visibility:visible;transform:none;
    break-after:page;page-break-after:always;
    width:1280px;height:800px;padding:72px 84px;
  }
  .slide:last-child{break-after:auto;page-break-after:auto}
  /* Must out-specify `.slide.on .inner>*`, or the one slide that is currently
     on keeps its entry animation, and a fill-mode of both prints it at the
     from state: page 1 of the PDF came out blank. */
  .slide.on .inner>*,.slide .inner>*{animation:none;opacity:1;transform:none}
  .shot-img{max-height:48vh}
}
"""

JS = """
(function(){
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var dots = document.getElementById('dots');
  var count = document.getElementById('count');
  var prev = document.getElementById('prev');
  var next = document.getElementById('next');
  var i = 0;

  slides.forEach(function(_, n){
    var b = document.createElement('button');
    b.className = 'dot'; b.type = 'button';
    b.setAttribute('aria-label', 'Go to slide ' + (n+1));
    b.addEventListener('click', function(){ go(n); });
    dots.appendChild(b);
  });

  function go(n){
    i = Math.max(0, Math.min(n, slides.length - 1));
    slides.forEach(function(s, k){
      s.classList.toggle('on', k === i);
      s.setAttribute('aria-hidden', k === i ? 'false' : 'true');
    });
    Array.prototype.forEach.call(dots.children, function(d, k){
      d.classList.toggle('on', k === i);
    });
    count.textContent = (i+1) + ' / ' + slides.length;
    prev.disabled = i === 0;
    next.disabled = i === slides.length - 1;
    // The hash lets a recording be restarted on a given slide rather than
    // clicked back to it.
    if (history.replaceState) history.replaceState(null, '', '#' + (i+1));
  }

  document.addEventListener('keydown', function(e){
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(i+1); }
    if (e.key === 'ArrowLeft'  || e.key === 'PageUp')  { e.preventDefault(); go(i-1); }
    if (e.key === 'Home') go(0);
    if (e.key === 'End') go(slides.length-1);
    if (e.key === 'f') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); }
  });
  prev.addEventListener('click', function(){ go(i-1); });
  next.addEventListener('click', function(){ go(i+1); });

  var start = parseInt((location.hash||'').replace('#',''), 10);
  go(isNaN(start) ? 0 : start - 1);
})();
"""


def build(week_number):
    mod = importlib.import_module(f"weeks.week_{week_number}")

    sections = [
        f'<section class="slide" data-kind="{kind}" aria-hidden="true">'
        f'<div class="inner">{inner}</div></section>'
        for kind, inner in mod.SLIDES
    ]

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>{mod.TITLE}</title>
<meta name="description" content="{mod.DESCRIPTION}" />
<style>{CSS.replace("__FONT__", FONT_B64)}</style>
</head>
<body>
<main class="deck">
{chr(10).join(sections)}
</main>
<div class="bar">
  <div class="dots" id="dots" role="tablist" aria-label="Slides"></div>
  <span class="count" id="count"></span>
  <span class="nav">
    <button id="prev" type="button" aria-label="Previous slide">&#8592;</button>
    <button id="next" type="button" aria-label="Next slide">&#8594;</button>
  </span>
</div>
<script>{JS}</script>
</body>
</html>
"""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"week-{week_number}.html"
    out.write_text(html)
    print(f"{out}  {out.stat().st_size / 1024:.0f} KB  {len(mod.SLIDES)} slides")


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else "1")
