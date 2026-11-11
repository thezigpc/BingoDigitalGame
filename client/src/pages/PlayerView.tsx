import { useEffect, useState } from "react";
import { ballLabel, type CardView, type RoomView } from "@bingo/shared";
import { CardGrid, Countdown, PatternCard, RecentBalls } from "../components/bits";
import type { Act } from "./RoomPage";

interface Props {
  view: RoomView;
  skew: number;
  act: Act;
  setToast: (s: string) => void;
}

export function PlayerView({ view, skew, act, setToast }: Props) {
  const playing = view.phase === "playing";
  const manual = view.settings.daubMode === "manual";
  const called = new Set(view.called);
  const me = view.you.id;
  const myPending = view.claims.find((c) => c.playerId === me && c.status === "pending");
  const confirmed = view.claims.filter((c) => c.status === "confirmed");
  const iWon = confirmed.some((c) => c.playerId === me);
  // Only a Bar Games box's reject_claim gives a reason; the host's Dismiss never does.
  const myRejected = [...view.claims].reverse().find((c) => c.playerId === me && c.status !== "invalid");
  const rejectReason = myRejected?.status === "dismissed" ? myRejected.reason : undefined;
  const [claiming, setClaiming] = useState(false);

  // Optimistic daubs: shown instantly, replaced by the server's truth on the next state.
  const [optimistic, setOptimistic] = useState<Record<string, Set<number>>>({});
  useEffect(() => setOptimistic({}), [view]);

  const marksFor = (card: CardView) => {
    const base = new Set(card.daubs);
    for (const i of optimistic[card.id] ?? []) {
      if (base.has(i)) base.delete(i);
      else base.add(i);
    }
    return base;
  };

  const tap = (card: CardView, index: number) => {
    if (!playing) return;
    const n = card.cells[index];
    const marked = marksFor(card).has(index);
    if (!marked && !called.has(n)) {
      setToast(`${ballLabel(n)} hasn't been called yet.`);
      return;
    }
    setOptimistic((o) => {
      const s = new Set(o[card.id] ?? []);
      if (s.has(index)) s.delete(index);
      else s.add(index);
      return { ...o, [card.id]: s };
    });
    navigator.vibrate?.(15);
    act("daub", { cardId: card.id, index });
  };

  const claim = async () => {
    setClaiming(true);
    const res = await act<{ valid: boolean }>("claimBingo");
    setClaiming(false);
    if (res && !res.valid) setToast("Not a bingo yet. Check the pattern and keep playing!");
  };

  return (
    <main className="player">
      {iWon ? (
        <div className="banner banner-win">🏆 You won game {view.gameNumber}!</div>
      ) : confirmed.length > 0 ? (
        <div className="banner banner-info">🏆 {confirmed.map((c) => c.playerName).join(", ")} won!</div>
      ) : myPending ? (
        <div className="banner banner-win">BINGO! The host is checking your card…</div>
      ) : rejectReason ? (
        <div className="banner banner-info">Your BINGO wasn't accepted: {rejectReason}</div>
      ) : null}

      <section className="player-top">
        {playing ? (
          <>
            <RecentBalls called={view.called} count={4} size="lg" />
            <div className="player-status">
              <span>{view.called.length} called</span>
              {view.paused ? <span className="tag">Paused</span> : <Countdown at={view.nextCallAt} skew={skew} />}
            </div>
          </>
        ) : (
          <p className="waiting">Waiting for the host to start game {view.gameNumber}…</p>
        )}
        <PatternCard pattern={view.pattern} size="sm" />
      </section>

      <section className={`cards cards-${view.myCards.length}`}>
        {view.myCards.map((card) => (
          <CardGrid
            key={card.id}
            cells={card.cells}
            marked={marksFor(card)}
            called={manual && playing ? called : undefined}
            onTap={manual && playing ? (i) => tap(card, i) : undefined}
            serial={card.id}
          />
        ))}
      </section>
      {manual && playing && (
        <p className="muted small center">Tap a number to mark it. Called numbers you haven't marked glow.</p>
      )}

      {playing && (
        <div className="bingo-bar">
          <button className="btn btn-bingo" disabled={claiming || !!myPending} onClick={claim}>
            BINGO!
          </button>
        </div>
      )}
    </main>
  );
}
