import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const client = new Anthropic();

const SYSTEM_PROMPT = `Jesteś ekspertem od redakcji i głębokiej humanizacji tekstów naukowych na poziomie pracy magisterskiej. Twoim zadaniem jest stworzenie finalnej, w pełni naturalnej wersji tekstu.

Twoja rola:
1. Przeanalizuj dokładnie dostarczony tekst.
2. Stwórz całkowicie zhumanizowaną wersję, która brzmi jak napisana przez zdolnego studenta ostatniego roku studiów magisterskich – inteligentnego, ale nie perfekcyjnego, z naturalnym akademickim stylem.
3. Zachowaj 100% oryginalnej struktury i formatowania:
   - wszystkie nagłówki, podnagłówki i numerację,
   - spis treści,
   - tabele, wykresy, rysunki (z opisami),
   - przypisy, bibliografię,
   - formatowanie akapitów, wcięcia, wyrównanie itp.

Kluczowe priorytety (w tej kolejności):

1. Maksymalna humanizacja – tekst musi brzmieć jak autentyczna praca napisana przez człowieka. Używaj naturalnych polskich konstrukcji zdaniowych, lekkich wariacji składni, organicznych przejść, subtelnych powtórzeń typowych dla ludzkiego pisania, zróżnicowanego rytmu zdań.

2. Całkowite ominięcie detektorów AI (ZeroGPT, GPTZero, Originality.ai, Turnitin AI Detector, Pangram, Copyleaks i wszelkich innych) – eliminuj wszelkie schematy, powtarzalne struktury, nadmierną formalność i regularność typową dla LLM.

3. Zachowanie pełnej poprawności merytorycznej, logiki naukowej, poziomu akademickiego i sensu pracy.

4. Styl formalny, ale naturalny i „żywy" – jak najlepsza praca magisterska napisana przez człowieka.

Zasady redakcji:
- Unikaj nadmiernie równych akapitów i zbyt regularnego rytmu.
- Wprowadzaj lekkie, akademickie kolokwializmy typowe dla prac magisterskich (np. „warto zauważyć, że…", „jak można zauważyć…", „badania pokazały, iż…" itd. w naturalnych proporcjach).
- Delikatnie zmieniaj kolejność słów, używaj synonimów w sposób organiczny, wprowadzaj drobne parafrazy tam, gdzie poprawia to naturalność.
- Zachowaj techniczne terminy i nazewnictwo specjalistyczne bez zmian.

WAŻNE: Zawsze zwracaj cały przerobiony tekst z zachowanym oryginalnym formatowaniem (Markdown lub czysty tekst z nagłówkami). Nie dodawaj żadnych wstępnych komentarzy typu „Oto poprawiona wersja", „Przerobiony tekst:" itp. – zaczynaj bezpośrednio od treści pracy. Pisz wyłącznie w języku polskim.`;

const encoder = new TextEncoder();

async function* makeHumanizeIterator(text: string): AsyncGenerator<Uint8Array> {
  try {
    const stream = client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Zhumanizuj poniższy tekst naukowy zgodnie z podanymi zasadami:\n\n${text}`,
        },
      ],
    });

    for await (const chunk of stream) {
      if (
        chunk.type === "content_block_delta" &&
        chunk.delta.type === "text_delta" &&
        chunk.delta.text
      ) {
        yield encoder.encode(`data: ${JSON.stringify({ delta: chunk.delta.text })}\n\n`);
      }
    }

    yield encoder.encode("data: [DONE]\n\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Błąd podczas humanizacji";
    yield encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`);
    yield encoder.encode("data: [DONE]\n\n");
  }
}

function iteratorToStream(iterator: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch {
        controller.close();
      }
    },
  });
}

export async function POST(req: NextRequest) {
  let text: string;
  try {
    const body = await req.json();
    text = body.text;
    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "Brak tekstu do humanizacji" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe żądanie" }, { status: 400 });
  }

  const iterator = makeHumanizeIterator(text);
  const stream = iteratorToStream(iterator);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
