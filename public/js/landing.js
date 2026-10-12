// Haske 2027 landing page: renders the editable content, the 3D hero scene,
// scroll effects, the 3D gallery ring, and the super admin's in-page editor.

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const params = new URLSearchParams(location.search);
let content = null;
let editing = false;

// Stand-in emblem until the real APM logo is uploaded: a cassava leaf on a gold disc.
const DEFAULT_LOGO = `
<svg viewBox="0 0 64 64" role="img" aria-label="APM emblem">
  <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0d58c"/><stop offset="1" stop-color="#c4932c"/></linearGradient></defs>
  <circle cx="32" cy="32" r="30" fill="url(#lg)"/>
  <circle cx="32" cy="32" r="25" fill="#ffffff"/>
  <g fill="#138a55" transform="translate(32 36)">
    <path d="M0 0 C-3 -8 -3 -16 0 -22 C3 -16 3 -8 0 0Z"/>
    <path d="M0 0 C-3 -8 -3 -16 0 -22 C3 -16 3 -8 0 0Z" transform="rotate(-38)"/>
    <path d="M0 0 C-3 -8 -3 -16 0 -22 C3 -16 3 -8 0 0Z" transform="rotate(38)"/>
    <path d="M0 0 C-2.5 -7 -2.5 -13 0 -18 C2.5 -13 2.5 -7 0 0Z" transform="rotate(-74)"/>
    <path d="M0 0 C-2.5 -7 -2.5 -13 0 -18 C2.5 -13 2.5 -7 0 0Z" transform="rotate(74)"/>
  </g>
  <rect x="31" y="35" width="2" height="12" rx="1" fill="#0f4a31"/>
</svg>`;

// ---------- content helpers ----------

function getPath(obj, key) {
  return key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, key, value) {
  const parts = key.split(".");
  const last = parts.pop();
  const target = parts.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
}

function bindText(root = document) {
  root.querySelectorAll("[data-edit]").forEach((el) => {
    const value = getPath(content, el.dataset.edit);
    if (document.activeElement !== el) el.textContent = value ?? "";
    if (editing) {
      el.contentEditable = "plaintext-only";
      if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
      el.spellcheck = true;
    }
  });
  root.querySelectorAll("[data-edit-img]").forEach((img) => {
    const src = getPath(content, img.dataset.editImg);
    if (src) img.src = src;
  });
}

function renderLogos() {
  const logo = content.brand?.logo || "/img/apm-logo.jpg";
  document.querySelectorAll("[data-isp-logo]").forEach((el, i) => {
    if (!el.firstChild) el.innerHTML = window.ispLogoSVG ? window.ispLogoSVG(`isp${i}`) : "";
  });
  document.querySelectorAll("[data-logo]").forEach((el) => {
    if (logo) {
      el.replaceChildren(Object.assign(document.createElement("img"), { src: logo, alt: "APM logo" }));
    } else {
      el.innerHTML = DEFAULT_LOGO;
    }
  });
}

function renderFacts() {
  const box = document.getElementById("facts");
  box.replaceChildren(
    ...(content.about.facts || []).map((fact, i) => {
      const card = document.createElement("div");
      card.className = "fact reveal";
      card.innerHTML = `<strong data-edit="about.facts.${i}.value"></strong><span data-edit="about.facts.${i}.label"></span>`;
      return card;
    })
  );
}

function renderAgenda() {
  const pillars = content.agenda.pillars || [];
  document.getElementById("acronym").replaceChildren(
    ...pillars.map((p) => Object.assign(document.createElement("span"), { textContent: p.letter }))
  );
  document.getElementById("pillars").replaceChildren(
    ...pillars.map((p, i) => {
      const card = document.createElement("article");
      card.className = "pillar reveal";
      card.dataset.tilt = "";
      card.dataset.index = i;
      card.innerHTML = `
        <span class="pillar-num">0${i + 1}</span>
        <span class="pillar-letter" data-edit="agenda.pillars.${i}.letter"></span>
        <h3 data-edit="agenda.pillars.${i}.title"></h3>
        <p data-edit="agenda.pillars.${i}.body"></p>`;
      return card;
    })
  );
}

