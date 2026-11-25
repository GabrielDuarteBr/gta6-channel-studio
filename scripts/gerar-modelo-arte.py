#!/usr/bin/env python3
"""Gera o MODELO do pacote de arte do Zeca (camadas SVG, tela 1500x1800) para o artista ver
posições e nomes. Só biblioteca padrão do Python.

    python3 scripts/gerar-modelo-arte.py   # camadas em docs/modelo-arte-zeca/ e o .zip no painel
"""
import pathlib
import zipfile

W, H = 1500, 1800
OUT = pathlib.Path(__file__).resolve().parent.parent / "docs" / "modelo-arte-zeca"
SKIN, SHADE, HAIR = "#d99a6c", "#b97a52", "#2b1640"
PINK, CYAN, LIP, DARK = "#ff3d8b", "#2ee6f2", "#8a3b2e", "#3a1414"


def svg(body: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">\n'
        f"{body}\n</svg>\n"
    )


# Cabeça centrada em (750, 640); olhos em y=620; boca em y=880; pescoço em (750, 990).
layers: dict[str, str] = {
    "corpo": f'<rect x="690" y="930" width="120" height="160" rx="30" fill="{SHADE}"/>'
    f'<path d="M260 1800 C280 1300 470 1060 750 1050 C1030 1060 1220 1300 1240 1800 Z" fill="#13b8c9" stroke="#0b6f7a" stroke-width="10"/>'
    f'<path d="M690 1050 L750 1200 L810 1050 Z" fill="{SKIN}"/>',
    "cabeca": f'<ellipse cx="455" cy="660" rx="50" ry="60" fill="{SHADE}"/>'
    f'<ellipse cx="1045" cy="660" rx="50" ry="60" fill="{SHADE}"/>'
    f'<ellipse cx="750" cy="640" rx="300" ry="350" fill="{SKIN}"/>'
    f'<path d="M455 560 C420 330 540 170 740 150 C900 140 1010 220 1050 330 C1080 420 1060 500 1040 560 C980 430 880 390 760 395 C630 400 520 450 455 560 Z" fill="{HAIR}" stroke="{PINK}" stroke-width="10"/>'
    f'<path d="M750 700 Q725 780 742 795 Q760 805 778 790" stroke="{SHADE}" stroke-width="10" fill="none" stroke-linecap="round"/>',
    "olhos-aberto": ''.join(
        f'<ellipse cx="{x}" cy="620" rx="62" ry="48" fill="#fff"/><circle cx="{x + 6}" cy="624" r="26" fill="#1b1030"/>'
        for x in (630, 870)
    ),
    "olhos-meio": ''.join(
        f'<path d="M{x - 62} 620 Q{x} 600 {x + 62} 620 Q{x} 650 {x - 62} 620 Z" fill="#fff"/><circle cx="{x + 6}" cy="626" r="16" fill="#1b1030"/>'
        for x in (630, 870)
    ),
    "olhos-fechado": ''.join(
        f'<path d="M{x - 60} 625 Q{x} 655 {x + 60} 625" stroke="#1b1030" stroke-width="12" fill="none" stroke-linecap="round"/>'
        for x in (630, 870)
    ),
    "frente": ''.join(
        f'<rect x="{x - 110}" y="555" width="220" height="150" rx="45" fill="#0c061e" fill-opacity="0.45" stroke="{PINK}" stroke-width="18"/>'
        for x in (630, 870)
    )
    + f'<path d="M740 610 Q750 595 760 610" stroke="{CYAN}" stroke-width="14" fill="none"/>',
    "rosto-empolgado": ''.join(
        f'<ellipse cx="{x}" cy="770" rx="60" ry="32" fill="{PINK}" fill-opacity="0.35"/>' for x in (560, 940)
    ),
    "braco-repouso": f'<path d="M1080 1150 C1180 1300 1200 1500 1170 1700" stroke="#13b8c9" stroke-width="120" fill="none" stroke-linecap="round"/>'
    f'<circle cx="1170" cy="1720" r="55" fill="{SKIN}"/>',
    "braco-aponta_tela": f'<path d="M1080 1150 C1150 1050 1230 920 1300 820" stroke="#13b8c9" stroke-width="120" fill="none" stroke-linecap="round"/>'
    f'<circle cx="1315" cy="790" r="55" fill="{SKIN}"/><rect x="1300" y="660" width="34" height="120" rx="17" fill="{SKIN}"/>',
    "braco-aceno": f'<path d="M1080 1150 C1200 1100 1280 980 1300 860" stroke="#13b8c9" stroke-width="120" fill="none" stroke-linecap="round"/>'
    f'<circle cx="1305" cy="800" r="70" fill="{SKIN}"/>',
}

