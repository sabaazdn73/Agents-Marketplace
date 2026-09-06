// LandingPage.jsx
//
// A port of public/agent-hero/index.html, the supplied design. This is the
// whole Home page; nothing else is on it.
//
// WHAT THE DESIGN DOES, from reading it rather than guessing: seven agents
// start off-stage on a floor line, WALK in from alternating sides, then
// RISE into their final positions and settle into a float. Each agent is
// one flat PNG cut into a torso and two legs with clip-path, so the legs
// swing from the hip, the torso bobs twice per stride and the body leans
// into the direction of travel. Once everyone has landed, a halo appears
// behind the group, network lines draw from each agent to the lead, dots
// blink along them, and the copy fades up.
//
// PORTED FAITHFULLY, with three deliberate departures, all forced:
//
//  1. The stylesheet is scoped. The original is a standalone page, so its
//     selectors are bare (.hero, .stage, .agent, .copy) and its :root sets
//     variables globally. Dropped into the app those would apply outside
//     this page, and its `html,body` rule would restyle the whole site.
//     agentHero.css carries every rule prefixed with .agent-hero instead,
//     including inside the reduced-motion block, whose bare selectors
//     would otherwise have disabled animation app-wide.
//  2. Asset paths become /agent-hero/assets/... since the component is not
//     served from that directory.
//  3. The "Explore the catalog" link is a button that switches to the
//     marketplace tab, rather than an href="#".
//
// Everything else is the original: the same markup, the same geometry
// values, the same walk/rise/settle timing, the same Web Animations calls.

import React, { useEffect, useRef, useCallback } from 'react';
import './agentHero.css';

const A = '/agent-hero/assets';

// Geometry straight from the design. --x/--y are the final top-left as a
// percentage of the stage, --w the width, --hip where the legs are cut.
const AGENTS = [
  { img: 'orange', side: 'left',  order: 4, x: '35.8%', y: '33.8%', w: '7.4%',  hip: '80%' },
  { img: 'purple', side: 'right', order: 3, x: '56.2%', y: '34.4%', w: '9.2%',  hip: '78%' },
  { img: 'teal',   side: 'left',  order: 2, x: '33.4%', y: '45.3%', w: '8.1%',  hip: '80%' },
  { img: 'gold',   side: 'right', order: 1, x: '59.2%', y: '45.5%', w: '7.5%',  hip: '78%' },
  { img: 'small',  side: 'right', order: 5, x: '53.8%', y: '52.5%', w: '6.8%',  hip: '75%' },
  { img: 'top',    side: 'left',  order: 6, x: '45.9%', y: '28.4%', w: '8.2%',  hip: '78%' },
  { img: 'center', side: 'right', order: 0, x: '44.7%', y: '40.7%', w: '10.6%', hip: '80%', lead: true },
];

const FLOOR = 63;   // floor line, % of stage height, where feet land