function renderAll() {
  renderLogos();
  renderFacts();
  renderAgenda();
  renderCarousel();
  if (editing) renderGalleryEditor();
  bindText();
  observeReveals();
  attachTilt();
}

// ---------- scroll reveal, nav, acronym ----------

let revealObserver;
function observeReveals() {
  if (!revealObserver) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
  }
  document.querySelectorAll(".reveal:not(.in)").forEach((el, i) => {
    el.style.transitionDelay = `${Math.min(i % 6, 5) * 70}ms`;
    revealObserver.observe(el);
  });
}

const nav = document.getElementById("nav");
addEventListener("scroll", () => nav.classList.toggle("scrolled", scrollY > 40), { passive: true });

// Light up the A-D-A-M-A-W-A letters one by one as the pillars scroll past.
const pillarObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      const letter = document.querySelectorAll("#acronym span")[entry.target.dataset.index];
      if (letter) letter.classList.toggle("lit", entry.isIntersecting);
    });
  },
  { threshold: 0.6 }
);

// ---------- 3D tilt ----------

function attachTilt() {
  document.querySelectorAll("[data-tilt]:not([data-tilt-ready])").forEach((el) => {
    el.dataset.tiltReady = "1";
    if (el.classList.contains("pillar")) pillarObserver.observe(el);
    if (reduceMotion || matchMedia("(hover: none)").matches) return;
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `rotateY(${x * 10}deg) rotateX(${-y * 10}deg)`;
      el.style.setProperty("--mx", `${(x + 0.5) * 100}%`);
      el.style.setProperty("--my", `${(y + 0.5) * 100}%`);
    });
    el.addEventListener("pointerleave", () => (el.style.transform = ""));
  });
}

// Hero portrait follows the mouse in 3D.
const stage = document.getElementById("portraitStage");
const hero = document.getElementById("hero");
const pointer = { x: 0, y: 0 };
hero.addEventListener("pointermove", (e) => {
  pointer.x = e.clientX / innerWidth - 0.5;
  pointer.y = e.clientY / innerHeight - 0.5;
  if (!reduceMotion) stage.style.transform = `rotateY(${pointer.x * 16}deg) rotateX(${-pointer.y * 12}deg)`;
});
hero.addEventListener("pointerleave", () => {
  pointer.x = pointer.y = 0;
  stage.style.transform = "";
});

// ---------- 3D gallery ring ----------

let ringAngle = 0;
let ringVelocity = 0;
let dragging = false;
let ringCount = 0;

function renderCarousel() {
  const ring = document.getElementById("carousel");
  let images = (content.gallery.images || []).filter(Boolean);
  if (!images.length) images = [content.hero.image];
  // Repeat pictures so the ring always looks full.
  const slots = [];
  while (slots.length < Math.max(8, images.length)) slots.push(images[slots.length % images.length]);
  ringCount = slots.length;
  const width = ring.offsetWidth || 260;
  const radius = Math.round(width / 2 / Math.tan(Math.PI / ringCount)) + 40;
  ring.style.setProperty("--radius", `${radius}px`);
  ring.replaceChildren(
    ...slots.map((src, i) => {
      const fig = document.createElement("figure");
      fig.style.transform = `rotateY(${(360 / ringCount) * i}deg) translateZ(${radius}px)`;
      fig.append(Object.assign(document.createElement("img"), { src, alt: "Haske campaign photo", loading: "lazy" }));
      return fig;
    })
  );
  ring.dataset.radius = radius;
}

function spinRing() {
  const ring = document.getElementById("carousel");
  if (!dragging) {
    ringVelocity *= 0.95;
    ringAngle += ringVelocity + (reduceMotion ? 0 : 0.08);
  }
  ring.style.transform = `translateZ(${-ring.dataset.radius}px) rotateY(${ringAngle}deg)`;
  requestAnimationFrame(spinRing);
}

