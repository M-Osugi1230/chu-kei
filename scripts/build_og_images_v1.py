# Chu-kei Insight: OG画像生成 (1200x630)
# 企業ページ / テーマページ / トップページ用の Open Graph 画像を生成する。
# 数値は一次レビュー (operations/quality-rebase/phase2/primary-reviews/) の
# structuredAnalysis.financialTargets のうち classification が
# formal_plan_terminal_target のものだけを使う。検証済み目標が無い企業は
# 会社名・証券コード・市場・業種・確認ステータスのみを描く (数値は出さない)。
# 使い方: python3 scripts/build_og_images_v1.py
import gzip
import json
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
W, H = 1200, 630
BG = (246, 248, 251)
INK = (16, 42, 67)
ACC = (11, 114, 133)
MUT = (82, 102, 122)
LINE = (217, 226, 236)
WHITE = (255, 255, 255)
BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"

RESOLVED = {"current", "expired", "no_formal_plan", "found_unstructured"}
STATUS_LABEL = {
    "current": "現行の中期経営計画を確認済み",
    "expired": "期間が終了した中期経営計画を確認済み",
    "no_formal_plan": "正式な中期経営計画なしと確認済み",
    "found_unstructured": "非構造化の中期経営計画を確認済み",
}
MARKET_LABEL = {"Prime": "東証プライム", "Standard": "東証スタンダード", "Growth": "東証グロース"}
THEMES = [
    ("人的資本", "human-capital"), ("サステナビリティ", "sustainability"),
    ("株主還元", "shareholder-return"), ("資本効率", "capital-efficiency"),
    ("海外", "overseas"), ("DX", "dx"), ("AI", "ai"),
    ("事業成長", "business-growth"), ("生産性", "productivity"),
    ("M&A", "ma"), ("商品・サービス", "products-services"),
    ("設備投資", "capex"), ("事業再編", "restructuring"),
    ("事業ポートフォリオ", "business-portfolio"), ("研究開発", "rd"),
]
THEME_MINIMUM = 15


def F(path, size):
    return ImageFont.truetype(path, size)


def fmt_value(v):
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    if isinstance(v, int):
        return f"{v:,}"
    return str(v)


def fit_font(draw, text, path, start, min_size, max_width):
    size = start
    while size > min_size:
        f = F(path, size)
        if draw.textlength(text, font=f) <= max_width:
            return f, size
        size -= 2
    return F(path, min_size), min_size


def wrap(draw, text, font, max_width, max_lines=2):
    lines, cur = [], ""
    for ch in text:
        if draw.textlength(cur + ch, font=font) <= max_width:
            cur += ch
        else:
            lines.append(cur)
            cur = ch
            if len(lines) == max_lines:
                break
    if cur and len(lines) < max_lines:
        lines.append(cur)
    if len(lines) == max_lines and "".join(lines) != text:
        lines[-1] = lines[-1][:-1] + "…"
    return lines


def base_canvas():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 14], fill=ACC)
    return img, d


def footer(d):
    d.text((64, H - 58), "Chu-kei Insight", font=F(BOLD, 30), fill=INK)
    label = "chu-kei.com"
    tw = d.textlength(label, font=F(REG, 26))
    d.text((W - 64 - tw, H - 54), label, font=F(REG, 26), fill=MUT)


def pill(d, text, x=64, y=52):
    f = F(BOLD, 26)
    tw = d.textlength(text, font=f)
    d.rounded_rectangle([x, y, x + tw + 44, y + 48], radius=24, fill=ACC)
    d.text((x + 22, y + 24), text, font=f, fill=WHITE, anchor="lm")
    return y + 48


