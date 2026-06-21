from PIL import Image, ImageDraw, ImageFont

CHARCOAL = (44, 47, 54, 255)
WHITE = (255, 255, 255, 255)
FONT_PATH = r"C:\Windows\Fonts\ariblk.ttf"

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
        f = ImageFont.truetype(FONT_PATH, fs)
        bb = d.textbbox((0,0), "REGROUP", font=f)
        w = bb[2]-bb[0]
        if w >= target or fs > S: break
        fs += 4
    while True:
        f = ImageFont.truetype(FONT_PATH, fs)
        bb = d.textbbox((0,0), "REGROUP", font=f)
        if (bb[2]-bb[0]) <= target or fs < 8: break
        fs -= 2
    f = ImageFont.truetype(FONT_PATH, fs)
    bb = d.textbbox((0,0), "REGROUP", font=f)
    tw, th = bb[2]-bb[0], bb[3]-bb[1]
    d.text((cx-tw/2-bb[0], cy-th/2-bb[1]), "REGROUP", font=f, fill=WHITE)
    img = img.resize((size,size), Image.LANCZOS)
    img.save(out)
    print("wrote", out, size)

for s,o in [(512,"icon-512.png"),(192,"icon-192.png"),(180,"icon-180.png")]:
    make_icon(s,o)