BROWS = {  # (subida, inclinação interna, extra no esquerdo)
    "neutro": (0, 0, 0),
    "feliz": (-20, -8, 0),
    "empolgado": (-45, -12, 0),
    "debochado": (0, 4, -40),
    "desconfiado": (12, 8, -55),
    "surpreso": (-55, -12, 0),
    "serio": (10, 14, 0),
    "bravo": (15, 40, 0),
}
for name, (raise_, inner, left_extra) in BROWS.items():
    def brow(x: int, side: int, extra: int) -> str:
        y = 520 + raise_ + extra
        x1, x2 = x - 70, x + 70
        y_in = y + inner
        ya, yb = (y, y_in) if side < 0 else (y_in, y)
        return f'<path d="M{x1} {ya} L{x2} {yb}" stroke="{HAIR}" stroke-width="26" stroke-linecap="round"/>'
    layers[f"sobrancelhas-{name}"] = brow(630, -1, left_extra) + brow(870, 1, 0)

MX, MY = 750, 880
MOUTHS = {
    "A": f'<path d="M{MX - 80} {MY} Q{MX} {MY + 10} {MX + 80} {MY}" stroke="{LIP}" stroke-width="22" fill="none" stroke-linecap="round"/>',
    "B": f'<rect x="{MX - 80}" y="{MY - 22}" width="160" height="44" rx="20" fill="{DARK}"/><rect x="{MX - 68}" y="{MY - 18}" width="136" height="18" rx="6" fill="#fff"/>',
    "C": f'<ellipse cx="{MX}" cy="{MY}" rx="80" ry="40" fill="{DARK}" stroke="{LIP}" stroke-width="12"/>',
    "D": f'<ellipse cx="{MX}" cy="{MY + 10}" rx="90" ry="70" fill="{DARK}" stroke="{LIP}" stroke-width="12"/><ellipse cx="{MX}" cy="{MY + 45}" rx="50" ry="22" fill="#e2737a"/>',
    "E": f'<ellipse cx="{MX}" cy="{MY + 5}" rx="55" ry="55" fill="{DARK}" stroke="{LIP}" stroke-width="12"/>',
    "F": f'<ellipse cx="{MX}" cy="{MY}" rx="32" ry="36" fill="{DARK}" stroke="{LIP}" stroke-width="14"/>',
    "G": f'<rect x="{MX - 70}" y="{MY - 25}" width="140" height="40" rx="14" fill="{DARK}"/><rect x="{MX - 60}" y="{MY - 25}" width="120" height="20" rx="6" fill="#fff"/><path d="M{MX - 70} {MY + 15} Q{MX} {MY + 35} {MX + 70} {MY + 15}" stroke="{LIP}" stroke-width="16" fill="none"/>',
    "H": f'<ellipse cx="{MX}" cy="{MY}" rx="75" ry="50" fill="{DARK}" stroke="{LIP}" stroke-width="12"/><ellipse cx="{MX}" cy="{MY - 25}" rx="40" ry="16" fill="#e2737a"/>',
    "X": f'<path d="M{MX - 75} {MY - 5} Q{MX} {MY + 30} {MX + 75} {MY - 5}" stroke="{LIP}" stroke-width="18" fill="none" stroke-linecap="round"/>',
}
for shape, body in MOUTHS.items():
    layers[f"boca-{shape}"] = body

LEIAME = """MODELO DO PACOTE DE ARTE DO ZECA NEON (Radar Neon)

Isto é só um MODELO de posições e nomes. O artista desenha por cima, do jeito dele.
Regras (guia completo: docs/guia-arte-zeca.md):
- Todas as camadas com o MESMO tamanho de tela (aqui 1500 x 1800 px), fundo transparente.
- PNG (recomendado) ou SVG simples. Um arquivo por camada, com o nome exato.
- A cabeça não tem olhos, sobrancelhas nem boca: eles são camadas separadas, por cima.
- Ordem (de trás para a frente): costas, corpo, braço, cabeca, olhos, sobrancelhas, boca,
  rosto-<expressão>, frente.
- Pontos de giro padrão: pescoço em 50% x 55% da tela; ombro do braço em 66% x 62%.
"""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, body in layers.items():
        (OUT / f"{name}.svg").write_text(svg(body), encoding="utf-8")
    (OUT / "LEIA-ME.txt").write_text(LEIAME, encoding="utf-8")
    # O painel serve o .zip (Personagem → "Baixar modelo para o artista").
    zpath = OUT.parent.parent / "apps" / "web" / "public" / "modelo-arte-zeca.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(OUT.iterdir()):
            z.write(f, f"modelo-arte-zeca/{f.name}")
    print(f"{len(layers)} camadas em {OUT} e {zpath}")


if __name__ == "__main__":
    main()