export default function LandingPage({ onEnterMarketplace }) {
  const heroRef = useRef(null);
  const stageRef = useRef(null);
  const linesRef = useRef(null);
  const dotsRef = useRef(null);

  const play = useCallback(() => {
    const stage = stageRef.current;
    const hero = heroRef.current;
    if (!stage || !hero) return;
    const agents = [...stage.querySelectorAll('.agent')];
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const settle = () => { stage.classList.add('gathered'); hero.classList.add('gathered'); };

    stage.classList.remove('gathered');
    hero.classList.remove('gathered');
    agents.forEach((a) => {
      a.classList.remove('walking', 'floating');
      a.getAnimations?.().forEach((an) => an.cancel());
    });

    if (reduce) {
      agents.forEach((a) => { a.style.transform = ''; });
      settle();
      return;
    }

    const W = stage.clientWidth;
    const H = stage.clientHeight;
    let lastEnd = 0;

    agents.forEach((a) => {
      const cs = getComputedStyle(a);
      const fx = (parseFloat(cs.getPropertyValue('--x')) / 100) * W;
      const fy = (parseFloat(cs.getPropertyValue('--y')) / 100) * H;
      const w = (parseFloat(cs.getPropertyValue('--w')) / 100) * W;
      const h = a.offsetHeight || w * 1.3;
      const side = a.dataset.side;
      const order = +a.dataset.order;

      const startX = side === 'left' ? -w * 1.6 : W + w * 0.6;
      const floorY = (FLOOR / 100) * H - h * 1.15;
      const stopX = fx + (side === 'left' ? -w * 0.5 : w * 0.5);

      const dxs = startX - fx;
      const dys = floorY - fy;
      const dxe = stopX - fx;
      const dye = floorY - fy;

      const delay = 200 + order * 380 + Math.random() * 250;
      const dist = Math.abs(dxs - dxe);
      const walk = (dist / W) * 2600 + 400;
      const rise = 1300;

      a.style.setProperty('--dir', side === 'left' ? 1 : -1);
      a.style.setProperty('--stride', `${(0.58 + Math.random() * 0.1).toFixed(2)}s`);
      a.style.setProperty('--fd', `${3.2 + order * 0.25}s`);
      a.style.setProperty('--fdl', `${order * 0.35}s`);
      a.style.transform = `translate(${dxs}px,${dys}px) scale(1.15)`;

      const anim = a.animate([
        { transform: `translate(${dxs}px,${dys}px) scale(1.15)`, offset: 0 },
        { transform: `translate(${dxs}px,${dys}px) scale(1.15)`, offset: 0.001, easing: 'linear' },
        { transform: `translate(${dxe}px,${dye}px) scale(1.15)`, offset: walk / (walk + rise), easing: 'cubic-bezier(.5,0,.15,1)' },
        { transform: 'translate(0,0) scale(1)', offset: 1 },
      ], { duration: walk + rise, delay, easing: 'linear', fill: 'forwards' });

      const t1 = setTimeout(() => a.classList.add('walking'), delay);
      const t2 = setTimeout(() => a.classList.remove('walking'), delay + walk);
      a._timers = [t1, t2];
      anim.onfinish = () => { a.style.transform = ''; a.classList.add('floating'); };
      lastEnd = Math.max(lastEnd, delay + walk + rise);
    });

    const tEnd = setTimeout(settle, lastEnd - 500);
    stage._settleTimer = tEnd;
  }, []);

  // Network lines and dots, built once from the same geometry the design
  // uses: each agent's visual centre in source-pixel space, every non-lead
  // agent joined to the lead.
  useEffect(() => {
    const L = linesRef.current;
    const D = dotsRef.current;
    if (!L || !D) return;
    L.innerHTML = ''; D.innerHTML = '';
    const centers = AGENTS.map(({ x, y, w }) => ({
      x: (parseFloat(x) + parseFloat(w) / 2) * 12.54,
      y: (parseFloat(y) + (parseFloat(w) * 1.2) / 2) * 12.54,
    }));
    const lead = AGENTS.findIndex((a) => a.lead);
    let i = 0;
    centers.forEach((c, idx) => {
      if (idx === lead) return;
      const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ln.setAttribute('x1', c.x); ln.setAttribute('y1', c.y);
      ln.setAttribute('x2', centers[lead].x); ln.setAttribute('y2', centers[lead].y);
      ln.style.setProperty('--i', i++);
      L.appendChild(ln);
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', c.x); dot.setAttribute('cy', c.y); dot.setAttribute('r', 4);
      dot.style.setProperty('--i', idx);
      D.appendChild(dot);
    });
  }, []);

  // The original runs on window load. Here the component mounting is the
  // equivalent moment. Timers are cleared on unmount so switching tabs
  // mid-walk cannot leave callbacks running against a gone DOM.
  useEffect(() => {
    play();
    const stage = stageRef.current;
    return () => {
      clearTimeout(stage?._settleTimer);
      stage?.querySelectorAll('.agent').forEach((a) => {
        (a._timers || []).forEach(clearTimeout);
        a.getAnimations?.().forEach((an) => an.cancel());
      });
    };
  }, [play]);

  return (
    <div className="agent-hero">
      <section className="hero" ref={heroRef}>
        <div className="stage" ref={stageRef}>
          <div className="halo" />

          <svg className="net" viewBox="0 0 1254 1254" aria-hidden="true">
            <defs>
              <linearGradient id="g" x1="0" x2="1">
                <stop offset="0" stopColor="#ffd27a" stopOpacity=".9" />
                <stop offset="1" stopColor="#ffa14a" stopOpacity=".6" />
              </linearGradient>
            </defs>
            <g ref={linesRef} />
            <g ref={dotsRef} />
          </svg>

          {AGENTS.map((a) => (
            <div
              key={a.img}
              className={`agent${a.lead ? ' lead' : ''}`}
              data-side={a.side}
              data-order={a.order}
              style={{ '--x': a.x, '--y': a.y, '--w': a.w, '--hip': a.hip }}
            >
              <span className="body">
                <span className="shadow" />
                <img className="part torso" src={`${A}/${a.img}.png`} alt="" />
                <img className="part leg l" src={`${A}/${a.img}.png`} alt="" />
                <img className="part leg r" src={`${A}/${a.img}.png`} alt="" />
              </span>
            </div>
          ))}
        </div>

        <div className="copy">
          <h1>Autonomous agents, one verifiable network</h1>
          <p>Discover, connect and trust agents across chains.</p>
          {/* The design's "Explore the catalog" link, wired to the tab it
              describes rather than an href="#". */}
          <a
            href="/market"
            onClick={(e) => { e.preventDefault(); onEnterMarketplace?.(); }}
          >
            Explore the catalog
          </a>
        </div>

        <button className="replay" type="button" onClick={play}>Replay</button>
      </section>
    </div>
  );
}
