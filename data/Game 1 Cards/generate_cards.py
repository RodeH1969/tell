from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageFilter, ImageEnhance, ImageChops

BASE = Path(r"C:\Users\User\Documents\tell")
SRC = BASE / "data" / "Game1"
OUT = BASE / "data" / "Game 1 Cards"
LOGO = BASE / "public" / "logo.jpeg"
OUT.mkdir(parents=True, exist_ok=True)

FILES = [
    "Adam Smith.png","Ben Shapiro.png","Benjamin Franklin.png","Bobby Charlton.png","Charlie Chaplin.png",
    "Edmund Hilary.jpg","George Washington.png","James Cook.png","JD Salinger.jpg","John Newcombe.png",
    "Johnny Carson.png","Keith Miller.jpeg","Liberace.jpg","Mark Twain.png","Micahel Caine.png",
    "Mozart.png","Nikola Tesla.png","Pete Hegseth.png","Pierre Trudeau.jpg","Randy Orton.png",
    "Richard Burton.png","Richie Mccaw.png","Robert Kennedy Jnr.png","Sigmund Freud.png","Winston Churchill.png"
]

SUITS = [
    ("♥", (165, 26, 52)),
    ("♦", (196, 42, 54)),
    ("♣", (32, 92, 54)),
    ("♠", (28, 28, 28)),
]

W, H = 900, 1260
CARD_RADIUS = 42
OUTER = 18
INNER = 42
PORTRAIT_BOX = (116, 118, 784, 938)

FONT_PATHS = [
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\arial.ttf",
    r"C:\Windows\Fonts\timesbd.ttf",
    r"C:\Windows\Fonts\times.ttf",
]

def font(size, bold=False):
    preferred = FONT_PATHS if bold else FONT_PATHS[::-1]
    for p in preferred:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            pass
    return ImageFont.load_default()

SUIT_FONT = font(86, True)
BOTTOM_SUIT = font(44, True)


def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return m


def add_shadow(im, blur=18, offset=(0, 20), color=(0, 0, 0, 82)):
    base = Image.new("RGBA", (im.width + 90, im.height + 90), (0, 0, 0, 0))
    shadow = Image.new("RGBA", im.size, color)
    mask = im.getchannel("A") if "A" in im.getbands() else Image.new("L", im.size, 255)
    base.paste(shadow, (45 + offset[0], 28 + offset[1]), mask)
    base = base.filter(ImageFilter.GaussianBlur(blur))
    base.alpha_composite(im, (45, 28))
    return base


def fit_cover(img, size, centering=(0.5, 0.38)):
    return ImageOps.fit(img, size, method=Image.Resampling.LANCZOS, centering=centering)


def improve_portrait(img):
    img = ImageOps.exif_transpose(img).convert("RGB")
    img = ImageEnhance.Contrast(img).enhance(1.1)
    img = ImageEnhance.Color(img).enhance(0.96)
    img = ImageEnhance.Sharpness(img).enhance(1.1)
    return img


