/**
 * Self-contained HTML/SVG used as if an agent had generated them into design_iterations/.
 */

export const CAFE_MENU_V1 = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>E2E Café v1</title>
<style>
  :root { --bg: #1a1612; --card: #2d2824; --accent: #c9a227; --text: #f5f0e8; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; font-family: ui-sans-serif, system-ui, sans-serif;
    background: radial-gradient(ellipse at 20% 0%, #3d3028 0%, var(--bg) 55%); color: var(--text); padding: 24px; }
  .e2e-hero { max-width: 420px; margin: 0 auto; }
  [data-testid="e2e-design-title"] { font-size: 1.75rem; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 8px; color: var(--accent); }
  .e2e-sub { opacity: 0.85; font-size: 0.95rem; margin-bottom: 20px; }
  .e2e-card { background: var(--card); border-radius: 16px; padding: 20px; border: 1px solid rgba(201,162,39,0.25);
    box-shadow: 0 16px 48px rgba(0,0,0,0.35); }
  .e2e-items { list-style: none; padding: 0; margin: 0; }
  .e2e-items li { padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; justify-content: space-between; }
  .e2e-items li:last-child { border-bottom: 0; }
  .e2e-price { color: var(--accent); font-weight: 600; }
</style>
</head>
<body>
  <main class="e2e-hero" data-testid="e2e-root">
    <h1 data-testid="e2e-design-title">Night Owl Café</h1>
    <p class="e2e-sub">Generated design • v1</p>
    <div class="e2e-card">
      <ul class="e2e-items">
        <li><span>Espresso</span><span class="e2e-price">$3</span></li>
        <li><span>Cardamom bun</span><span class="e2e-price">$5</span></li>
      </ul>
    </div>
  </main>
</body>
</html>`;

export const CAFE_MENU_V2 = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>E2E Café v2</title>
<style>
  :root { --bg: #0f1419; --card: #1c2430; --accent: #7dd3fc; --text: #e8eef5; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; font-family: ui-sans-serif, system-ui, sans-serif;
    background: linear-gradient(165deg, #1a2332 0%, var(--bg) 50%); color: var(--text); padding: 24px; }
  .e2e-hero { max-width: 420px; margin: 0 auto; }
  [data-testid="e2e-design-title"] { font-size: 1.75rem; font-weight: 700; margin: 0 0 8px; color: var(--accent); }
  .e2e-sub { opacity: 0.9; font-size: 0.95rem; margin-bottom: 20px; }
  .e2e-card { background: var(--card); border-radius: 16px; padding: 20px; border: 1px solid rgba(125,211,252,0.3); }
  .e2e-items { list-style: none; padding: 0; margin: 0; }
  .e2e-items li { padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: space-between; }
  .e2e-items li:last-child { border-bottom: 0; }
  .e2e-price { color: var(--accent); font-weight: 600; }
</style>
</head>
<body>
  <main class="e2e-hero" data-testid="e2e-root">
    <h1 data-testid="e2e-design-title">Night Owl Café</h1>
    <p class="e2e-sub">Iteration v2 — cooler palette</p>
    <div class="e2e-card">
      <ul class="e2e-items">
        <li><span>Flat white</span><span class="e2e-price">$4</span></li>
        <li><span>Almond croissant</span><span class="e2e-price">$6</span></li>
      </ul>
    </div>
  </main>
</body>
</html>`;

/** Branch variant: parent path cafeteria_1 → cafeteria_1_2.html */
export const CAFE_BRANCH_ALT = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>E2E Café branch</title>
<style>
  body { margin:0; min-height:100vh; font-family: system-ui; background: #2a1810; color: #fde8d4; padding: 20px; }
  [data-testid="e2e-design-title"] { font-size: 1.5rem; color: #ffb86b; }
</style>
</head>
<body>
  <main data-testid="e2e-root">
    <h1 data-testid="e2e-design-title">Branch menu</h1>
    <p>Alternate line under cafeteria_1</p>
  </main>
</body>
</html>`;

export const CAFE_NEW_LINE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><title>E2E second concept</title>
<style>body{margin:0;padding:24px;font-family:system-ui;background:#1e1e2e;color:#cdd6f4;}
[data-testid="e2e-design-title"]{color:#cba6f7;}</style>
</head>
<body>
  <h1 data-testid="e2e-design-title">Second concept</h1>
  <p>Hot-reload file</p>
</body>
</html>`;

export const BADGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="E2E badge">
  <rect width="120" height="120" rx="16" fill="#313244"/>
  <circle cx="60" cy="55" r="28" fill="#cba6f7"/>
  <text x="60" y="62" text-anchor="middle" fill="#1e1e2e" font-size="14" font-family="system-ui,sans-serif" font-weight="700">E2E</text>
</svg>`;
