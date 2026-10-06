const fs = require('fs');
let content = fs.readFileSync('portal_core.html', 'utf8');

// 1. settings-hero
content = content.replace(
  /\.settings-hero\{margin-bottom:18px;padding:25px 28px;border-radius:20px;background:linear-gradient\(135deg,#087f58 0%,#12916b 58%,#1aa77b 100%\);color:#fff;box-shadow:0 14px 30px rgba\(8,127,88,\.2\);position:relative;overflow:hidden\}/g,
  '.settings-hero{margin-bottom:18px;padding:25px 28px;border-radius:20px;background:var(--g1);border:1px solid var(--border);color:var(--white);box-shadow:var(--shadow);position:relative;overflow:hidden}'
);

content = content.replace(
  /\.settings-hero:after\{content:'';position:absolute;width:250px;height:250px;right:-80px;top:-145px;border-radius:50%;background:rgba\(255,255,255,\.12\)\}/g,
  ".settings-hero:after{content:'';position:absolute;width:250px;height:250px;right:-80px;top:-145px;border-radius:50%;background:rgba(255,255,255,.05)}"
);

content = content.replace(
  /\.settings-hero-kicker\{font-size:\.68rem;letter-spacing:\.18em;font-weight:800;opacity:\.78;text-transform:uppercase\}/g,
  ".settings-hero-kicker{font-size:.68rem;letter-spacing:.18em;font-weight:800;color:var(--gold2);text-transform:uppercase}"
);

content = content.replace(
  /\.settings-hero h2\{font-family:'Playfair Display',serif;font-size:1\.7rem;margin:7px 0 5px;position:relative;z-index:1\}/g,
  ".settings-hero h2{font-family:'Playfair Display',serif;font-size:1.7rem;margin:7px 0 5px;color:var(--white);position:relative;z-index:1}"
);

content = content.replace(
  /\.settings-hero p\{max-width:620px;font-size:\.82rem;line-height:1\.5;opacity:\.88;position:relative;z-index:1\}/g,
  ".settings-hero p{max-width:620px;font-size:.82rem;line-height:1.5;color:rgba(255,255,255,.8);position:relative;z-index:1}"
);

content = content.replace(
  /\.settings-hero-chip\{display:inline-flex;align-items:center;gap:8px;margin-top:16px;padding:8px 13px;border:1px solid rgba\(255,255,255,\.25\);border-radius:999px;background:rgba\(255,255,255,\.12\);font-size:\.72rem;font-weight:700;position:relative;z-index:1\}/g,
  ".settings-hero-chip{display:inline-flex;align-items:center;gap:8px;margin-top:16px;padding:8px 13px;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:rgba(255,255,255,.1);color:var(--white);font-size:.72rem;font-weight:700;position:relative;z-index:1}"
);

content = content.replace(
  /\.settings-hero-chip:before\{content:'';width:8px;height:8px;border-radius:50%;background:#d9ffed;box-shadow:0 0 0 4px rgba\(217,255,237,\.15\)\}/g,
  ".settings-hero-chip:before{content:'';width:8px;height:8px;border-radius:50%;background:var(--gold2);box-shadow:0 0 0 4px rgba(255,255,255,.15)}"
);


// 2. settings-category
content = content.replace(
  /\.settings-category\{border:0;border-radius:13px;background:transparent;color:#16634c;padding:13px 14px;text-align:left;font:700 \.8rem 'DM Sans',sans-serif;cursor:pointer;transition:\.16s\}/g,
  ".settings-category{border:0;border-radius:13px;background:transparent;color:var(--gray);padding:13px 14px;text-align:left;font:700 .8rem 'DM Sans',sans-serif;cursor:pointer;transition:.16s}"
);

content = content.replace(
  /\.settings-category:hover,\.settings-category:focus-visible\{background:#eefbf5;outline:none\}/g,
  ".settings-category:hover,.settings-category:focus-visible{background:var(--bg);outline:none;color:var(--g1)}"
);

content = content.replace(
  /\.settings-category\.active\{background:linear-gradient\(135deg,#087f58,#d5a62a\);color:#fff;box-shadow:0 8px 18px rgba\(8,127,88,\.16\)\}/g,
  ".settings-category.active{background:var(--g1);color:var(--gold2);box-shadow:var(--shadow)}"
);

content = content.replace(
  /\.settings-dashboard\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:4px;margin-bottom:18px;padding:7px;border:1px solid rgba\(125,212,176,\.65\);border-radius:18px;background:#fbfffd;box-shadow:var\(--shadow\)\}/g,
  ".settings-dashboard{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;margin-bottom:18px;padding:7px;border:1px solid var(--border);border-radius:18px;background:#fff;box-shadow:var(--shadow)}"
);

fs.writeFileSync('portal_core.html', content, 'utf8');
