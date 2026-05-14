"""Generator raportu z ankiety o stresie studentów.

Użycie:
    python raport_ankiety.py <plik.csv>

Wczytuje CSV, autodetekuje kolumny liczbowe (skala 1-5) i otwarte (tekst),
liczy statystyki opisowe, generuje histogramy, macierz korelacji, analizę
sentymentu (VADER + TextBlob) i składa wszystko w PDF + osobne PNG-i
w katalogu raport/ankieta-RRRR-MM-DD.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.backends.backend_pdf import PdfPages
from textblob import TextBlob
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer


LIKERT_MIN, LIKERT_MAX = 1, 5


def split_columns(df: pd.DataFrame) -> tuple[list[str], list[str]]:
    """Podziel kolumny na liczbowe (skala 1-5) i otwarte (tekst)."""
    numeric, open_ended = [], []
    for col in df.columns:
        coerced = pd.to_numeric(df[col], errors="coerce")
        non_null_ratio = coerced.notna().mean()
        if non_null_ratio >= 0.8:
            values = coerced.dropna()
            if values.between(LIKERT_MIN, LIKERT_MAX).mean() >= 0.95:
                numeric.append(col)
                continue
        if df[col].dropna().astype(str).str.len().mean() > 10:
            open_ended.append(col)
    return numeric, open_ended


def numeric_stats(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    data = df[cols].apply(pd.to_numeric, errors="coerce")
    stats = pd.DataFrame({
        "N": data.count(),
        "średnia": data.mean().round(2),
        "mediana": data.median(),
        "odch. std": data.std().round(2),
        "min": data.min(),
        "max": data.max(),
    })
    return stats


def plot_histograms(df: pd.DataFrame, cols: list[str], out_dir: Path) -> list[Path]:
    """Po jednym PNG na pytanie + zbiorczy grid."""
    paths: list[Path] = []
    data = df[cols].apply(pd.to_numeric, errors="coerce")

    for col in cols:
        fig, ax = plt.subplots(figsize=(6, 4))
        values = data[col].dropna()
        bins = np.arange(LIKERT_MIN - 0.5, LIKERT_MAX + 1.5, 1)
        ax.hist(values, bins=bins, edgecolor="black", color="#4C72B0")
        ax.set_xticks(range(LIKERT_MIN, LIKERT_MAX + 1))
        ax.set_xlabel("Odpowiedź (1-5)")
        ax.set_ylabel("Liczba respondentów")
        ax.set_title(col)
        fig.tight_layout()
        path = out_dir / f"hist_{_safe_name(col)}.png"
        fig.savefig(path, dpi=120)
        plt.close(fig)
        paths.append(path)

    ncols = 3
    nrows = int(np.ceil(len(cols) / ncols))
    fig, axes = plt.subplots(nrows, ncols, figsize=(4 * ncols, 3 * nrows))
    axes = np.array(axes).reshape(-1)
    bins = np.arange(LIKERT_MIN - 0.5, LIKERT_MAX + 1.5, 1)
    for ax, col in zip(axes, cols):
        ax.hist(data[col].dropna(), bins=bins, edgecolor="black", color="#4C72B0")
        ax.set_title(col, fontsize=9)
        ax.set_xticks(range(LIKERT_MIN, LIKERT_MAX + 1))
    for ax in axes[len(cols):]:
        ax.axis("off")
    fig.suptitle("Histogramy wszystkich pytań liczbowych", fontsize=14)
    fig.tight_layout(rect=(0, 0, 1, 0.97))
    grid_path = out_dir / "histogramy_grid.png"
    fig.savefig(grid_path, dpi=120)
    plt.close(fig)
    paths.append(grid_path)
    return paths


def plot_correlation(df: pd.DataFrame, cols: list[str], out_dir: Path) -> tuple[Path, pd.DataFrame]:
    data = df[cols].apply(pd.to_numeric, errors="coerce")
    corr = data.corr()
    fig, ax = plt.subplots(figsize=(max(8, len(cols) * 0.6), max(7, len(cols) * 0.6)))
    im = ax.imshow(corr, cmap="coolwarm", vmin=-1, vmax=1)
    ax.set_xticks(range(len(cols)))
    ax.set_yticks(range(len(cols)))
    ax.set_xticklabels(cols, rotation=45, ha="right", fontsize=8)
    ax.set_yticklabels(cols, fontsize=8)
    for i in range(len(cols)):
        for j in range(len(cols)):
            ax.text(j, i, f"{corr.iat[i, j]:.2f}", ha="center", va="center",
                    fontsize=7, color="black")
    fig.colorbar(im, ax=ax, shrink=0.7)
    ax.set_title("Macierz korelacji (Pearson)")
    fig.tight_layout()
    path = out_dir / "korelacja.png"
    fig.savefig(path, dpi=120)
    plt.close(fig)
    return path, corr


def sentiment_analysis(df: pd.DataFrame, cols: list[str]) -> dict[str, pd.DataFrame]:
    vader = SentimentIntensityAnalyzer()
    results: dict[str, pd.DataFrame] = {}
    for col in cols:
        rows = []
        for text in df[col].dropna().astype(str):
            text = text.strip()
            if not text:
                continue
            v = vader.polarity_scores(text)
            tb = TextBlob(text).sentiment
            rows.append({
                "tekst": text,
                "vader_compound": v["compound"],
                "vader_pos": v["pos"],
                "vader_neg": v["neg"],
                "vader_neu": v["neu"],
                "textblob_polarity": round(tb.polarity, 3),
                "textblob_subjectivity": round(tb.subjectivity, 3),
                "etykieta": _label(v["compound"]),
            })
        results[col] = pd.DataFrame(rows)
    return results


def _label(compound: float) -> str:
    if compound >= 0.05:
        return "pozytywny"
    if compound <= -0.05:
        return "negatywny"
    return "neutralny"


def plot_sentiment(results: dict[str, pd.DataFrame], out_dir: Path) -> list[Path]:
    paths: list[Path] = []
    for col, df_s in results.items():
        if df_s.empty:
            continue
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4))

        counts = df_s["etykieta"].value_counts().reindex(
            ["pozytywny", "neutralny", "negatywny"], fill_value=0)
        ax1.bar(counts.index, counts.values,
                color=["#55A868", "#C7C7C7", "#C44E52"])
        ax1.set_title(f"VADER — rozkład etykiet\n{col}", fontsize=10)
        ax1.set_ylabel("Liczba odpowiedzi")

        ax2.hist(df_s["textblob_polarity"], bins=20,
                 edgecolor="black", color="#4C72B0")
        ax2.axvline(0, color="black", linewidth=0.8)
        ax2.set_xlim(-1, 1)
        ax2.set_title(f"TextBlob — polarność\n{col}", fontsize=10)
        ax2.set_xlabel("Polarność (-1..1)")
        ax2.set_ylabel("Liczba odpowiedzi")

        fig.tight_layout()
        path = out_dir / f"sentyment_{_safe_name(col)}.png"
        fig.savefig(path, dpi=120)
        plt.close(fig)
        paths.append(path)
    return paths


def _safe_name(name: str) -> str:
    keep = "-_"
    return "".join(c if c.isalnum() or c in keep else "_" for c in name)[:60]


def _text_page(pdf: PdfPages, title: str, lines: list[str]) -> None:
    fig = plt.figure(figsize=(8.27, 11.69))
    fig.text(0.07, 0.95, title, fontsize=16, weight="bold")
    body = "\n".join(lines)
    fig.text(0.07, 0.05, body, fontsize=9, family="monospace",
             verticalalignment="bottom")
    pdf.savefig(fig)
    plt.close(fig)


def _image_page(pdf: PdfPages, image_path: Path, caption: str) -> None:
    img = plt.imread(image_path)
    fig = plt.figure(figsize=(8.27, 11.69))
    fig.text(0.07, 0.95, caption, fontsize=12, weight="bold")
    ax = fig.add_axes((0.05, 0.05, 0.9, 0.85))
    ax.imshow(img)
    ax.axis("off")
    pdf.savefig(fig)
    plt.close(fig)


def build_pdf(
    pdf_path: Path,
    stats: pd.DataFrame,
    hist_paths: list[Path],
    corr_path: Path,
    corr: pd.DataFrame,
    sentiment: dict[str, pd.DataFrame],
    sentiment_paths: list[Path],
    n_respondents: int,
) -> None:
    with PdfPages(pdf_path) as pdf:
        cover = plt.figure(figsize=(8.27, 11.69))
        cover.text(0.5, 0.7, "Raport z ankiety", fontsize=24, weight="bold",
                   ha="center")
        cover.text(0.5, 0.63, "Stres studentów", fontsize=16, ha="center")
        cover.text(0.5, 0.55, f"Data: {date.today().isoformat()}",
                   fontsize=12, ha="center")
        cover.text(0.5, 0.52, f"Liczba respondentów: {n_respondents}",
                   fontsize=12, ha="center")
        pdf.savefig(cover)
        plt.close(cover)

        lines = ["Statystyki pytań liczbowych (skala 1-5):", ""]
        lines.append(stats.to_string())
        _text_page(pdf, "1. Statystyki opisowe", lines)

        grid = next((p for p in hist_paths if p.name == "histogramy_grid.png"), None)
        if grid:
            _image_page(pdf, grid, "2. Histogramy — zestawienie")
        for path in hist_paths:
            if path.name == "histogramy_grid.png":
                continue
            _image_page(pdf, path, f"Histogram: {path.stem.replace('hist_', '')}")

        _image_page(pdf, corr_path, "3. Macierz korelacji")
        strong = []
        cols = corr.columns.tolist()
        for i in range(len(cols)):
            for j in range(i + 1, len(cols)):
                r = corr.iat[i, j]
                if abs(r) >= 0.4:
                    strong.append((cols[i], cols[j], r))
        strong.sort(key=lambda x: abs(x[2]), reverse=True)
        corr_lines = ["Najsilniejsze korelacje (|r| >= 0.4):", ""]
        if strong:
            for a, b, r in strong:
                corr_lines.append(f"  r = {r:+.2f}   {a}  <->  {b}")
        else:
            corr_lines.append("  Brak korelacji o |r| >= 0.4.")
        _text_page(pdf, "Korelacje — podsumowanie", corr_lines)

        sentiment_summary = ["Pytania otwarte — sentyment (VADER + TextBlob):", ""]
        for col, df_s in sentiment.items():
            sentiment_summary.append(f"### {col}")
            if df_s.empty:
                sentiment_summary.append("  (brak odpowiedzi)")
                continue
            counts = df_s["etykieta"].value_counts()
            sentiment_summary.append(f"  N = {len(df_s)}")
            sentiment_summary.append(
                f"  VADER compound — średnia: {df_s['vader_compound'].mean():+.3f}, "
                f"mediana: {df_s['vader_compound'].median():+.3f}")
            sentiment_summary.append(
                f"  TextBlob polarność — średnia: {df_s['textblob_polarity'].mean():+.3f}, "
                f"subiektywność: {df_s['textblob_subjectivity'].mean():.3f}")
            for label in ("pozytywny", "neutralny", "negatywny"):
                n = int(counts.get(label, 0))
                pct = n / len(df_s) * 100
                sentiment_summary.append(f"  {label:>10}: {n:4d}  ({pct:5.1f}%)")
            sentiment_summary.append("")
        _text_page(pdf, "4. Analiza sentymentu", sentiment_summary)

        for path in sentiment_paths:
            _image_page(pdf, path, f"Sentyment: {path.stem.replace('sentyment_', '')}")

        for col, df_s in sentiment.items():
            if df_s.empty:
                continue
            top_pos = df_s.nlargest(3, "vader_compound")
            top_neg = df_s.nsmallest(3, "vader_compound")
            lines = [f"### {col}", "", "Najbardziej pozytywne:"]
            for _, row in top_pos.iterrows():
                lines.append(f"  [{row['vader_compound']:+.2f}] "
                             f"{row['tekst'][:200]}")
            lines.append("")
            lines.append("Najbardziej negatywne:")
            for _, row in top_neg.iterrows():
                lines.append(f"  [{row['vader_compound']:+.2f}] "
                             f"{row['tekst'][:200]}")
            _text_page(pdf, f"Przykładowe wypowiedzi — {col}", lines)


def generate_report(csv_path: Path, base_out: Path = Path("raport")) -> Path:
    df = pd.read_csv(csv_path)
    numeric_cols, open_cols = split_columns(df)
    if not numeric_cols:
        raise SystemExit("Nie wykryto kolumn liczbowych w skali 1-5.")

    today = date.today().isoformat()
    out_dir = base_out / f"ankieta-{today}"
    out_dir.mkdir(parents=True, exist_ok=True)

    stats = numeric_stats(df, numeric_cols)
    stats.to_csv(out_dir / "statystyki.csv")

    hist_paths = plot_histograms(df, numeric_cols, out_dir)
    corr_path, corr = plot_correlation(df, numeric_cols, out_dir)
    corr.to_csv(out_dir / "korelacja.csv")

    sentiment = sentiment_analysis(df, open_cols)
    for col, df_s in sentiment.items():
        df_s.to_csv(out_dir / f"sentyment_{_safe_name(col)}.csv", index=False)
    sentiment_paths = plot_sentiment(sentiment, out_dir)

    pdf_path = out_dir / f"ankieta-{today}.pdf"
    build_pdf(pdf_path, stats, hist_paths, corr_path, corr,
              sentiment, sentiment_paths, n_respondents=len(df))

    print(f"Wykryto {len(numeric_cols)} pytań liczbowych i "
          f"{len(open_cols)} pytań otwartych.")
    print(f"Respondenci: {len(df)}")
    print(f"Raport: {pdf_path}")
    return pdf_path


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Użycie: python raport_ankiety.py <plik.csv>")
        sys.exit(1)
    generate_report(Path(sys.argv[1]))