(function setupRingDrag() {
  const scene = document.getElementById("carouselScene");
  let lastX = 0;
  scene.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    scene.setPointerCapture(e.pointerId);
  });
  scene.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    ringVelocity = dx * 0.25;
    ringAngle += ringVelocity;
  });
  const stop = () => (dragging = false);
  scene.addEventListener("pointerup", stop);
  scene.addEventListener("pointercancel", stop);
})();

// ---------- hero WebGL scene: golden fields rolling across the hills of Adamawa ----------

async function startHeroScene() {
  const canvas = document.getElementById("heroCanvas");
  let THREE;
  try {
    THREE = await import("three");
  } catch {
    return startFallbackScene(canvas); // 3D library could not load (offline).
  }
  // Some computers have WebGL switched off; test on a spare canvas so the real one stays usable.
  if (!document.createElement("canvas").getContext("webgl")) return startFallbackScene(canvas);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
  } catch {
    return startFallbackScene(canvas);
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  camera.position.set(0, 5, 20);

  const cols = 170;
  const rows = 90;
  const positions = new Float32Array(cols * rows * 3);
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      positions[n++] = (c - cols / 2) * 0.55;
      positions[n++] = 0;
      positions[n++] = -r * 0.55 + 8;
    }
  }
  const field = new THREE.BufferGeometry();
  field.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const uniforms = {
    uTime: { value: 0 },
    uPixel: { value: renderer.getPixelRatio() },
    uGold: { value: new THREE.Color("#e7bf5a") },
    uGreen: { value: new THREE.Color("#1aa866") },
  };
  const fieldMaterial = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime; uniform float uPixel;
      varying float vHeight; varying float vDepth;
      void main() {
        vec3 p = position;
        float h = sin(p.x * 0.16 + uTime * 0.5) * 0.9
                + cos(p.z * 0.21 + uTime * 0.35) * 0.8
                + sin((p.x + p.z) * 0.07) * 2.6
                + smoothstep(-20.0, -45.0, p.z) * (sin(p.x * 0.09) * 5.0 + 4.0);
        p.y = h - 4.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPixel * 30.0 / -mv.z;
        vHeight = h; vDepth = -mv.z;
      }`,
    fragmentShader: `
      uniform vec3 uGold; uniform vec3 uGreen;
      varying float vHeight; varying float vDepth;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        vec3 color = mix(uGreen, uGold, smoothstep(-0.5, 3.5, vHeight));
        float fade = smoothstep(70.0, 12.0, vDepth) * smoothstep(2.0, 8.0, vDepth);
        gl_FragColor = vec4(color, (1.0 - d * 2.0) * fade * 0.85);
      }`,
  });
  scene.add(new THREE.Points(field, fieldMaterial));

  // Floating golden dust.
  const dustCount = 350;
  const dust = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dust[i * 3] = (Math.random() - 0.5) * 60;
    dust[i * 3 + 1] = Math.random() * 18 - 3;
    dust[i * 3 + 2] = -Math.random() * 40 + 10;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dust, 3));
  const dustPoints = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({ color: 0xf0d58c, size: 0.09, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  scene.add(dustPoints);

  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  addEventListener("resize", resize);

  let visible = true;
  new IntersectionObserver(([entry]) => (visible = entry.isIntersecting)).observe(canvas);

  const clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    if (!visible) return;
    const t = clock.getElapsedTime();
    uniforms.uTime.value = t;
    dustPoints.rotation.y = t * 0.01;
    dustPoints.position.y = Math.sin(t * 0.3) * 0.4;
    camera.position.x += (pointer.x * 3 - camera.position.x) * 0.04;
    camera.position.y += (5 - pointer.y * 1.5 - camera.position.y) * 0.04;
    camera.lookAt(0, 0, -12);
    renderer.render(scene, camera);
  }
  if (reduceMotion) {
    camera.lookAt(0, 0, -12);
    renderer.render(scene, camera);
  } else {
    frame();
  }
}

// Same golden hills drawn with plain 2D canvas, for computers without WebGL.
function startFallbackScene(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const cols = 90;
  const rows = 46;
  let w = 0;
  let h = 0;
  let visible = true;
  new IntersectionObserver(([entry]) => (visible = entry.isIntersecting)).observe(canvas);

  function resize() {
    const ratio = Math.min(devicePixelRatio, 1.5);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * ratio;
    canvas.height = h * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  resize();
  addEventListener("resize", resize);

  const gold = [231, 191, 90];
  const green = [26, 168, 102];
  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    const camX = pointer.x * 3;
    const camY = 2.5 - pointer.y * 1.5;
    const focal = h * 0.9;
    for (let r = 0; r < rows; r++) {
      const z = -r * 1.0 + 8;
      for (let c = 0; c < cols; c++) {
        const x = (c - cols / 2) * 1.0;
        let y = Math.sin(x * 0.16 + t * 0.5) * 0.9 + Math.cos(z * 0.21 + t * 0.35) * 0.8 + Math.sin((x + z) * 0.07) * 2.6;
        if (z < -20) y += Math.min((-20 - z) / 25, 1) * (Math.sin(x * 0.09) * 5 + 4);
        const depth = 20 - z;
        if (depth < 2) continue;
        const sx = w / 2 + ((x - camX) * focal) / depth;
        const sy = h * 0.38 - ((y - 4.5 - camY) * focal) / depth;
        if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;
        const mix = Math.min(Math.max((y + 0.5) / 4, 0), 1);
        const fade = Math.min(Math.max((70 - depth) / 58, 0), 1) * Math.min(Math.max((depth - 2) / 6, 0), 1);
        const col = green.map((g, i) => Math.round(g + (gold[i] - g) * mix));
        ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${fade})`;
        const size = Math.max(1.3, 40 / depth);
        ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  if (reduceMotion) return draw(0);
  const start = performance.now();
  (function frame(now) {
    requestAnimationFrame(frame);
    if (visible) draw((now - start) / 1000);
  })(start);
}

