import os
from PIL import Image, ImageDraw, ImageFont

CHARCOAL = (44, 47, 54, 255)
WHITE = (255, 255, 255, 255)

# Resolve a bold font across Windows / macOS / Linux. Falls back to PIL's
# built-in bitmap font if none of the common paths exist so the script still
# runs on CI/Linux runners (L5).
_FONT_CANDIDATES = [
    r"C:\Windows\Fonts\ariblk.ttf",                                   # Windows (Arial Black)
    "/System/Library/Fonts/Supplemental/Arial Black.ttf",            # macOS
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",          # Debian/Ubuntu
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",  # Fedora/RHEL
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
]

def _resolve_font_path():
    for p in _FONT_CANDIDATES:
        if os.path.exists(p):
            return p
    return None  # signal: use PIL default bitmap font

FONT_PATH = _resolve_font_path()

def _load_font(size):
    if FONT_PATH:
        return ImageFont.truetype(FONT_PATH, size)
    # No scalable font available — PIL's default font ignores size but lets the
    # script complete instead of crashing.
    return ImageFont.load_default()

def make_icon(size, out):
    SS = 4  # supersample for crisp edges
    S = size * SS
    img = Image.new("RGBA", (S, S), CHARCOAL)
    d = ImageDraw.Draw(img)
    cx, cy = S/2, S/2
    margin = S*0.075
    ew = S - 2*margin              # ellipse width
    eh = ew*0.42                   # ellipse height (oval)
    ring_w = int(S*0.035)
    box = [cx-ew/2, cy-eh/2, cx+ew/2, cy+eh/2]
    # ring (oval outline)
    d.ellipse(box, outline=WHITE, width=ring_w)
    # arrowhead lower-left, pointing up-right (suggests the regroup motion)
    ax, ay = cx-ew*0.30, cy+eh*0.46
    s = S*0.055
    d.polygon([(ax-s, ay+s*0.2),(ax+s*1.1, ay-s*0.1),(ax-s*0.1, ay-s*1.1)], fill=WHITE)
    # wordmark fit to ~86% of ellipse width
    target = ew*0.84
    fs = int(eh*0.9)
    while True:
        f = _load_font(fs)
        bb = d.textbbox((0,0), "REGROUP", font=f)
        w = bb[2]-bb[0]
        if w >= target or fs > S: break
        fs += 4
    while True:
        f = _load_font(fs)
        bb = d.textbbox((0,0), "REGROUP", font=f)
        if (bb[2]-bb[0]) <= target or fs < 8: break
        fs -= 2
    f = _load_font(fs)
    bb = d.textbbox((0,0), "REGROUP", font=f)
    tw, th = bb[2]-bb[0], bb[3]-bb[1]
    d.text((cx-tw/2-bb[0], cy-th/2-bb[1]), "REGROUP", font=f, fill=WHITE)
    img = img.resize((size,size), Image.LANCZOS)
    img.save(out)
    print("wrote", out, size)

for s,o in [(512,"icon-512.png"),(192,"icon-192.png"),(180,"icon-180.png")]:
    make_icon(s,o)