def vignette(size, strength=90):
    w, h = size
    layer = Image.new("L", size, 0)
    d = ImageDraw.Draw(layer)
    for i in range(170):
        alpha = int((i / 169) * strength)
        d.rounded_rectangle((i, i, w - i - 1, h - i - 1), radius=max(10, 26 - i // 10), outline=alpha)
    return layer.filter(ImageFilter.GaussianBlur(28))


def crop_logo(img):
    img = ImageOps.exif_transpose(img).convert("RGBA")
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    flat = img.convert("RGB")
    bg = Image.new("RGB", flat.size, flat.getpixel((0, 0)))
    diff = ImageChops.difference(flat, bg)
    bbox2 = diff.getbbox()
    if bbox2:
        img = img.crop(bbox2)
    return img


def draw_corner_suit(card, suit, color, top=True):
    temp = Image.new("RGBA", (150, 150), (0, 0, 0, 0))
    d = ImageDraw.Draw(temp)
    box = d.textbbox((0, 0), suit, font=SUIT_FONT)
    tw, th = box[2] - box[0], box[3] - box[1]
    d.text(((150 - tw) // 2, (150 - th) // 2 - 10), suit, font=SUIT_FONT, fill=color)
    if top:
        card.alpha_composite(temp, (18, 18))
    else:
        card.alpha_composite(temp.rotate(180), (W - 168, H - 168))


def base_card():
    card = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle((0, 0, W - 1, H - 1), radius=CARD_RADIUS, fill=(251, 248, 241, 255))
    d.rounded_rectangle((OUTER, OUTER, W - OUTER - 1, H - OUTER - 1), radius=36, outline=(229, 221, 208), width=3)
    d.rounded_rectangle((INNER, INNER, W - INNER - 1, H - INNER - 1), radius=26, outline=(211, 200, 183), width=2)
    return card


def draw_front(logo, suit, color, out_path):
    card = base_card()
    d = ImageDraw.Draw(card)
    draw_corner_suit(card, suit, color, True)
    draw_corner_suit(card, suit, color, False)

    logo = crop_logo(logo)
    logo.thumbnail((520, 520), Image.Resampling.LANCZOS)
    lx = (W - logo.width) // 2
    ly = (H - logo.height) // 2

    glow = Image.new("RGBA", (logo.width + 70, logo.height + 70), (0, 0, 0, 0))
    shadow_shape = Image.new("RGBA", logo.size, (0, 0, 0, 70))
    alpha = logo.getchannel("A") if "A" in logo.getbands() else Image.new("L", logo.size, 255)
    shadow_shape.putalpha(alpha)
    glow.alpha_composite(shadow_shape, (35, 38))
    glow = glow.filter(ImageFilter.GaussianBlur(20))
    card.alpha_composite(glow, (lx - 35, ly - 20))
    card.alpha_composite(logo, (lx, ly))

    for y in (H // 2 - 260, H // 2 + 260):
        d.ellipse((W // 2 - 10, y - 10, W // 2 + 10, y + 10), outline=(*color, 110), width=2)
        d.ellipse((W // 2 - 4, y - 4, W // 2 + 4, y + 4), fill=(*color, 160))
    for x in (W // 2 - 280, W // 2 + 280):
        d.ellipse((x - 10, H // 2 - 10, x + 10, H // 2 + 10), outline=(*color, 110), width=2)
        d.ellipse((x - 4, H // 2 - 4, x + 4, H // 2 + 4), fill=(*color, 160))

    final = add_shadow(card)
    final.save(out_path, "PNG")


def draw_back(name, portrait, suit, color, out_path):
    card = base_card()
    d = ImageDraw.Draw(card)
    draw_corner_suit(card, suit, color, True)
    draw_corner_suit(card, suit, color, False)

    x1, y1, x2, y2 = PORTRAIT_BOX
    panel = Image.new("RGBA", (x2 - x1, y2 - y1), (241, 234, 222, 255))
    panel.putalpha(rounded_mask(panel.size, 30))
    card.alpha_composite(panel, (x1, y1))

    portrait = improve_portrait(portrait)
    fitted = fit_cover(portrait, (x2 - x1 - 24, y2 - y1 - 24)).convert("RGBA")
    fitted.putalpha(rounded_mask(fitted.size, 24))

    glow = Image.new("RGBA", (fitted.width + 28, fitted.height + 28), (0, 0, 0, 0))
    glow.alpha_composite(fitted, (14, 14))
    glow = glow.filter(ImageFilter.GaussianBlur(18))
    card.alpha_composite(glow, (x1 - 2, y1))
    card.alpha_composite(fitted, (x1 + 12, y1 + 12))

    shade = Image.new("RGBA", fitted.size, (0, 0, 0, 0))
    shade.putalpha(vignette(fitted.size, 78))
    card.alpha_composite(shade, (x1 + 12, y1 + 12))

    d.text((W // 2, H - 88), suit, font=BOTTOM_SUIT, anchor="mm", fill=color)

    final = add_shadow(card)
    final.save(out_path, "PNG")


def main():
    if not LOGO.exists():
        raise FileNotFoundError(f"Missing logo: {LOGO}")
    logo = Image.open(LOGO)
    for i, filename in enumerate(FILES):
        src = SRC / filename
        if not src.exists():
            print(f"Missing source image: {src}")
            continue
        name = Path(filename).stem
        portrait = Image.open(src)
        suit, color = SUITS[i % len(SUITS)]
        draw_front(logo, suit, color, OUT / f"{name} - front.png")
        draw_back(name, portrait, suit, color, OUT / f"{name} - back.png")
        print(f"Created: {name} [{suit}]")
    print(f"Saved PNG cards to: {OUT}")

if __name__ == "__main__":
    main()