// ---------- super admin editor ----------

const picker = document.getElementById("imagePicker");
let pickTarget = null;

function pickImage(onDone) {
  pickTarget = onDone;
  picker.value = "";
  picker.click();
}

// The live site (Vercel) refuses requests over about 4.5 MB, and pictures travel as text that is a third
// larger than the file, so every upload is kept under this size.
const MAX_UPLOAD_CHARS = 3_500_000;

// Large photos are resized in the browser (longest side 1800px) so uploads stay small and fast.
// If the result is still too big (a photo saved as PNG, for example), it is saved again as WEBP or JPG,
// at lower quality and then smaller sizes, until it fits.
async function shrinkImage(file) {
  const asDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  if (file.type === "image/svg+xml" || file.size < 900_000) return asDataUrl(file);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return asDataUrl(file);
  }
  const canvas = document.createElement("canvas");
  const draw = (longest) => {
    const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  };
  draw(1800);
  // PNG first for PNGs (keeps sharp logos sharp); WEBP keeps see-through backgrounds; JPG works everywhere.
  const attempts = [
    ...(file.type === "image/png" ? [[1800, "image/png"]] : []),
    [1800, "image/webp", 0.85],
    [1800, "image/jpeg", 0.85],
    [1800, "image/webp", 0.7],
    [1800, "image/jpeg", 0.7],
    [1400, "image/webp", 0.75],
    [1400, "image/jpeg", 0.75],
    [1000, "image/jpeg", 0.75],
  ];
  let size = 1800;
  for (const [longest, type, quality] of attempts) {
    if (longest !== size) draw((size = longest));
    const dataUrl = canvas.toDataURL(type, quality);
    // Browsers that can't make WEBP quietly return PNG instead; the size check below still applies.
    if (dataUrl.length <= MAX_UPLOAD_CHARS) return dataUrl;
  }
  return canvas.toDataURL("image/jpeg", 0.6);
}

