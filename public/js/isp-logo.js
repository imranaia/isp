// ISP emblem: four stacked tiers for the structure (State, LGA, Ward, Polling Unit)
// inside a gold hexagon. Each tier is its own layer so CSS can float them apart in 3D.
(function () {
  const COLORS = [
    ["#138a55", "#0d6b41", "#0a5333"],
    ["#3f9f4f", "#2c7a39", "#215d2b"],
    ["#a8a83c", "#86862a", "#66661f"],
    ["#f0d58c", "#d9ab3f", "#b8862a"],
  ];

  function tier(i) {
    const w = 34 - i * 7;
    const y = 43 - i * 7.5;
    const t = 3.2;
    const l = 32 - w / 2;
    const r = 32 + w / 2;
    const q = w / 4;
    const [top, left, right] = COLORS[i];
    return `<g class="isp-tier isp-tier-${i}">
      <polygon points="${l},${y} 32,${y + q} 32,${y + q + t} ${l},${y + t}" fill="${left}"/>
      <polygon points="32,${y + q} ${r},${y} ${r},${y + t} 32,${y + q + t}" fill="${right}"/>
      <polygon points="${l},${y} 32,${y - q} ${r},${y} 32,${y + q}" fill="${top}"/>
    </g>`;
  }

  window.ispLogoSVG = function (uid = "isp") {
    return `<svg class="isp-emblem" viewBox="0 0 64 64" role="img" aria-label="ISP, Independent Structure Platform">
      <defs>
        <linearGradient id="${uid}-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#f6e2a6"/><stop offset=".5" stop-color="#d9ab3f"/><stop offset="1" stop-color="#9c6f1f"/>
        </linearGradient>
        <radialGradient id="${uid}-core" cx=".5" cy=".35" r=".75">
          <stop offset="0" stop-color="#0f4a31"/><stop offset="1" stop-color="#03140d"/>
        </radialGradient>
      </defs>
      <polygon class="isp-hex" points="32,2 58,17 58,47 32,62 6,47 6,17" fill="url(#${uid}-core)" stroke="url(#${uid}-ring)" stroke-width="3" stroke-linejoin="round"/>
      <polygon points="32,8 53,20 53,44 32,56 11,44 11,20" fill="none" stroke="rgba(240,213,140,.25)" stroke-width="1"/>
      ${[0, 1, 2, 3].map(tier).join("")}
      <circle class="isp-spark" cx="32" cy="12.5" r="1.6" fill="#fff6d8"/>
    </svg>`;
  };
})();