def load_reviews():
    reviews = {}
    rdir = ROOT / "operations/quality-rebase/phase2/primary-reviews"
    for p in sorted(rdir.glob("*-primary-review-v1.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        code = str((data.get("company") or {}).get("code") or "")
        if code:
            reviews[code] = data
    return reviews


def review_targets(review):
    sa = review.get("structuredAnalysis") or {}
    targets = []
    seen = set()
    for t in sa.get("financialTargets") or []:
        if t.get("classification") != "formal_plan_terminal_target":
            continue
        if t.get("value") is None or not t.get("metric"):
            continue
        if t["metric"] in seen:
            continue
        seen.add(t["metric"])
        targets.append(t)
        if len(targets) == 3:
            break
    return targets


def plausible_period(period):
    if not isinstance(period, str):
        return None
    period = period.strip()
    if not period or not re.search(r"\d", period):
        return None
    if len(period) > 60:
        return None
    return period


def company_image(c, review):
    img, d = base_canvas()
    y = pill(d, "中期経営計画")
    name = str(c.get("name") or "")
    code = str(c.get("code") or "")
    nf, _ = fit_font(d, name, BOLD, 64, 30, W - 128)
    lines = wrap(d, name, nf, W - 128, max_lines=2)
    ty = y + 18
    for line in lines:
        d.text((64, ty), line, font=nf, fill=INK)
        ty += int(nf.size * 1.16)
    d.text((64, ty), f"（{code}）", font=F(BOLD, 30), fill=MUT)
    ty += 48

    plan_title = None
    period = None
    targets = []
    if review:
        plan_title = (review.get("document") or {}).get("title") or None
        sa = review.get("structuredAnalysis") or {}
        period = plausible_period(sa.get("period"))
        targets = review_targets(review)
    if plan_title:
        pf, _ = fit_font(d, f"「{plan_title}」", BOLD, 36, 24, W - 128)
        for line in wrap(d, f"「{plan_title}」", pf, W - 128, max_lines=1):
            d.text((64, ty), line, font=pf, fill=ACC)
        ty += 48
    if period and len(lines) < 2:
        d.text((64, ty), period, font=F(REG, 27), fill=MUT)
        ty += 40

    box_y = ty + 8
    if targets:
        box_h = 56 + 40 * len(targets) + 12
    else:
        box_h = 118
    d.rounded_rectangle([64, box_y, W - 64, box_y + box_h], radius=20, fill=WHITE, outline=LINE, width=2)
    if targets:
        fy = targets[0].get("fiscalYear") or ""
        d.text((96, box_y + 16), f"{fy}の目標" if fy else "最終年度の目標", font=F(BOLD, 26), fill=ACC)
        ry = box_y + 54
        for t in targets:
            d.text((96, ry), str(t["metric"]), font=F(REG, 30), fill=MUT)
            val = fmt_value(t["value"]) + str(t.get("unit") or "")
            vf = F(BOLD, 34)
            tw = d.textlength(val, font=vf)
            d.text((W - 96 - tw, ry - 3), val, font=vf, fill=INK)
            ry += 40
    else:
        status = STATUS_LABEL.get(c.get("planStatus"), "")
        market = MARKET_LABEL.get(c.get("market"), c.get("market") or "")
        meta = " / ".join([x for x in [market, c.get("industry") or ""] if x])
        if meta:
            d.text((96, box_y + 22), meta, font=F(REG, 30), fill=MUT)
        if status:
            sf, _ = fit_font(d, status, BOLD, 32, 24, W - 192)
            d.text((96, box_y + 66), status, font=sf, fill=INK)
    footer(d)
    return img


def default_image():
    img, d = base_canvas()
    y = pill(d, "中期経営計画ポータル")
    d.text((64, y + 40), "Chu-kei Insight", font=F(BOLD, 84), fill=INK)
    d.text((64, y + 150), "日本上場企業 中期経営計画ポータル", font=F(BOLD, 44), fill=ACC)
    d.text((64, y + 224), "上場企業の中期経営計画を、出典・確認日つきで検索・比較できます。", font=F(REG, 32), fill=MUT)
    footer(d)
    return img


def theme_image(name, count):
    img, d = base_canvas()
    y = pill(d, "テーマ別企業一覧")
    tf, _ = fit_font(d, name, BOLD, 84, 40, W - 128)
    d.text((64, y + 44), name, font=tf, fill=INK)
    d.text((64, y + 158), "を中期経営計画で掲げる企業一覧", font=F(BOLD, 42), fill=ACC)
    d.text((64, y + 232), f"掲載企業 {count}社", font=F(REG, 34), fill=MUT)
    footer(d)
    return img


def main():
    index = json.loads(gzip.open(ROOT / "site/data/frontend/company-index.json.gz", "rt", encoding="utf-8").read())
    companies = [c for c in index.get("companies") or [] if c.get("planStatus") in RESOLVED]
    companies.sort(key=lambda c: str(c["code"]))
    reviews = load_reviews()
    out = ROOT / "site/og"
    out.mkdir(parents=True, exist_ok=True)

    with_targets = 0
    for c in companies:
        review = reviews.get(str(c["code"]))
        img = company_image(c, review)
        if review and review_targets(review):
            with_targets += 1
        img.save(out / f"{c['code']}.jpg", quality=88)

    default_image().save(out / "default.jpg", quality=88)

    theme_counts = {}
    for c in index.get("companies") or []:
        if c.get("planStatus") not in ("current", "expired"):
            continue
        for name in set(c.get("themes") or []):
            theme_counts[name] = theme_counts.get(name, 0) + 1
    theme_made = 0
    for name, slug in THEMES:
        count = theme_counts.get(name, 0)
        if count >= THEME_MINIMUM:
            theme_image(name, count).save(out / f"theme-{slug}.jpg", quality=88)
            theme_made += 1

    print(f"og images: companies={len(companies)} with_targets={with_targets} "
          f"fallback={len(companies) - with_targets} themes={theme_made} default=1")


if __name__ == "__main__":
    main()