picker.addEventListener("change", async () => {
  const file = picker.files[0];
  if (!file || !pickTarget) return;
  setStatus("Uploading picture…");
  try {
    const dataUrl = await shrinkImage(file);
    if (dataUrl.length > MAX_UPLOAD_CHARS) {
      return setStatus("That picture is too large to upload. Use a smaller JPG or PNG.");
    }
    const res = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl }),
    });
    // A refused upload can come back as plain text instead of JSON.
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return setStatus(data.error || (res.status === 413 ? "That picture is too large to upload. Use a smaller one." : "Upload failed. Try again."));
    }
    pickTarget(data.url);
    markDirty();
  } catch {
    setStatus("Upload failed. Check your connection and try again.");
  }
});

function renderGalleryEditor() {
  const editor = document.getElementById("galleryEditor");
  editor.hidden = false;
  const grid = document.getElementById("galleryGrid");
  const images = content.gallery.images;
  grid.replaceChildren(
    ...images.map((src, i) => {
      const tile = document.createElement("div");
      tile.className = "gallery-tile";
      tile.append(Object.assign(document.createElement("img"), { src, alt: "" }));
      const remove = Object.assign(document.createElement("button"), { type: "button", textContent: "Remove" });
      remove.addEventListener("click", () => {
        images.splice(i, 1);
        markDirty();
        renderAll();
      });
      tile.append(remove);
      return tile;
    }),
    (() => {
      const add = Object.assign(document.createElement("button"), { type: "button", className: "gallery-add", textContent: "+ Add picture" });
      add.addEventListener("click", () =>
        pickImage((url) => {
          images.push(url);
          renderAll();
        })
      );
      return add;
    })()
  );
}

let dirty = false;
function setStatus(text) {
  document.getElementById("editStatus").textContent = text;
}
function markDirty() {
  dirty = true;
  setStatus("Unsaved changes");
}

async function startEditor() {
  try {
    const res = await fetch("/api/me");
    if (!res.ok) return;
    const { user } = await res.json();
    if (user.role !== "super_admin") return;
  } catch {
    return;
  }
  editing = true;
  document.body.classList.add("editing");
  document.getElementById("editBar").hidden = false;
  renderAll();

  // Typing into any editable text updates the content.
  document.addEventListener("input", (e) => {
    const key = e.target.dataset?.edit;
    if (!key) return;
    setPath(content, key, e.target.innerText.trim());
    if (key.startsWith("agenda.pillars")) {
      document.getElementById("acronym").replaceChildren(
        ...content.agenda.pillars.map((p) => Object.assign(document.createElement("span"), { textContent: p.letter }))
      );
    }
    markDirty();
  });

  // In edit mode, clicks change things instead of following links.
  document.addEventListener(
    "click",
    (e) => {
      const img = e.target.closest("[data-edit-img]");
      const logo = e.target.closest("[data-logo]");
      if (img) {
        e.preventDefault();
        pickImage((url) => {
          setPath(content, img.dataset.editImg, url);
          bindText();
        });
      } else if (logo) {
        e.preventDefault();
        pickImage((url) => {
          content.brand.logo = url;
          renderLogos();
        });
      }
      if (e.target.closest("a[href]") && !e.target.closest("#editBar")) e.preventDefault();
    },
    true
  );

  document.getElementById("editSave").addEventListener("click", async () => {
    setStatus("Saving…");
    const res = await fetch("/api/content", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setStatus(data.error || "Could not save.");
    dirty = false;
    setStatus("Saved ✓");
  });

  document.getElementById("editDiscard").addEventListener("click", () => {
    if (!dirty || confirm("Throw away your unsaved changes?")) location.reload();
  });

  addEventListener("beforeunload", (e) => {
    if (dirty) e.preventDefault();
  });
}

// ---------- start ----------

async function init() {
  const res = await fetch("/api/content");
  content = (await res.json()).content;
  renderAll();
  // The hero is on screen at load, so show it straight away instead of waiting for the scroll observer.
  document.querySelectorAll("#hero .reveal").forEach((el) => el.classList.add("in"));
  requestAnimationFrame(spinRing);
  startHeroScene();
  if (params.get("edit") === "1") startEditor();
}

init();
